from typing import Any

from pydantic import BaseModel, Field, field_validator


class SaveQueryPayload(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    expected_record_version: int | None = Field(default=None, ge=1)
    title: str = Field(min_length=1, max_length=120)
    category_id: int | None = None
    species_tree: str = Field(min_length=1)
    genome_database: str = Field(min_length=1)
    dataset_revision: str = Field(min_length=1)
    snapshot: dict[str, Any]

    @field_validator("title", "species_tree", "genome_database", "dataset_revision")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value


class CategoryPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value
