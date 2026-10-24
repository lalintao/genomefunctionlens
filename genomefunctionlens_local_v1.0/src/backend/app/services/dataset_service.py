import hashlib
import json

from sqlalchemy.orm import Session

from app.schemas.dataset import DatasetItem, DatasetResponse
from app.config import get_settings
from app.services.annotation_service import AnnotationService
from app.services.runtime_catalog import RuntimeCatalog


class DatasetService:
    def __init__(self, db: Session):
        self.catalog = RuntimeCatalog(db)
        self.annotation_service = AnnotationService(db)

    def list_datasets(self) -> DatasetResponse:
        dataset_rows = self.catalog.list_datasets()
        annotation_types = self.annotation_service.list_annotation_types()
        genome_databases = list(dict.fromkeys(row.genome_database for row in dataset_rows))
        species_trees = list(dict.fromkeys(row.species_tree for row in dataset_rows))

        datasets = [
            DatasetItem(
                species_tree=row.species_tree,
                genome_database=row.genome_database,
                label=f"{row.genome_database} / {row.species_tree}",
                available=True,
                tree_core_path=row.tree_core_path,
                tree_core_format=row.tree_core_format,
                node_count=row.node_count,
                leaf_count=row.leaf_count,
                genome_count=row.genome_count,
                dataset_revision=self.dataset_revision(row),
            )
            for row in dataset_rows
        ]

        return DatasetResponse(
            genome_databases=genome_databases,
            species_trees=species_trees,
            annotation_types=annotation_types,
            datasets=datasets,
        )

    @staticmethod
    def dataset_revision(row: object) -> str:
        settings = get_settings()

        def file_version(relative_path: str) -> dict[str, int] | None:
            try:
                stat = (settings.project_data_root / relative_path).stat()
                return {"size": stat.st_size, "modified_ns": stat.st_mtime_ns}
            except OSError:
                return None

        payload = {
            "species_tree": row.species_tree,
            "genome_database": row.genome_database,
            "tree_core_path": row.tree_core_path,
            "tree_core_format": row.tree_core_format,
            "node_count": row.node_count,
            "leaf_count": row.leaf_count,
            "genome_count": row.genome_count,
            "tree_core_file": file_version(row.tree_core_path),
            "manifest_file": file_version(settings.manifest_relative_path),
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()
