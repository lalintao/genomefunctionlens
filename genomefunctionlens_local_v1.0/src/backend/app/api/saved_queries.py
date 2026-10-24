from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.adapters.dataset_identity_lookup import ProjectDatasetIdentityLookup
from app.adapters.local_saved_query_store import LocalSavedQueryStore
from app.config import get_settings
from app.db import get_db
from app.schemas.saved_workspace import CategoryPayload, SaveQueryPayload
from app.services.saved_workspace import (
    SavedWorkspace,
    SavedWorkspaceError,
    SavedWorkspaceNotFoundError,
    SavedWorkspaceValidationError,
)

LOCAL_ACCOUNT_ID = 1


class BoundedArchiveRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded(request: Request):
            if request.method in {"POST", "PUT"}:
                limit = get_settings().saved_workspace_max_bytes
                if request.headers.get("content-encoding", "identity") != "identity":
                    raise HTTPException(415, "Compressed archive requests are not supported.")
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > limit:
                        raise HTTPException(413, "Canvas archive exceeds the configured size limit.")
                    body.extend(chunk)
                request._body = bytes(body)
            return await handler(request)

        return bounded


router = APIRouter(prefix="/api/saved-queries", tags=["saved-queries"], route_class=BoundedArchiveRoute)


def workspace(project_db: Session) -> SavedWorkspace:
    store = LocalSavedQueryStore(get_settings().saved_queries_root)
    return SavedWorkspace(store, ProjectDatasetIdentityLookup(project_db))


def translate_error(error: Exception) -> HTTPException:
    if isinstance(error, SavedWorkspaceNotFoundError):
        return HTTPException(404, str(error))
    if isinstance(error, SavedWorkspaceValidationError):
        return HTTPException(400, str(error))
    return HTTPException(409, str(error))


@router.get("")
def list_records(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    project_db: Session = Depends(get_db),
):
    return {"items": workspace(project_db).list_records(LOCAL_ACCOUNT_ID, limit, offset)}


@router.post("")
def create_record(payload: SaveQueryPayload, project_db: Session = Depends(get_db)):
    try:
        return workspace(project_db).create_record(LOCAL_ACCOUNT_ID, payload)
    except SavedWorkspaceError as error:
        raise translate_error(error) from error


@router.put("/records/{record_id}")
def update_record(record_id: int, payload: SaveQueryPayload, project_db: Session = Depends(get_db)):
    try:
        return workspace(project_db).update_record(LOCAL_ACCOUNT_ID, record_id, payload)
    except SavedWorkspaceError as error:
        raise translate_error(error) from error


@router.delete("/records/{record_id}")
def delete_record(record_id: int, project_db: Session = Depends(get_db)):
    try:
        workspace(project_db).delete_record(LOCAL_ACCOUNT_ID, record_id)
        return {"deleted": True}
    except SavedWorkspaceError as error:
        raise translate_error(error) from error


@router.get("/categories/list")
def list_categories(project_db: Session = Depends(get_db)):
    return {"items": workspace(project_db).list_categories(LOCAL_ACCOUNT_ID)}


@router.post("/categories")
def create_category(payload: CategoryPayload, project_db: Session = Depends(get_db)):
    try:
        return {"id": workspace(project_db).create_category(LOCAL_ACCOUNT_ID, payload.name)}
    except SavedWorkspaceError as error:
        raise translate_error(error) from error


@router.put("/categories/{category_id}")
def rename_category(category_id: int, payload: CategoryPayload, project_db: Session = Depends(get_db)):
    try:
        workspace(project_db).rename_category(LOCAL_ACCOUNT_ID, category_id, payload.name)
        return {"updated": True}
    except SavedWorkspaceError as error:
        raise translate_error(error) from error


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, project_db: Session = Depends(get_db)):
    try:
        workspace(project_db).delete_category(LOCAL_ACCOUNT_ID, category_id)
        return {"deleted": True}
    except SavedWorkspaceError as error:
        raise translate_error(error) from error


@router.get("/records/{record_id}")
def get_record(record_id: int, project_db: Session = Depends(get_db)):
    try:
        return workspace(project_db).get_record(LOCAL_ACCOUNT_ID, record_id)
    except SavedWorkspaceError as error:
        raise translate_error(error) from error
