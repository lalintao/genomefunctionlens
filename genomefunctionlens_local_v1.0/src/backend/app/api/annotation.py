from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.annotation import AnnotationSuggestResponse
from app.services.annotation_service import AnnotationService

router = APIRouter(prefix="/api/annotations", tags=["annotations"])


@router.get("/suggest", response_model=AnnotationSuggestResponse)
def suggest_annotations(
    type: str = Query(..., description="Annotation type, for example cog, kegg, or pfam"),
    keyword: str = Query("", description="Keyword for fuzzy match against accession, short name, or full name"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> AnnotationSuggestResponse:
    service = AnnotationService(db)
    items = service.suggest(annotation_type=type, keyword=keyword, limit=limit)
    return AnnotationSuggestResponse(items=items)
