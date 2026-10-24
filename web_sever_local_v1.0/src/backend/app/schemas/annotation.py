from pydantic import BaseModel


class AnnotationItem(BaseModel):
    annotation_id: int | None = None
    type: str
    value: str
    label: str
    short_name: str | None = None
    full_name: str | None = None
    source: str | None = None
    source_version: str | None = None


class AnnotationSuggestResponse(BaseModel):
    items: list[AnnotationItem]
