from collections.abc import Callable
from datetime import datetime, timezone
import json
import hashlib
from pydantic import ValidationError
from app.schemas.workspace_document import CanvasDocument
from typing import Any, Protocol

from app.schemas.saved_workspace import SaveQueryPayload


class SavedQueryStorePort(Protocol):
    def list_records(self, account_id: int, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]: ...
    def create_record(self, account_id: int, payload: dict[str, Any], timestamp: str) -> int: ...
    def update_record(self, account_id: int, record_id: int, payload: dict[str, Any], timestamp: str) -> bool: ...
    def delete_record(self, account_id: int, record_id: int) -> bool: ...
    def get_record(self, account_id: int, record_id: int) -> dict[str, Any] | None: ...
    def list_categories(self, account_id: int) -> list[dict[str, Any]]: ...
    def create_category(self, account_id: int, name: str, timestamp: str) -> int: ...
    def rename_category(self, account_id: int, category_id: int, name: str, timestamp: str) -> bool: ...
    def delete_category(self, account_id: int, category_id: int) -> bool: ...
    def category_belongs_to_account(self, account_id: int, category_id: int) -> bool: ...
    def get_save_request(self, account_id: int, request_id: str) -> dict[str, Any] | None: ...
    def remember_save_request(self, account_id: int, request_id: str, fingerprint: str, record_id: int, version: int, timestamp: str) -> None: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


SAVED_WORKSPACE_SNAPSHOT_VERSION = 3


class SavedWorkspaceError(Exception):
    pass


class SavedWorkspaceNotFoundError(SavedWorkspaceError):
    pass


class SavedWorkspaceValidationError(SavedWorkspaceError):
    pass


class SavedWorkspaceConflictError(SavedWorkspaceError):
    pass


class DatasetIdentityLookup(Protocol):
    def current_revision(self, species_tree: str, genome_database: str) -> str | None: ...
    def validate_document(self, document: CanvasDocument) -> None: ...


