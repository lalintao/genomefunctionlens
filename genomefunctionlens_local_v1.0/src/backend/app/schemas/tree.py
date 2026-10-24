from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class TreeContextQuery(BaseModel):
    species_tree: str = Field(min_length=1)
    genome_database: str = Field(min_length=1)

    @field_validator("species_tree", "genome_database")
    @classmethod
    def strip_context(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("tree context cannot be empty")
        return stripped


class TreeCoreResponse(BaseModel):
    species_tree: str
    genome_database: str
    tree_core_format: str
    tree_core_download_url: str
    tree_newick_download_url: str
    node_count: int
    leaf_count: int
    genome_count: int


class TreeScopeOptionsRequest(TreeContextQuery):
    pass


class TreeScopeOptionMember(BaseModel):
    node_id: int
    taxon_name: str
    rank: str
    leaf_count: int


class TreeScopeOption(BaseModel):
    key: Literal["archaea_bacteria", "archaea", "bacteria"]
    status: Literal["available", "unavailable"]
    members: list[TreeScopeOptionMember] = Field(default_factory=list)


class TreeScopeOptionsResponse(BaseModel):
    species_tree: str
    genome_database: str
    options: list[TreeScopeOption]


class TreeScopePayload(BaseModel):
    node_ids: list[int] = Field(default_factory=list)
    leaf_node_ids: list[int] = Field(default_factory=list)
    genome_ids: list[int] = Field(default_factory=list)

    @field_validator("node_ids", "leaf_node_ids", "genome_ids")
    @classmethod
    def normalize_numeric_list(cls, value: list[int]) -> list[int]:
        normalized = []
        for item in value:
            if item < 0:
                raise ValueError("scope ids cannot be negative")
            if item not in normalized:
                normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def require_any_scope(self):
        if not self.node_ids and not self.leaf_node_ids and not self.genome_ids:
            raise ValueError("scope must include at least one node_id, leaf_node_id, or genome_id")
        return self


class GenomeFilterPayload(BaseModel):
    if_refseq: bool | None = None
    min_checkm2_completeness: float | None = None
    max_checkm2_contamination: float | None = None
    min_quality_score: float | None = None
    max_contig: int | None = None

    @field_validator("min_checkm2_completeness", "max_checkm2_contamination", "min_quality_score")
    @classmethod
    def validate_non_negative_float(cls, value: float | None) -> float | None:
        if value is not None and value < 0:
            raise ValueError("filter values cannot be negative")
        return value

    @field_validator("max_contig")
    @classmethod
    def validate_non_negative_int(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("max_contig cannot be negative")
        return value


class TreeFilterGenomesRequest(BaseModel):
    species_tree: str = Field(min_length=1)
    genome_database: str = Field(min_length=1)
    scope: TreeScopePayload
    filters: GenomeFilterPayload = Field(default_factory=GenomeFilterPayload)

    @field_validator("species_tree", "genome_database")
    @classmethod
    def strip_context(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("tree context cannot be empty")
        return stripped


class TreeFilterGenomesResponse(BaseModel):
    kept_leaf_node_ids: list[int]
    removed_leaf_node_ids: list[int]
    kept_genome_ids: list[int]
    removed_genome_ids: list[int]
    kept_leaf_count: int
    kept_genome_count: int
