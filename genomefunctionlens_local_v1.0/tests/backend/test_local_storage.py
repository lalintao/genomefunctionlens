from pathlib import Path

from app.adapters.local_saved_query_store import LocalSavedQueryStore
from app.schemas.download import DownloadRequest, DownloadResponse
from app.services.download_task_service import DownloadJobs


def record_payload(version: int | None = None) -> dict[str, object]:
    return {
        "expected_record_version": version,
        "category_id": None,
        "title": "Test query",
        "species_tree": "tree",
        "genome_database": "genome",
        "dataset_revision": "revision",
        "snapshot_json": "{\"schemaVersion\":3}",
    }


def test_saved_query_store_round_trip(tmp_path: Path) -> None:
    store = LocalSavedQueryStore(tmp_path / "saved_queries")
    category_id = store.create_category(1, "Examples", "2026-01-01T00:00:00+00:00")
    payload = record_payload()
    payload["category_id"] = category_id

    record_id = store.create_record(1, payload, "2026-01-01T00:00:01+00:00")
    store.remember_save_request(1, "request-1", "fingerprint", record_id, 1, "2026-01-01T00:00:01+00:00")
    store.commit()

    record = store.get_record(1, record_id)
    assert record is not None
    assert record["title"] == "Test query"
    assert record["snapshot_json"] == "{\"schemaVersion\":3}"
    assert store.get_save_request(1, "request-1")["record_id"] == record_id
    assert store.category_belongs_to_account(1, category_id)

    listed = store.list_records(1)
    assert [item["id"] for item in listed] == [record_id]

    assert store.update_record(
        1,
        record_id,
        {**record_payload(1), "title": "Updated", "category_id": category_id},
        "2026-01-01T00:00:02+00:00",
    )
    assert store.get_record(1, record_id)["record_version"] == 2
    assert store.delete_category(1, category_id)
    assert store.get_record(1, record_id)["category_id"] is None
    assert store.delete_record(1, record_id)


def test_file_backed_download_jobs(tmp_path: Path) -> None:
    jobs = DownloadJobs(
        root=tmp_path / "jobs",
        archive_root=tmp_path / "archive",
    )
    jobs.record_worker_heartbeat("test-worker")
    assert jobs.is_worker_available()

    payload = DownloadRequest.model_validate(
        {
            "species_tree": "tree",
            "genome_database": "genome",
            "branches": [{"branch_id": "all", "node_id": 0}],
            "columns": [{"annotation_type": "cog", "annotation_value": "COG0001"}],
            "header_fields": [],
            "download_mode": "all",
        }
    )
    started = jobs.submit(payload)
    claimed = jobs.claim_next()
    assert claimed is not None
    assert claimed.task_id == started.task_id

    jobs.update_progress(started.task_id, 1, 1)
    archive = tmp_path / "archive" / f"{started.task_id}.zip"
    archive.write_bytes(b"PK")
    assert jobs.mark_ready(
        started.task_id,
        DownloadResponse(
            download_url=f"/api/download/file/{started.task_id}",
            task_id=started.task_id,
            file_count=1,
        ),
    )

    status = jobs.get_status(started.task_id)
    assert status.status == "ready"
    assert status.completed_files == 1
    assert jobs.open_result(started.task_id) == archive
