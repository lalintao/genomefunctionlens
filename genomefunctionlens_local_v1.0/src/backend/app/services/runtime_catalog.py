import json
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session


ANNOTATION_TABLES = {
    "cog": "cog_annotation",
    "kegg": "kegg_annotation",
    "pfam": "pfam_annotation",
    "module": "module_annotation",
}


@dataclass(frozen=True)
class DatasetRecord:
    species_tree: str
    genome_database: str
    tree_newick_path: str
    tree_core_path: str
    tree_core_format: str
    node_count: int
    leaf_count: int
    genome_count: int


@dataclass(frozen=True)
class AnnotationRecord:
    annotation_id: int
    annotation_type: str
    annotation_value: str
    short_name: str | None
    full_name: str | None
    source: str | None
    source_version: str | None


@dataclass(frozen=True)
class ModuleRecord:
    annotation_id: int
    module_id: str
    short_name: str | None
    module_name: str
    module_class: str | None
    module_category: str | None
    module_subcategory: str | None
    description: str | None
    source: str | None
    source_version: str | None


@dataclass(frozen=True)
class ModuleMemberRecord:
    module_id: str
    module_annotation_id: int
    display_order: int
    ko_annotation_id: int
    ko_value: str
    ko_short_name: str | None
    ko_full_name: str | None


