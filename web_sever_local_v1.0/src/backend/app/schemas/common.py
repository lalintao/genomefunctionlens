from pydantic import BaseModel, Field, field_validator


class AnnotationQuery(BaseModel):
    annotation_id: int | None = Field(default=None, ge=1)
    type: str = Field(min_length=1)
    value: str = Field(min_length=1)
    # A Module is useful on its own as one completeness column.  Its member
    # KOs are an optional, potentially wide expansion rather than an implicit
    # side effect of mentioning a Module.
    include_module_members: bool = False

    @field_validator("type")
    @classmethod
    def normalize_type(cls, value: str) -> str:
        stripped = value.strip().lower()
        if not stripped:
            raise ValueError("annotation type cannot be empty")
        return stripped

    @field_validator("value")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("annotation value cannot be empty")
        return stripped
