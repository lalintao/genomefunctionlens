from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterator
from pathlib import Path
from threading import RLock
from uuid import uuid4
from typing import Any


class LocalSavedQueryStore:
    """Single-user JSON store implementing the saved-query repository port."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.records_root = root / "records"
        self.requests_root = root / "requests"
        self.categories_path = root / "categories.json"
        self.meta_path = root / "meta.json"
        self._lock = RLock()
        with self._lock:
            self.records_root.mkdir(parents=True, exist_ok=True)
            self.requests_root.mkdir(parents=True, exist_ok=True)
            if not self.categories_path.exists():
                self._write_json(self.categories_path, {"next_id": 1, "items": []})
            if not self.meta_path.exists():
                self._write_json(self.meta_path, {"next_record_id": 1})

    def list_records(self, account_id: int, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        categories = {int(item["id"]): item for item in self._categories()}
        records = []
        with self._lock:
            for record in self._records():
                if int(record.get("account_id", 0)) != account_id:
                    continue
                item = {
                    key: record.get(key)
                    for key in (
                        "id",
                        "title",
                        "category_id",
                        "species_tree",
                        "genome_database",
                        "dataset_revision",
                        "created_at",
                        "updated_at",
                        "record_version",
                    )
                }
                category = categories.get(int(record.get("category_id") or 0))
                item["category_name"] = category.get("name") if category else None
                records.append(item)
        records.sort(key=lambda item: (str(item.get("updated_at") or ""), int(item.get("id") or 0)), reverse=True)
        records.sort(key=lambda item: int(categories.get(int(item.get("category_id") or 0), {}).get("sort_order", 0)))
        return records[offset: offset + limit]

    def create_record(self, account_id: int, payload: dict[str, Any], timestamp: str) -> int:
        with self._lock:
            meta = self._read_json(self.meta_path) or {"next_record_id": 1}
            record_id = int(meta.get("next_record_id") or 1)
            record = self._record(record_id, account_id, payload, timestamp, version=1)
            self._write_json(self.records_root / f"{record_id}.json", record)
            meta["next_record_id"] = record_id + 1
            self._write_json(self.meta_path, meta)
            return record_id

    def update_record(self, account_id: int, record_id: int, payload: dict[str, Any], timestamp: str) -> bool:
        path = self.records_root / f"{record_id}.json"
        with self._lock:
            record = self._read_json(path)
            if not record or int(record.get("account_id", 0)) != account_id:
                return False
            if int(record.get("record_version") or 0) != int(payload.get("expected_record_version") or 0):
                return False
            updated = self._record(
                record_id,
                account_id,
                payload,
                timestamp,
                version=int(record.get("record_version") or 1) + 1,
                created_at=str(record.get("created_at") or timestamp),
            )
            self._write_json(path, updated)
            return True

    def delete_record(self, account_id: int, record_id: int) -> bool:
        path = self.records_root / f"{record_id}.json"
        with self._lock:
            record = self._read_json(path)
            if not record or int(record.get("account_id", 0)) != account_id:
                return False
            path.unlink(missing_ok=True)
            return True

    def get_record(self, account_id: int, record_id: int) -> dict[str, Any] | None:
        with self._lock:
            record = self._read_json(self.records_root / f"{record_id}.json")
        if not record or int(record.get("account_id", 0)) != account_id:
            return None
        return record

    def list_categories(self, account_id: int) -> list[dict[str, Any]]:
        return [
            {key: item.get(key) for key in ("id", "name", "sort_order")}
            for item in sorted(self._categories(), key=lambda item: (int(item.get("sort_order") or 0), str(item.get("name") or "")))
            if int(item.get("account_id", 0)) == account_id
        ]

    def create_category(self, account_id: int, name: str, timestamp: str) -> int:
        with self._lock:
            state = self._read_json(self.categories_path) or {"next_id": 1, "items": []}
            category_id = int(state.get("next_id") or 1)
            items = list(state.get("items") or [])
            items.append({
                "id": category_id,
                "account_id": account_id,
                "name": name,
                "sort_order": len([item for item in items if int(item.get("account_id", 0)) == account_id]),
                "created_at": timestamp,
                "updated_at": timestamp,
            })
            state["items"] = items
            state["next_id"] = category_id + 1
            self._write_json(self.categories_path, state)
            return category_id

    def rename_category(self, account_id: int, category_id: int, name: str, timestamp: str) -> bool:
        with self._lock:
            state = self._read_json(self.categories_path) or {"next_id": 1, "items": []}
            changed = False
            for item in state.get("items") or []:
                if int(item.get("id", 0)) == category_id and int(item.get("account_id", 0)) == account_id:
                    item["name"] = name
                    item["updated_at"] = timestamp
                    changed = True
                    break
            if changed:
                self._write_json(self.categories_path, state)
            return changed

    def delete_category(self, account_id: int, category_id: int) -> bool:
        with self._lock:
            state = self._read_json(self.categories_path) or {"next_id": 1, "items": []}
            remaining = [
                item for item in state.get("items") or []
                if not (int(item.get("id", 0)) == category_id and int(item.get("account_id", 0)) == account_id)
            ]
            if len(remaining) == len(state.get("items") or []):
                return False
            state["items"] = remaining
            self._write_json(self.categories_path, state)
            for record in self._records():
                if int(record.get("account_id", 0)) == account_id and int(record.get("category_id") or 0) == category_id:
                    record["category_id"] = None
                    self._write_json(self.records_root / f"{int(record['id'])}.json", record)
            return True

    def category_belongs_to_account(self, account_id: int, category_id: int) -> bool:
        return any(
            int(item.get("id", 0)) == category_id and int(item.get("account_id", 0)) == account_id
            for item in self._categories()
        )

    def get_save_request(self, account_id: int, request_id: str) -> dict[str, Any] | None:
        return self._read_json(self._request_path(account_id, request_id))

    def remember_save_request(
        self,
        account_id: int,
        request_id: str,
        fingerprint: str,
        record_id: int,
        version: int,
        timestamp: str,
    ) -> None:
        self._write_json(
            self._request_path(account_id, request_id),
            {
                "account_id": account_id,
                "request_id": request_id,
                "fingerprint": fingerprint,
                "record_id": record_id,
                "record_version": version,
                "created_at": timestamp,
            },
        )

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None

    def _record(
        self,
        record_id: int,
        account_id: int,
        payload: dict[str, Any],
        timestamp: str,
        *,
        version: int,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        return {
            "id": record_id,
            "account_id": account_id,
            "category_id": payload.get("category_id"),
            "title": payload["title"],
            "species_tree": payload["species_tree"],
            "genome_database": payload["genome_database"],
            "dataset_revision": payload["dataset_revision"],
            "snapshot_json": payload["snapshot_json"],
            "created_at": created_at or timestamp,
            "updated_at": timestamp,
            "record_version": version,
            "snapshot_schema_version": 2,
        }

    def _records(self) -> Iterator[dict[str, Any]]:
        for path in sorted(self.records_root.glob("*.json")):
            record = self._read_json(path)
            if record:
                yield record

    def _categories(self) -> list[dict[str, Any]]:
        state = self._read_json(self.categories_path) or {"items": []}
        return list(state.get("items") or [])

    def _request_path(self, account_id: int, request_id: str) -> Path:
        digest = hashlib.sha256(f"{account_id}:{request_id}".encode("utf-8")).hexdigest()
        return self.requests_root / f"{digest}.json"

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any] | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
