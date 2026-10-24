from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


HEADER_FIELDS = {"protein_name", "genome_name", "domain", "phylum", "class", "order", "family", "genus", "species"}


class DownloadBranch(BaseModel):
    branch_id: str = Field(min_length=1)
    branch_label: str | None = None
    branch_rank: str | None = None
    node_id: int | None = None
    leaf_count: int | None = None
    leaf_node_ids: list[int] = Field(default_factory=list)

    @field_validator("branch_id", "branch_label", "branch_rank")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("node_id", "leaf_count")
    @classmethod
    def validate_non_negative(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("numeric fields cannot be negative")
        return value

    @field_validator("leaf_node_ids")
    @classmethod
    def normalize_leaf_node_ids(cls, value: list[int]) -> list[int]:
        normalized: list[int] = []
        seen: set[int] = set()
        for item in value:
            if item < 0:
                raise ValueError("leaf_node_ids cannot contain negative values")
            if item not in seen:
                seen.add(item)
                normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def require_scope(self):
        if self.node_id is None and not self.leaf_node_ids:
            raise ValueError("branch must include node_id or leaf_node_ids")
        return self


class DownloadColumn(BaseModel):
    column_id: str | None = None
    annotation_id: int | None = None
    annotation_type: str = Field(min_length=1)
    annotation_value: str = Field(min_length=1)
    annotation_label: str | None = None
    module_id: str | None = None
    module_name: str | None = None
    step_id: str | None = None
    step_label: str | None = None

    @field_validator(
        "column_id",
        "annotation_type",
        "annotation_value",
        "annotation_label",
        "module_id",
        "module_name",
        "step_id",
        "step_label",
    )
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("annotation_type")
    @classmethod
    def normalize_type(cls, value: str | None) -> str:
        stripped = (value or "").lower().strip()
        if not stripped:
            raise ValueError("annotation_type cannot be empty")
        return stripped

    @field_validator("annotation_id")
    @classmethod
    def validate_annotation_id(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("annotation_id cannot be negative")
        return value


class DownloadRequest(BaseModel):
    species_tree: str = Field(min_length=1)
    genome_database: str = Field(min_length=1)
    branches: list[DownloadBranch] = Field(min_length=1)
    columns: list[DownloadColumn] = Field(min_length=1)
    header_fields: list[str] = Field(default_factory=list)
    download_mode: Literal["all", "representative"] = "all"

    @field_validator("species_tree", "genome_database")
    @classmethod
    def strip_context(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("download context cannot be empty")
        return stripped

    @field_validator("header_fields")
    @classmethod
    def normalize_header_fields(cls, value: list[str]) -> list[str]:
        fields: list[str] = []
        for item in value:
            normalized = item.strip().lower()
            if normalized and normalized in HEADER_FIELDS and normalized not in fields:
                fields.append(normalized)
        return fields


class DownloadResponse(BaseModel):
    download_url: str
    task_id: str
    file_count: int


class DownloadTaskStartResponse(BaseModel):
    task_id: str
    status: Literal["queued"] = "queued"
    status_url: str


class DownloadTaskStatusResponse(BaseModel):
    task_id: str
    status: Literal["queued", "running", "ready", "failed", "cancelled"]
    stage: Literal["queued", "preparing", "writing_files", "archiving", "ready", "failed", "cancelled"] = "queued"
    completed_files: int = 0
    total_files: int = 0
    download_url: str | None = None
    file_count: int | None = None
    error: str | None = None
