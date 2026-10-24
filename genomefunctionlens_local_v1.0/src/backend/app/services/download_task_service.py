from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

from fastapi import HTTPException

from app.config import get_settings
from app.schemas.download import (
    DownloadRequest,
    DownloadResponse,
    DownloadTaskStartResponse,
    DownloadTaskStatusResponse,
)
from app.services.download_service import create_download_task_id


TASK_RETENTION = timedelta(hours=6)
WORKER_HEARTBEAT_TIMEOUT = timedelta(seconds=15)
UNCLAIMED_TASK_TIMEOUT = timedelta(seconds=30)
WORKER_UNAVAILABLE_ERROR = "Download worker is unavailable."
LOCAL_ACCOUNT_ID = 1


class DownloadJobs:
    """File-backed local download queue; this edition never creates a database."""

    def __init__(
        self,
        root: Path | None = None,
        *,
        archive_root: Path | None = None,
        stale_after: timedelta = timedelta(minutes=10),
        max_attempts: int = 2,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        settings = get_settings()
        self.root = root or settings.download_jobs_root
        self.archive_root = archive_root or settings.download_archive_root
        self.stale_after = stale_after
        self.max_attempts = max_attempts
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self.archive_root.mkdir(parents=True, exist_ok=True)

    def submit(self, payload: DownloadRequest, *, account_id: int = LOCAL_ACCOUNT_ID) -> DownloadTaskStartResponse:
        task_id = create_download_task_id()
        now = self._clock().isoformat()
        task = {
            "task_id": task_id,
            "account_id": LOCAL_ACCOUNT_ID,
            "status": "queued",
            "stage": "queued",
            "payload": payload.model_dump(mode="json"),
            "completed_files": 0,
            "total_files": len(payload.columns),
            "download_url": None,
            "file_count": None,
            "archive_path": None,
            "archive_bytes": None,
            "error": None,
            "error_code": None,
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "heartbeat_at": None,
            "finished_at": None,
            "expires_at": None,
            "attempt_count": 0,
            "cancel_requested": False,
        }
        with self._lock:
            self._write_task(task)
        return DownloadTaskStartResponse(
            task_id=task_id,
            status_url=f"/api/download/status/{task_id}",
        )

    def record_worker_heartbeat(self, worker_id: str) -> None:
        self._write_json(
            self.root / "worker.json",
            {"worker_id": worker_id, "heartbeat_at": self._clock().isoformat()},
        )

    def clear_worker_heartbeat(self, worker_id: str) -> None:
        path = self.root / "worker.json"
        with self._lock:
            state = self._read_json(path)
            if state and state.get("worker_id") == worker_id:
                path.unlink(missing_ok=True)

    def is_worker_available(self) -> bool:
        state = self._read_json(self.root / "worker.json")
        if not state:
            return False
        heartbeat = self._parse_datetime(state.get("heartbeat_at"))
        return heartbeat is not None and heartbeat >= self._clock() - WORKER_HEARTBEAT_TIMEOUT

    def fail_unclaimed_if_worker_unavailable(self, task_id: str, *, account_id: int = LOCAL_ACCOUNT_ID) -> bool:
        with self._lock:
            task = self._read_task(task_id)
            created = self._parse_datetime(task.get("created_at"))
            if (
                task["status"] != "queued"
                or created is None
                or created > self._clock() - UNCLAIMED_TASK_TIMEOUT
                or self.is_worker_available()
            ):
                return False
            now = self._clock().isoformat()
            task.update(
                status="failed",
                stage="failed",
                error=WORKER_UNAVAILABLE_ERROR,
                error_code="worker_unavailable",
                updated_at=now,
                finished_at=now,
                expires_at=(self._clock() + TASK_RETENTION).isoformat(),
            )
            self._write_task(task)
            return True

    def get_status(self, task_id: str, *, account_id: int = LOCAL_ACCOUNT_ID) -> DownloadTaskStatusResponse:
        with self._lock:
            task = self._read_task(task_id)
        return DownloadTaskStatusResponse(
            task_id=str(task["task_id"]),
            status=task["status"],
            stage=task["stage"],
            completed_files=int(task.get("completed_files") or 0),
            total_files=int(task.get("total_files") or 0),
            download_url=task.get("download_url"),
            file_count=task.get("file_count"),
            error=task.get("error"),
        )

    def update_progress(
        self,
        task_id: str,
        completed_files: int,
        total_files: int,
        *,
        stage: str = "writing_files",
    ) -> None:
        self._update_running(
            task_id,
            stage=stage,
            completed_files=completed_files,
            total_files=total_files,
            heartbeat_at=self._clock().isoformat(),
        )

    def mark_ready(self, task_id: str, result: DownloadResponse) -> bool:
        now = self._clock().isoformat()
        archive_path = self.archive_root / f"{task_id}.zip"
        archive_bytes = archive_path.stat().st_size if archive_path.is_file() else None
        with self._lock:
            task = self._read_task(task_id)
            if task["status"] != "running" or task.get("cancel_requested"):
                return False
            task.update(
                status="ready",
                stage="ready",
                completed_files=result.file_count,
                total_files=result.file_count,
                file_count=result.file_count,
                archive_path=str(archive_path),
                archive_bytes=archive_bytes,
                heartbeat_at=now,
                updated_at=now,
                finished_at=now,
                expires_at=(self._clock() + TASK_RETENTION).isoformat(),
            )
            self._write_task(task)
            return True

    def mark_failed(self, task_id: str, error: str, *, error_code: str = "generation_failed") -> None:
        now = self._clock().isoformat()
        self._update_running(
            task_id,
            status="failed",
            stage="failed",
            error=error,
            error_code=error_code,
            heartbeat_at=now,
            finished_at=now,
            expires_at=(self._clock() + TASK_RETENTION).isoformat(),
        )

    def is_cancel_requested(self, task_id: str) -> bool:
        with self._lock:
            task = self._read_task(task_id)
        return bool(task.get("cancel_requested"))

    def cancel(self, task_id: str, *, account_id: int = LOCAL_ACCOUNT_ID) -> DownloadTaskStatusResponse:
        now = self._clock().isoformat()
        with self._lock:
            task = self._read_task(task_id)
            if task["status"] == "queued":
                task.update(
                    status="cancelled",
                    stage="cancelled",
                    cancel_requested=True,
                    updated_at=now,
                    finished_at=now,
                    expires_at=(self._clock() + TASK_RETENTION).isoformat(),
                )
            elif task["status"] == "running":
                task.update(cancel_requested=True, updated_at=now)
            self._write_task(task)
        return self.get_status(task_id, account_id=account_id)

    def mark_cancelled(self, task_id: str) -> None:
        now = self._clock().isoformat()
        self._update_running(
            task_id,
            status="cancelled",
            stage="cancelled",
            error=None,
            error_code="cancelled",
            heartbeat_at=now,
            finished_at=now,
            expires_at=(self._clock() + TASK_RETENTION).isoformat(),
        )

    def update_stage(self, task_id: str, stage: str) -> None:
        self._update_running(
            task_id,
            stage=stage,
            heartbeat_at=self._clock().isoformat(),
            updated_at=self._clock().isoformat(),
        )

    def open_result(self, task_id: str, *, account_id: int = LOCAL_ACCOUNT_ID) -> Path:
        status = self.get_status(task_id, account_id=account_id)
        if status.status != "ready":
            raise HTTPException(status_code=404, detail="Download not found.")
        archive_path = self.archive_root / f"{task_id}.zip"
        if not archive_path.is_file():
            raise HTTPException(status_code=404, detail="Download not found.")
        return archive_path

    def purge_expired(self) -> int:
        now = self._clock()
        count = 0
        with self._lock:
            for path in list(self.root.glob("task_*.json")):
                task = self._read_json(path)
                expires = self._parse_datetime(task.get("expires_at")) if task else None
                if expires is None or expires >= now:
                    continue
                task_id = str(task.get("task_id") or "")
                path.unlink(missing_ok=True)
                if task_id:
                    (self.archive_root / f"{task_id}.zip").unlink(missing_ok=True)
                count += 1
        return count

    def recover_stale(self) -> int:
        cutoff = self._clock() - self.stale_after
        now = self._clock().isoformat()
        changed = 0
        with self._lock:
            for path in list(self.root.glob("task_*.json")):
                task = self._read_json(path)
                if not task or task.get("status") != "running":
                    continue
                heartbeat = self._parse_datetime(task.get("heartbeat_at") or task.get("updated_at") or task.get("created_at"))
                if heartbeat is None or heartbeat >= cutoff:
                    continue
                if task.get("cancel_requested"):
                    task.update(status="cancelled", stage="cancelled", updated_at=now, finished_at=now,
                                expires_at=(self._clock() + TASK_RETENTION).isoformat())
                elif int(task.get("attempt_count") or 0) < self.max_attempts:
                    task.update(status="queued", stage="queued", started_at=None, heartbeat_at=None, updated_at=now)
                else:
                    task.update(status="failed", stage="failed", error="Download worker stopped repeatedly.",
                                error_code="worker_repeatedly_stopped", updated_at=now, finished_at=now,
                                expires_at=(self._clock() + TASK_RETENTION).isoformat())
                self._write_task(task)
                changed += 1
        return changed

    def claim_next(self) -> "ClaimedDownloadJob | None":
        with self._lock:
            tasks = [task for path in self.root.glob("task_*.json") if (task := self._read_json(path))]
            if any(task.get("status") == "running" for task in tasks):
                return None
            queued = sorted(
                (task for task in tasks if task.get("status") == "queued" and not task.get("cancel_requested")),
                key=lambda task: (str(task.get("created_at")), str(task.get("task_id"))),
            )
            if not queued:
                return None
            task = queued[0]
            now = self._clock().isoformat()
            task.update(
                status="running",
                stage="preparing",
                started_at=now,
                heartbeat_at=now,
                updated_at=now,
                attempt_count=int(task.get("attempt_count") or 0) + 1,
            )
            self._write_task(task)
            return ClaimedDownloadJob(
                task_id=str(task["task_id"]),
                payload=DownloadRequest.model_validate(task["payload"]),
            )

    def _update_running(self, task_id: str, **changes: object) -> None:
        with self._lock:
            task = self._read_task(task_id)
            if task.get("status") != "running":
                return
            task.update(changes)
            task["updated_at"] = changes.get("updated_at") or self._clock().isoformat()
            self._write_task(task)

    def _task_path(self, task_id: str) -> Path:
        if not task_id.startswith("task_") or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for ch in task_id):
            raise HTTPException(status_code=404, detail="Download task not found.")
        return self.root / f"{task_id}.json"

    def _read_task(self, task_id: str) -> dict[str, object]:
        task = self._read_json(self._task_path(task_id))
        if not task:
            raise HTTPException(status_code=404, detail="Download task not found.")
        return task

    def _write_task(self, task: dict[str, object]) -> None:
        self._write_json(self._task_path(str(task["task_id"])), task)

    def _read_json(self, path: Path) -> dict[str, object] | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Could not read local state file {path}: {exc}") from exc

    def _write_json(self, path: Path, value: dict[str, object]) -> None:
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
            temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, path)

    @staticmethod
    def _parse_datetime(value: object) -> datetime | None:
        if not isinstance(value, str) or not value:
            return None
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class ClaimedDownloadJob:
    task_id: str
    payload: DownloadRequest


download_jobs = DownloadJobs()
