from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging
import threading
from time import sleep

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.annotation import router as annotation_router
from app.api.dataset import router as dataset_router
from app.api.download import router as download_router
from app.api.heatmap import router as heatmap_router
from app.api.module import router as module_router
from app.api.saved_queries import router as saved_queries_router
from app.api.search import router as search_router
from app.api.tree import router as tree_router
from app.config import get_settings
from app.db import validate_download_performance_indexes
from app.download_worker import DownloadWorker
from app.services.download_task_service import download_jobs

settings = get_settings()
settings.ensure_runtime_directories()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    validate_download_performance_indexes()
    stop_event = threading.Event()
    worker = DownloadWorker()
    worker_thread = threading.Thread(
        target=worker.run_forever,
        args=(stop_event,),
        name="local-download-worker",
        daemon=True,
    )
    worker_thread.start()
    sleep(0.05)
    logging.getLogger("uvicorn.error").info(
        "Local saved queries: %s", settings.saved_queries_root
    )
    logging.getLogger("uvicorn.error").info(
        "Local downloads: %s", settings.download_root
    )
    try:
        yield
    finally:
        stop_event.set()
        worker_thread.join(timeout=15)


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search_router)
app.include_router(saved_queries_router)
app.include_router(tree_router)
app.include_router(heatmap_router)
app.include_router(module_router)
app.include_router(annotation_router)
app.include_router(dataset_router)
app.include_router(download_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "edition": "local"}


app.mount("/", StaticFiles(directory=settings.frontend_dist_root, html=True), name="frontend")
