from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.search import (
    SearchColumnsResponse,
    SearchRequest,
)
from app.services.search_service import SearchService

router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("/columns", response_model=SearchColumnsResponse)
def search_columns(
    payload: SearchRequest,
    db: Session = Depends(get_db),
) -> SearchColumnsResponse:
    service = SearchService(db)
    return service.search_columns(payload)
