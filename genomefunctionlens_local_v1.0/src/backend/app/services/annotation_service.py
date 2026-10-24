from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.schemas.annotation import AnnotationItem
from app.services.runtime_catalog import RuntimeCatalog


@dataclass(frozen=True)
class AnnotationMeta:
    annotation_id: int | None
    type: str
    value: str
    short_name: str | None
    full_name: str | None
    source: str | None
    source_version: str | None

    @property
    def label(self) -> str:
        return self.short_name or self.value


class AnnotationService:
    def __init__(self, db: Session):
        self.catalog = RuntimeCatalog(db)

    def list_annotation_types(self) -> list[str]:
        return self.catalog.list_annotation_types()

    def suggest(self, annotation_type: str, keyword: str, limit: int) -> list[AnnotationItem]:
        normalized_type = self._normalize_type(annotation_type)
        return [
            self._meta_to_item(self._record_to_meta(record))
            for record in self.catalog.suggest_annotations(normalized_type, keyword, limit)
        ]

    def resolve_one(self, annotation_type: str, query: str) -> AnnotationMeta:
        normalized_type = self._normalize_type(annotation_type)
        normalized_query = query.strip()
        if not normalized_query:
            raise HTTPException(status_code=400, detail="Annotation query cannot be empty")

        matches = self.catalog.find_exact_annotations(normalized_type, normalized_query)
        if len(matches) == 1:
            return self._record_to_meta(matches[0])
        if len(matches) > 1:
            raise HTTPException(status_code=409, detail="Annotation query matched multiple entries")

        if self._looks_like_annotation_value(normalized_type, normalized_query):
            annotation_id = self.resolve_annotation_id(normalized_type, normalized_query)
            if annotation_id is not None:
                return AnnotationMeta(
                    annotation_id=annotation_id,
                    type=normalized_type,
                    value=normalized_query.strip().upper(),
                    short_name=None,
                    full_name=None,
                    source=None,
                    source_version=None,
                )

        raise HTTPException(status_code=404, detail="Annotation not found")

    def resolve_annotation_id(self, annotation_type: str, annotation_value: str) -> int | None:
        return self.catalog.resolve_annotation_id(self._normalize_type(annotation_type), annotation_value)

    def resolve_by_id(self, annotation_type: str, annotation_id: int, query: str) -> AnnotationMeta:
        normalized_type = self._normalize_type(annotation_type)
        record = self.catalog.find_annotation_by_id(normalized_type, annotation_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Annotation not found")
        normalized_query = query.strip().casefold()
        accepted_values = {
            record.annotation_value.casefold(),
            (record.short_name or "").casefold(),
            (record.full_name or "").casefold(),
        }
        if normalized_query not in accepted_values:
            raise HTTPException(status_code=400, detail="Annotation id does not match the requested value")
        return self._record_to_meta(record)

    def _meta_to_item(self, meta: AnnotationMeta) -> AnnotationItem:
        return AnnotationItem(
            annotation_id=meta.annotation_id,
            type=meta.type,
            value=meta.value,
            label=meta.label,
            short_name=meta.short_name,
            full_name=meta.full_name,
            source=meta.source,
            source_version=meta.source_version,
        )

    def _normalize_type(self, annotation_type: str) -> str:
        return annotation_type.strip().lower()

    def _looks_like_annotation_value(self, annotation_type: str, value: str) -> bool:
        upper = value.upper()
        if annotation_type == "cog":
            return upper.startswith("COG")
        if annotation_type == "kegg":
            return upper.startswith("K")
        if annotation_type == "pfam":
            return upper.startswith("PF")
        if annotation_type == "module":
            return upper.startswith("M")
        return bool(value.strip())

    def _record_to_meta(self, record) -> AnnotationMeta:
        return AnnotationMeta(
            annotation_id=record.annotation_id,
            type=record.annotation_type,
            value=record.annotation_value,
            short_name=record.short_name,
            full_name=record.full_name,
            source=record.source,
            source_version=record.source_version,
        )
