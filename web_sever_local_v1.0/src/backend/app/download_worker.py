import logging
import threading
from time import monotonic
from uuid import uuid4

from fastapi import HTTPException

from app.db import SessionLocal, validate_download_performance_indexes
from app.services.download_service import DownloadService, cleanup_download_artifacts
from app.services.download_task_service import DownloadJobs, download_jobs


logger = logging.getLogger(__name__)


class DownloadCancelled(Exception):
    pass


class DownloadWorker:
    def __init__(
        self,
        jobs: DownloadJobs = download_jobs,
        *,
        poll_interval_seconds: float = 1.0,
        heartbeat_interval_seconds: float = 5.0,
    ) -> None:
        self.jobs = jobs
        self.poll_interval_seconds = poll_interval_seconds
        self.heartbeat_interval_seconds = heartbeat_interval_seconds
        self.worker_id = uuid4().hex

    def run_once(self) -> bool:
        job = self.jobs.claim_next()
        if job is None:
            recovered = self.jobs.recover_stale()
            if recovered:
                logger.warning("Recovered %s stale download task(s)", recovered)
                job = self.jobs.claim_next()
        if job is None:
            return False

        try:
            with SessionLocal() as db:
                service = DownloadService(db)
                result = service.build_download(
                    job.payload,
                    task_id=job.task_id,
                    progress_callback=lambda completed, total: self._report_progress(
                        job.task_id,
                        completed,
                        total,
                    ),
                    stage_callback=lambda stage: self._report_stage(job.task_id, stage),
                )
            if self.jobs.is_cancel_requested(job.task_id):
                raise DownloadCancelled()
            if not self.jobs.mark_ready(job.task_id, result):
                raise DownloadCancelled()
        except DownloadCancelled:
            self._cleanup(job.task_id)
            self.jobs.mark_cancelled(job.task_id)
        except Exception as exc:
            logger.exception("Download task %s failed", job.task_id)
            self._cleanup(job.task_id)
            detail = exc.detail if isinstance(exc, HTTPException) else "Download generation failed."
            self.jobs.mark_failed(job.task_id, str(detail))
        return True

    def run_forever(self, stop_event: threading.Event) -> None:
        heartbeat_stop = threading.Event()
        self.jobs.record_worker_heartbeat(self.worker_id)
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            args=(heartbeat_stop,),
            name="download-worker-heartbeat",
            daemon=True,
        )
        heartbeat_thread.start()
        last_cleanup = monotonic()
        try:
            self.jobs.purge_expired()
            while not stop_event.is_set():
                if not self.run_once():
                    stop_event.wait(self.poll_interval_seconds)
                if monotonic() - last_cleanup >= 60:
                    self.jobs.purge_expired()
                    last_cleanup = monotonic()
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=self.heartbeat_interval_seconds + 1)
            self.jobs.clear_worker_heartbeat(self.worker_id)

    def _heartbeat_loop(self, stop_event: threading.Event) -> None:
        while not stop_event.wait(self.heartbeat_interval_seconds):
            try:
                self.jobs.record_worker_heartbeat(self.worker_id)
            except (OSError, RuntimeError):
                logger.exception("Could not update the download worker heartbeat")

    def _report_progress(self, task_id: str, completed: int, total: int) -> None:
        if self.jobs.is_cancel_requested(task_id):
            raise DownloadCancelled()
        self.jobs.update_progress(task_id, completed, total)

    def _report_stage(self, task_id: str, stage: str) -> None:
        if self.jobs.is_cancel_requested(task_id):
            raise DownloadCancelled()
        self.jobs.update_stage(task_id, stage)

    def _cleanup(self, task_id: str) -> None:
        try:
            cleanup_download_artifacts(task_id)
        except OSError:
            logger.exception("Could not remove artifacts for download task %s", task_id)


def validate_runtime_data() -> None:
    validate_download_performance_indexes()
