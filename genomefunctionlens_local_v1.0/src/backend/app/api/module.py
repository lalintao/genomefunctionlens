from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.module import (
    ModuleExpandMember,
    ModuleExpandRequest,
    ModuleExpandResponse,
    ModuleSuggestItem,
    ModuleSuggestResponse,
)
from app.services.module_service import ModuleService

router = APIRouter(prefix="/api/modules", tags=["modules"])


@router.get("/suggest", response_model=ModuleSuggestResponse)
def suggest_modules(
    type: str = Query(..., min_length=1),
    keyword: str = Query("", min_length=0),
    limit: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
) -> ModuleSuggestResponse:
    service = ModuleService(db)
    items = service.suggest(query_type=type, keyword=keyword, limit=limit)
    return ModuleSuggestResponse(
        items=[
            ModuleSuggestItem(
                module_id=item.module_id,
                module_name=item.module_name,
                aliases=item.aliases,
                label=f"{item.module_id} {item.module_name}",
            )
            for item in items
        ]
    )


@router.post("/expand", response_model=ModuleExpandResponse)
def expand_module(
    payload: ModuleExpandRequest,
    db: Session = Depends(get_db),
) -> ModuleExpandResponse:
    service = ModuleService(db)
    expanded = service.expand_module(payload.module_id)
    return ModuleExpandResponse(
        module_id=expanded.module_id,
        module_name=expanded.module_name,
        members=[
            ModuleExpandMember(
                annotation_id=member.annotation_id,
                annotation_value=member.annotation_value,
                label=member.short_name or member.annotation_value,
                short_name=member.short_name,
                full_name=member.full_name,
                display_order=member.display_order,
            )
            for member in expanded.members
        ],
    )
