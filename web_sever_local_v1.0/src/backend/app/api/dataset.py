from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.dataset import DatasetResponse
from app.services.dataset_service import DatasetService

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=DatasetResponse)
def list_datasets(db: Session = Depends(get_db)) -> DatasetResponse:
    service = DatasetService(db)
    return service.list_datasets()