class SavedWorkspace:
    def __init__(
        self,
        store: SavedQueryStorePort,
        datasets: DatasetIdentityLookup,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.store = store
        self.datasets = datasets
        self.clock = clock

    def list_records(self, account_id: int, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        return self.store.list_records(account_id, limit, offset)

    def get_record(self, account_id: int, record_id: int) -> dict[str, Any]:
        record = self.store.get_record(account_id, record_id)
        if record is None:
            raise SavedWorkspaceNotFoundError("Saved query record not found.")
        record["snapshot"] = json.loads(record.pop("snapshot_json"))
        current_revision = self.datasets.current_revision(
            str(record["species_tree"]),
            str(record["genome_database"]),
        )
        record["restore_compatibility"] = (
            "missing" if current_revision is None
            else "compatible" if current_revision == record["dataset_revision"]
            else "revision-changed"
        )
        record["current_dataset_revision"] = current_revision
        return record

    def create_record(self, account_id: int, payload: SaveQueryPayload) -> dict[str, int]:
        if payload.expected_record_version is not None:
            raise SavedWorkspaceValidationError("A new archive must not have an expected record version.")
        return self._save(account_id, None, payload)

    def update_record(self, account_id: int, record_id: int, payload: SaveQueryPayload) -> dict[str, int]:
        if payload.expected_record_version is None:
            raise SavedWorkspaceValidationError("Updating an archive requires its record version.")
        return self._save(account_id, record_id, payload)

    def _save(self, account_id: int, record_id: int | None, payload: SaveQueryPayload) -> dict[str, int]:
        values = self._record_values(account_id, payload)
        fingerprint = hashlib.sha256(json.dumps({"target": record_id, "values": values}, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        def replay():
            saved = self.store.get_save_request(account_id, payload.request_id)
            if saved is None:
                return None
            if saved["fingerprint"] != fingerprint:
                raise SavedWorkspaceConflictError("This save request ID was already used with different content.")
            return {"id": int(saved["record_id"]), "record_version": int(saved["record_version"])}
        previous = replay()
        if previous:
            return previous
        timestamp = self.clock().isoformat()
        try:
            if record_id is None:
                record_id = self.store.create_record(account_id, values, timestamp)
                version = 1
            else:
                if not self.store.update_record(account_id, record_id, values, timestamp):
                    if self.store.get_record(account_id, record_id) is None:
                        raise SavedWorkspaceNotFoundError("Saved query record not found.")
                    raise SavedWorkspaceConflictError("This archive was changed in another window. Reload it or save as new.")
                version = payload.expected_record_version + 1
            self.store.remember_save_request(account_id, payload.request_id, fingerprint, record_id, version, timestamp)
            self.store.commit()
            return {"id": record_id, "record_version": version}
        except Exception:
            self.store.rollback()
            previous = replay()
            if previous:
                return previous
            raise

    def delete_record(self, account_id: int, record_id: int) -> None:
        try:
            if not self.store.delete_record(account_id, record_id):
                raise SavedWorkspaceNotFoundError("Saved query record not found.")
            self.store.commit()
        except Exception:
            self.store.rollback()
            raise

    def list_categories(self, account_id: int) -> list[dict[str, Any]]:
        return self.store.list_categories(account_id)

    def create_category(self, account_id: int, name: str) -> int:
        try:
            category_id = self.store.create_category(account_id, name, self.clock().isoformat())
            self.store.commit()
            return category_id
        except Exception:
            self.store.rollback()
            raise

    def rename_category(self, account_id: int, category_id: int, name: str) -> None:
        try:
            if not self.store.rename_category(account_id, category_id, name, self.clock().isoformat()):
                raise SavedWorkspaceNotFoundError("Query category not found.")
            self.store.commit()
        except Exception:
            self.store.rollback()
            raise

    def delete_category(self, account_id: int, category_id: int) -> None:
        try:
            if not self.store.delete_category(account_id, category_id):
                raise SavedWorkspaceNotFoundError("Query category not found.")
            self.store.commit()
        except Exception:
            self.store.rollback()
            raise

    def _record_values(self, account_id: int, payload: SaveQueryPayload) -> dict[str, Any]:
        schema_version = payload.snapshot.get("schemaVersion")
        if schema_version != SAVED_WORKSPACE_SNAPSHOT_VERSION:
            raise SavedWorkspaceValidationError(
                f"Unsupported saved workspace snapshot schemaVersion: {schema_version!r}."
            )
        try:
            document = CanvasDocument.model_validate(payload.snapshot)
            # Also reject non-finite values inside biological metadata and drafts.
            snapshot_json = json.dumps(document.model_dump(mode="json", exclude_unset=True), separators=(",", ":"), allow_nan=False)
        except (ValidationError, ValueError, TypeError) as error:
            raise SavedWorkspaceValidationError(f"Invalid canvas archive: {error}") from error
        if (document.dataset.speciesTree, document.dataset.genomeDatabase, document.dataset.datasetRevision) != (payload.species_tree, payload.genome_database, payload.dataset_revision):
            raise SavedWorkspaceValidationError("The archive and record dataset identities differ.")
        if payload.category_id is not None and not self.store.category_belongs_to_account(account_id, payload.category_id):
            raise SavedWorkspaceValidationError("Query category does not belong to this account.")
        current_revision = self.datasets.current_revision(payload.species_tree, payload.genome_database)
        if current_revision is None:
            raise SavedWorkspaceValidationError("The selected dataset is not available.")
        if current_revision != payload.dataset_revision:
            raise SavedWorkspaceValidationError("The selected dataset revision changed before the workspace was saved.")
        try:
            self.datasets.validate_document(document)
        except ValueError as error:
            raise SavedWorkspaceValidationError(str(error)) from error
        return {
            "category_id": payload.category_id,
            "title": payload.title,
            "species_tree": payload.species_tree,
            "genome_database": payload.genome_database,
            "dataset_revision": payload.dataset_revision,
            "snapshot_json": snapshot_json,
            "expected_record_version": payload.expected_record_version,
        }

