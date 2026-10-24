from pydantic import BaseModel, Field, field_validator

from app.schemas.common import AnnotationQuery


class HeatmapTerminalRow(BaseModel):
    node_id: int = Field(ge=0)
    owned_leaf_node_ids: list[int] = Field(min_length=1)

    @field_validator("owned_leaf_node_ids")
    @classmethod
    def normalize_owned_leaf_node_ids(cls, values: list[int]) -> list[int]:
        normalized = list(dict.fromkeys(values))
        if any(node_id < 0 for node_id in normalized):
            raise ValueError("owned_leaf_node_ids cannot contain negative values")
        return normalized


class HeatmapAggregateRequest(BaseModel):
    species_tree: str = Field(min_length=1)
    genome_database: str = Field(min_length=1)
    terminal_rows: list[HeatmapTerminalRow] = Field(min_length=1)
    annotation_columns: list[AnnotationQuery] = Field(min_length=1)
    module_completeness_threshold: float | None = Field(default=None, ge=0, le=100)

    @field_validator("species_tree", "genome_database")
    @classmethod
    def strip_context(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("heatmap context cannot be empty")
        return stripped



class HeatmapColumn(BaseModel):
    annotation_id: int | None = None
    type: str
    value: str
    label: str
    short_name: str | None = None
    full_name: str | None = None
    source: str | None = None
    source_version: str | None = None


class HeatmapAggregateResponse(BaseModel):
    species_tree: str
    genome_database: str
    row_node_ids: list[int]
    columns: list[HeatmapColumn]
    count_matrix: list[list[int]]
    species_hit_count_matrix: list[list[int]]
    ratio_matrix: list[list[float]]
    row_leaf_counts: list[int]
