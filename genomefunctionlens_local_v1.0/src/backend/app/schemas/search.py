from pydantic import BaseModel, Field, field_validator

from app.schemas.common import AnnotationQuery


class SearchRequest(BaseModel):
    species_tree: str = Field(min_length=1)
    genome_database: str = Field(min_length=1)
    annotations: list[AnnotationQuery] = Field(min_length=1)

    @field_validator("species_tree", "genome_database")
    @classmethod
    def strip_context(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("search context cannot be empty")
        return stripped


class SearchColumn(BaseModel):
    annotation_id: int | None = None
    type: str
    value: str
    label: str
    column_id: str | None = None
    column_role: str | None = None
    short_name: str | None = None
    full_name: str | None = None
    source: str | None = None
    source_version: str | None = None
    module_id: str | None = None
    module_name: str | None = None
    step_id: str | None = None
    step_index: int | None = None
    display_order: int | None = None
    step_label: str | None = None
    step_logic: str | None = None
    step_type: str | None = None
    is_optional: bool | None = None
    raw_expression: str | None = None
    source_ast_node_id: str | None = None
    source_ir_node_id: str | None = None
    source_group_id: str | None = None
    completeness_block_id: str | None = None
    display_path: str | None = None
    semantic_path: str | None = None


class ModuleGroup(BaseModel):
    module_id: str
    module_name: str
    column_ids: list[str]
    completeness_column_id: str | None = None
    detail_column_ids: list[str] = Field(default_factory=list)
    ko_values: list[str] = Field(default_factory=list)


class SearchColumnsResponse(BaseModel):
    species_tree: str
    genome_database: str
    columns: list[SearchColumn]
    module_groups: list[ModuleGroup] = Field(default_factory=list)