class RuntimeCatalog:
    def __init__(self, db: Session):
        self.db = db

    def get_dataset(self, species_tree: str, genome_database: str) -> DatasetRecord:
        row = self.db.execute(
            text(
                """
                select
                    species_tree,
                    genome_database,
                    tree_newick_path,
                    tree_core_path,
                    tree_core_format,
                    node_count,
                    leaf_count,
                    genome_count
                from tree_dataset
                where species_tree = :species_tree
                  and genome_database = :genome_database
                limit 1
                """
            ),
            {
                "species_tree": species_tree.strip(),
                "genome_database": genome_database.strip(),
            },
        ).mappings().first()
        if row is None:
            raise HTTPException(
                status_code=404,
                detail=f"Dataset not found for species_tree={species_tree}, genome_database={genome_database}",
            )
        return DatasetRecord(
            species_tree=str(row["species_tree"]),
            genome_database=str(row["genome_database"]),
            tree_newick_path=str(row["tree_newick_path"]),
            tree_core_path=str(row["tree_core_path"]),
            tree_core_format=str(row["tree_core_format"]),
            node_count=int(row["node_count"]),
            leaf_count=int(row["leaf_count"]),
            genome_count=int(row["genome_count"]),
        )

    def list_datasets(self) -> list[DatasetRecord]:
        rows = self.db.execute(
            text(
                """
                select
                    species_tree,
                    genome_database,
                    tree_newick_path,
                    tree_core_path,
                    tree_core_format,
                    node_count,
                    leaf_count,
                    genome_count
                from tree_dataset
                order by genome_database asc, species_tree asc
                """
            )
        ).mappings().all()
        return [
            DatasetRecord(
                species_tree=str(row["species_tree"]),
                genome_database=str(row["genome_database"]),
                tree_newick_path=str(row["tree_newick_path"]),
                tree_core_path=str(row["tree_core_path"]),
                tree_core_format=str(row["tree_core_format"]),
                node_count=int(row["node_count"]),
                leaf_count=int(row["leaf_count"]),
                genome_count=int(row["genome_count"]),
            )
            for row in rows
        ]

    def list_annotation_types(self) -> list[str]:
        rows = self.db.execute(
            text(
                """
                select distinct annotation_type
                from matrix_file
                where matrix_kind = 'annotation'
                order by annotation_type asc
                """
            )
        ).fetchall()
        return [str(row[0]) for row in rows]

    def list_taxonomy_domains(self) -> list[str]:
        rows = self.db.execute(
            text(
                """
                select distinct taxon_name
                from tree_named_taxon_index
                where lower(rank) = 'domain'
                order by taxon_name asc
                """
            )
        ).fetchall()
        return [str(row[0]) for row in rows]

    def suggest_annotations(
        self,
        annotation_type: str,
        keyword: str,
        limit: int,
    ) -> list[AnnotationRecord]:
        table_name = self._annotation_table(annotation_type)
        normalized_keyword = keyword.strip().lower()
        params = {
            "limit": limit,
            "exact": normalized_keyword,
            "prefix": f"{normalized_keyword}%",
        }
        where_sql = ""
        if normalized_keyword:
            params["keyword"] = f"%{normalized_keyword}%"
            where_sql = """
                where lower(annotation_value) like :keyword
                   or lower(coalesce(short_name, '')) like :keyword
                   or lower(coalesce(full_name, '')) like :keyword
                   or lower(coalesce(search_text, '')) like :keyword
            """

        rows = self.db.execute(
            text(
                f"""
                select
                    annotation_id,
                    annotation_value,
                    short_name,
                    full_name,
                    source,
                    source_version
                from {table_name}
                {where_sql}
                order by
                    case
                        when lower(annotation_value) = :exact then 0
                        when lower(coalesce(short_name, '')) = :exact then 1
                        when lower(annotation_value) like :prefix then 2
                        when lower(coalesce(short_name, '')) like :prefix then 3
                        else 4
                    end,
                    annotation_value asc
                limit :limit
                """
            ),
            params,
        ).mappings().all()
        return [self._row_to_annotation(annotation_type, row) for row in rows]

    def find_exact_annotations(
        self,
        annotation_type: str,
        query: str,
        limit: int = 2,
    ) -> list[AnnotationRecord]:
        table_name = self._annotation_table(annotation_type)
        rows = self.db.execute(
            text(
                f"""
                select
                    annotation_id,
                    annotation_value,
                    short_name,
                    full_name,
                    source,
                    source_version
                from {table_name}
                where lower(annotation_value) = :exact
                   or lower(coalesce(short_name, '')) = :exact
                   or lower(coalesce(full_name, '')) = :exact
                order by annotation_value asc
                limit :limit
                """
            ),
            {"exact": query.strip().lower(), "limit": limit},
        ).mappings().all()
        return [self._row_to_annotation(annotation_type, row) for row in rows]

    def find_annotation_by_id(
        self,
        annotation_type: str,
        annotation_id: int,
    ) -> AnnotationRecord | None:
        table_name = self._annotation_table(annotation_type)
        row = self.db.execute(
            text(
                f"""
                select
                    annotation_id,
                    annotation_value,
                    short_name,
                    full_name,
                    source,
                    source_version
                from {table_name}
                where annotation_id = :annotation_id
                limit 1
                """
            ),
            {"annotation_id": annotation_id},
        ).mappings().first()
        return self._row_to_annotation(annotation_type, row) if row is not None else None

    def resolve_annotation_id(
        self,
        annotation_type: str,
        annotation_value: str,
    ) -> int | None:
        table_name = self._annotation_table(annotation_type)
        row = self.db.execute(
            text(
                f"""
                select annotation_id
                from {table_name}
                where annotation_value = :annotation_value
                limit 1
                """
            ),
            {"annotation_value": annotation_value.strip()},
        ).first()
        return int(row.annotation_id) if row else None

    def suggest_modules(self, keyword: str, limit: int) -> list[ModuleRecord]:
        normalized_keyword = keyword.strip().lower()
        params = {
            "limit": limit,
            "exact": normalized_keyword,
            "prefix": f"{normalized_keyword}%",
        }
        where_sql = ""
        if normalized_keyword:
            params["keyword"] = f"%{normalized_keyword}%"
            where_sql = """
                where lower(annotation_value) like :keyword
                   or lower(coalesce(full_name, '')) like :keyword
                   or lower(coalesce(search_text, '')) like :keyword
            """

        rows = self.db.execute(
            text(
                f"""
                select
                    annotation_id,
                    annotation_value,
                    short_name,
                    full_name,
                    module_class,
                    module_category,
                    module_subcategory,
                    description,
                    source,
                    source_version
                from {ANNOTATION_TABLES["module"]}
                {where_sql}
                order by
                    case
                        when lower(annotation_value) = :exact then 0
                        when lower(coalesce(full_name, '')) = :exact then 1
                        when lower(annotation_value) like :prefix then 2
                        when lower(coalesce(full_name, '')) like :prefix then 3
                        else 4
                    end,
                    annotation_value asc
                limit :limit
                """
            ),
            params,
        ).mappings().all()
        return [self._row_to_module(row) for row in rows]

    def get_modules(self, module_ids: list[str]) -> list[ModuleRecord]:
        normalized_ids = self._normalize_module_ids(module_ids)
        rows = self.db.execute(
            text(
                f"""
                select
                    annotation_id,
                    annotation_value,
                    short_name,
                    full_name,
                    module_class,
                    module_category,
                    module_subcategory,
                    description,
                    source,
                    source_version
                from {ANNOTATION_TABLES["module"]}
                where annotation_value in :module_ids
                """
            ).bindparams(bindparam("module_ids", expanding=True)),
            {"module_ids": normalized_ids},
        ).mappings().all()
        found = {str(row["annotation_value"]): self._row_to_module(row) for row in rows}
        missing = [module_id for module_id in normalized_ids if module_id not in found]
        if missing:
            raise HTTPException(status_code=404, detail=f"Modules not found: {', '.join(missing)}")
        return [found[module_id] for module_id in normalized_ids]

    def get_module_members(self, module_ids: list[str]) -> dict[str, list[ModuleMemberRecord]]:
        modules = self.get_modules(module_ids)
        rows = self.db.execute(
            text(
                """
                select module_annotation_id, kegg_annotation_ids_json
                from module_kegg_member
                where module_annotation_id in :module_annotation_ids
                """
            ).bindparams(bindparam("module_annotation_ids", expanding=True)),
            {"module_annotation_ids": [module.annotation_id for module in modules]},
        ).mappings().all()
        members_by_module_annotation_id = {
            int(row["module_annotation_id"]): [
                int(value)
                for value in json.loads(row["kegg_annotation_ids_json"] or "[]")
            ]
            for row in rows
        }
        unique_ko_ids = sorted(
            {
                ko_annotation_id
                for values in members_by_module_annotation_id.values()
                for ko_annotation_id in values
            }
        )
        ko_by_id = self._load_kegg_records(unique_ko_ids)

        result: dict[str, list[ModuleMemberRecord]] = {}
        for module in modules:
            annotation_ids = members_by_module_annotation_id.get(module.annotation_id, [])
            result[module.module_id] = [
                ModuleMemberRecord(
                    module_id=module.module_id,
                    module_annotation_id=module.annotation_id,
                    display_order=index,
                    ko_annotation_id=annotation_id,
                    ko_value=str(ko_by_id[annotation_id]["annotation_value"]),
                    ko_short_name=(
                        str(ko_by_id[annotation_id]["short_name"])
                        if ko_by_id[annotation_id]["short_name"] is not None
                        else None
                    ),
                    ko_full_name=(
                        str(ko_by_id[annotation_id]["full_name"])
                        if ko_by_id[annotation_id]["full_name"] is not None
                        else None
                    ),
                )
                for index, annotation_id in enumerate(annotation_ids)
                if annotation_id in ko_by_id
            ]
        return result

    def _annotation_table(self, annotation_type: str) -> str:
        normalized_type = annotation_type.strip().lower()
        table_name = ANNOTATION_TABLES.get(normalized_type)
        if table_name is None:
            raise HTTPException(status_code=400, detail=f"Unsupported annotation type: {annotation_type}")
        return table_name

    def _normalize_module_ids(self, module_ids: list[str]) -> list[str]:
        normalized_ids = list(
            dict.fromkeys(module_id.strip().upper() for module_id in module_ids if module_id.strip())
        )
        if not normalized_ids:
            raise HTTPException(status_code=400, detail="At least one module_id is required")
        return normalized_ids

    def _load_kegg_records(self, annotation_ids: list[int]) -> dict[int, dict[str, object]]:
        if not annotation_ids:
            return {}
        rows = self.db.execute(
            text(
                f"""
                select annotation_id, annotation_value, short_name, full_name
                from {ANNOTATION_TABLES["kegg"]}
                where annotation_id in :annotation_ids
                """
            ).bindparams(bindparam("annotation_ids", expanding=True)),
            {"annotation_ids": annotation_ids},
        ).mappings().all()
        return {int(row["annotation_id"]): row for row in rows}

    def _row_to_annotation(self, annotation_type: str, row: dict[str, object]) -> AnnotationRecord:
        return AnnotationRecord(
            annotation_id=int(row["annotation_id"]),
            annotation_type=annotation_type,
            annotation_value=str(row["annotation_value"]),
            short_name=str(row["short_name"]) if row["short_name"] is not None else None,
            full_name=str(row["full_name"]) if row["full_name"] is not None else None,
            source=str(row["source"]) if row["source"] is not None else None,
            source_version=str(row["source_version"]) if row["source_version"] is not None else None,
        )

    def _row_to_module(self, row: dict[str, object]) -> ModuleRecord:
        return ModuleRecord(
            annotation_id=int(row["annotation_id"]),
            module_id=str(row["annotation_value"]),
            short_name=str(row["short_name"]) if row["short_name"] is not None else None,
            module_name=str(row["full_name"]),
            module_class=str(row["module_class"]) if row["module_class"] is not None else None,
            module_category=str(row["module_category"]) if row["module_category"] is not None else None,
            module_subcategory=str(row["module_subcategory"]) if row["module_subcategory"] is not None else None,
            description=str(row["description"]) if row["description"] is not None else None,
            source=str(row["source"]) if row["source"] is not None else None,
            source_version=str(row["source_version"]) if row["source_version"] is not None else None,
        )
