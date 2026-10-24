from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.heatmap import HeatmapAggregateRequest, HeatmapAggregateResponse
from app.services.heatmap_aggregate_service import HeatmapAggregateService

router = APIRouter(prefix="/api/heatmap", tags=["heatmap"])


@router.post("/aggregate", response_model=HeatmapAggregateResponse)
def aggregate_heatmap(
    payload: HeatmapAggregateRequest,
    db: Session = Depends(get_db),
) -> HeatmapAggregateResponse:
    service = HeatmapAggregateService(db)
    return service.aggregate(payload)
