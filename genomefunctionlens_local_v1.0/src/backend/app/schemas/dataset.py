from pydantic import BaseModel


class DatasetItem(BaseModel):
    species_tree: str
    genome_database: str
    label: str
    available: bool = True
    tree_core_path: str | None = None
    tree_core_format: str | None = None
    node_count: int | None = None
    leaf_count: int | None = None
    genome_count: int | None = None
    dataset_revision: str


class DatasetResponse(BaseModel):
    genome_databases: list[str]
    species_trees: list[str]
    annotation_types: list[str]
    datasets: list[DatasetItem]
