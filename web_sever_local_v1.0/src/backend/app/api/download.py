from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.schemas.download import DownloadRequest, DownloadTaskStartResponse, DownloadTaskStatusResponse
from app.services.download_task_service import DownloadJobs, WORKER_UNAVAILABLE_ERROR, download_jobs

router = APIRouter(prefix="/api/download", tags=["download"])


def get_download_jobs() -> DownloadJobs:
    return download_jobs


DownloadJobsDependency = Annotated[DownloadJobs, Depends(get_download_jobs)]


@router.post(
    "/sequences",
    response_model=DownloadTaskStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def download_sequences(
    payload: DownloadRequest,
    jobs: DownloadJobsDependency,
) -> DownloadTaskStartResponse:
    if not jobs.is_worker_available():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, WORKER_UNAVAILABLE_ERROR)
    return jobs.submit(payload)


@router.get("/status/{task_id}", response_model=DownloadTaskStatusResponse)
def download_status(task_id: str, jobs: DownloadJobsDependency) -> DownloadTaskStatusResponse:
    jobs.fail_unclaimed_if_worker_unavailable(task_id)
    task = jobs.get_status(task_id)
    if task.status != "ready":
        return task
    return task.model_copy(update={"download_url": f"/api/download/file/{task_id}"})


@router.delete("/status/{task_id}", response_model=DownloadTaskStatusResponse)
def cancel_download(task_id: str, jobs: DownloadJobsDependency) -> DownloadTaskStatusResponse:
    return jobs.cancel(task_id)


@router.get("/file/{task_id}")
def download_file(task_id: str, jobs: DownloadJobsDependency) -> FileResponse:
    if not task_id.startswith("task_") or "/" in task_id or "\\" in task_id:
        raise HTTPException(404, "Download not found.")
    archive = jobs.open_result(task_id)
    return FileResponse(
        archive,
        media_type="application/zip",
        filename=archive.name,
        headers={"Cache-Control": "no-store"},
    )
