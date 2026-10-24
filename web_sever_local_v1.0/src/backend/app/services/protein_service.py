from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.services.annotation_service import AnnotationService
from app.services.tree_runtime_service import TreeRuntimeService


class ProteinService:
    def __init__(self, db: Session):
        self.db = db
        self.annotation_service = AnnotationService(db)
        self.tree_runtime = TreeRuntimeService(db)

    def get_proteins_for_selection(
        self,
        species_tree: str,
        genome_database: str,
        leaf_node_id: int,
        annotation_type: str,
        annotation_value: str,
    ) -> list[dict[str, str]]:
        return self.get_proteins_for_annotation_scope(
            species_tree=species_tree,
            genome_database=genome_database,
            leaf_node_ids=[leaf_node_id],
            annotation_type=annotation_type,
            annotation_value=annotation_value,
        )

    def get_proteins_for_annotation_leaves(
        self,
        species_tree: str,
        genome_database: str,
        leaf_node_ids: list[int],
        annotation_type: str,
        annotation_value: str,
    ) -> list[dict[str, str]]:
        return self.get_proteins_for_annotation_scope(
            species_tree=species_tree,
            genome_database=genome_database,
            leaf_node_ids=leaf_node_ids,
            annotation_type=annotation_type,
            annotation_value=annotation_value,
        )

    def get_proteins_for_annotation_scope(
        self,
        species_tree: str,
        genome_database: str,
        annotation_type: str,
        annotation_value: str,
        annotation_id: int | None = None,
        leaf_node_ids: list[int] | None = None,
        node_ids: list[int] | None = None,
        include_all: bool = False,
    ) -> list[dict[str, str]]:
        resolved_annotation_id = self._resolve_annotation_id(annotation_type, annotation_value, annotation_id)
        if resolved_annotation_id is None:
            return []

        genome_ids = self._resolve_genome_ids(
            species_tree,
            genome_database,
            leaf_node_ids=leaf_node_ids,
            node_ids=node_ids,
            include_all=include_all,
        )
        if not genome_ids:
            return []

        rows = self.db.execute(
            self._protein_query(),
            {
                "annotation_type": annotation_type.strip().lower(),
                "annotation_id": resolved_annotation_id,
                "genome_database": genome_database,
                "genome_ids": genome_ids,
            },
        ).mappings().all()

        proteins: list[dict[str, str]] = []
        seen: set[int] = set()
        for row in rows:
            protein_key = int(row["protein_key"])
            if protein_key in seen:
                continue
            seen.add(protein_key)
            protein_name = row["protein_name"] or row["protein_id"]
            proteins.append(
                {
                    "protein_key": str(protein_key),
                    "protein_id": str(row["protein_id"]),
                    "header": str(protein_name),
                    "sequence": str(row["sequence"] or ""),
                    "leaf_node_id": str(row["leaf_node_id"]),
                }
            )
        return proteins

    def count_proteins_for_annotation_leaves(
        self,
        species_tree: str,
        genome_database: str,
        leaf_node_ids: list[int],
        annotation_type: str,
        annotation_value: str,
    ) -> int:
        return self.count_proteins_for_annotation_scope(
            species_tree=species_tree,
            genome_database=genome_database,
            leaf_node_ids=leaf_node_ids,
            annotation_type=annotation_type,
            annotation_value=annotation_value,
        )

    def count_proteins_for_annotation_scope(
        self,
        species_tree: str,
        genome_database: str,
        annotation_type: str,
        annotation_value: str,
        annotation_id: int | None = None,
        leaf_node_ids: list[int] | None = None,
        node_ids: list[int] | None = None,
        include_all: bool = False,
    ) -> int:
        resolved_annotation_id = self._resolve_annotation_id(annotation_type, annotation_value, annotation_id)
        if resolved_annotation_id is None:
            return 0

        genome_ids = self._resolve_genome_ids(
            species_tree,
            genome_database,
            leaf_node_ids=leaf_node_ids,
            node_ids=node_ids,
            include_all=include_all,
        )
        if not genome_ids:
            return 0

        return int(
            self.db.execute(
                self._count_query(),
                {
                    "annotation_type": annotation_type.strip().lower(),
                    "annotation_id": resolved_annotation_id,
                    "genome_database": genome_database,
                    "genome_ids": genome_ids,
                },
            ).scalar()
            or 0
        )

    def _resolve_annotation_id(self, annotation_type: str, annotation_value: str, annotation_id: int | None) -> int | None:
        if annotation_id is not None:
            return annotation_id
        return self.annotation_service.resolve_annotation_id(annotation_type, annotation_value)

    def _resolve_genome_ids(
        self,
        species_tree: str,
        genome_database: str,
        *,
        leaf_node_ids: list[int] | None,
        node_ids: list[int] | None,
        include_all: bool,
    ) -> list[int]:
        normalized_leaf_node_ids = list(
            dict.fromkeys(leaf_node_id for leaf_node_id in (leaf_node_ids or []) if leaf_node_id is not None and leaf_node_id >= 0)
        )
        normalized_node_ids = list(
            dict.fromkeys(node_id for node_id in (node_ids or []) if node_id is not None and node_id >= 0)
        )

        if include_all:
            rows = self.db.execute(
                text(
                    """
                    select genome_id
                    from genome
                    where genome_database = :genome_database
                    order by genome_id asc
                    """
                ),
                {"genome_database": genome_database},
            ).fetchall()
            return [int(row[0]) for row in rows]

        if normalized_leaf_node_ids:
            return self.tree_runtime.genome_ids_for_leaf_nodes(
                species_tree,
                genome_database,
                normalized_leaf_node_ids,
            )

        if normalized_node_ids:
            leaf_node_ids = self.tree_runtime.leaf_node_ids_for_nodes(
                species_tree,
                genome_database,
                normalized_node_ids,
            )
            return self.tree_runtime.genome_ids_for_leaf_nodes(
                species_tree,
                genome_database,
                leaf_node_ids,
            )

        return []

    def _protein_query(self):
        return text(
            """
            select
                p.protein_key,
                p.protein_id,
                p.protein_name,
                p.sequence,
                g.leaf_node_id
            from protein_annotation as pa
            join protein as p
              on p.protein_key = pa.protein_key
             and p.genome_id = pa.genome_id
            join genome as g
              on g.genome_id = pa.genome_id
            join tree_node as tn
              on tn.node_id = g.leaf_node_id
            where pa.annotation_type = :annotation_type
              and pa.annotation_id = :annotation_id
              and g.genome_database = :genome_database
              and pa.genome_id in :genome_ids
            order by tn.node_in asc, p.protein_name asc, p.protein_id asc
            """
        ).bindparams(bindparam("genome_ids", expanding=True))

    def _count_query(self):
        return text(
            """
            select count(distinct p.protein_key)
            from protein_annotation as pa
            join protein as p
              on p.protein_key = pa.protein_key
             and p.genome_id = pa.genome_id
            join genome as g
              on g.genome_id = pa.genome_id
            where pa.annotation_type = :annotation_type
              and pa.annotation_id = :annotation_id
              and g.genome_database = :genome_database
              and pa.genome_id in :genome_ids
            """
        ).bindparams(bindparam("genome_ids", expanding=True))
