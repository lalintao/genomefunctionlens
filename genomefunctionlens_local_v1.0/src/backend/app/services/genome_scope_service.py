from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.services.tree_runtime_service import TreeRuntimeService


@dataclass(frozen=True)
class ResolvedGenomeScope:
    leaf_node_ids: list[int]
    genome_ids: list[int]


@dataclass(frozen=True)
class GenomeFilterInput:
    if_refseq: bool | None
    min_checkm2_completeness: float | None
    max_checkm2_contamination: float | None
    min_quality_score: float | None
    max_contig: int | None


@dataclass(frozen=True)
class FilteredGenomeScope:
    kept_leaf_node_ids: list[int]
    removed_leaf_node_ids: list[int]
    kept_genome_ids: list[int]
    removed_genome_ids: list[int]


class GenomeScopeService:
    def __init__(self, db: Session):
        self.db = db
        self.tree_runtime = TreeRuntimeService(db)

    def resolve_scope(
        self,
        species_tree: str,
        genome_database: str,
        *,
        node_ids: list[int],
        leaf_node_ids: list[int],
        genome_ids: list[int],
    ) -> ResolvedGenomeScope:
        resolved_leaf_node_ids: set[int] = set()
        resolved_genome_ids: set[int] = set()

        if node_ids:
            node_leaf_ids = self.tree_runtime.leaf_node_ids_for_nodes(species_tree, genome_database, node_ids)
            resolved_leaf_node_ids.update(node_leaf_ids)
            resolved_genome_ids.update(
                self.tree_runtime.genome_ids_for_leaf_nodes(species_tree, genome_database, node_leaf_ids)
            )

        if leaf_node_ids:
            normalized_leaf_node_ids = sorted(set(leaf_node_ids))
            resolved_leaf_node_ids.update(normalized_leaf_node_ids)
            resolved_genome_ids.update(
                self.tree_runtime.genome_ids_for_leaf_nodes(
                    species_tree,
                    genome_database,
                    normalized_leaf_node_ids,
                )
            )

        if genome_ids:
            normalized_genome_ids = sorted(set(genome_ids))
            resolved_genome_ids.update(normalized_genome_ids)
            resolved_leaf_node_ids.update(
                self.tree_runtime.leaf_node_ids_for_genome_ids(
                    species_tree,
                    genome_database,
                    normalized_genome_ids,
                )
            )

        if not resolved_genome_ids:
            raise HTTPException(status_code=400, detail="Scope must include at least one node, leaf, or genome id")

        return ResolvedGenomeScope(
            leaf_node_ids=sorted(resolved_leaf_node_ids),
            genome_ids=sorted(resolved_genome_ids),
        )

    def filter_scope(
        self,
        species_tree: str,
        genome_database: str,
        *,
        node_ids: list[int],
        leaf_node_ids: list[int],
        genome_ids: list[int],
        filters: GenomeFilterInput,
    ) -> FilteredGenomeScope:
        resolved_scope = self.resolve_scope(
            species_tree,
            genome_database,
            node_ids=node_ids,
            leaf_node_ids=leaf_node_ids,
            genome_ids=genome_ids,
        )
        kept_genome_ids = self._query_filtered_genomes(genome_database, resolved_scope.genome_ids, filters)
        kept_leaf_node_ids = self.tree_runtime.leaf_node_ids_for_genome_ids(
            species_tree,
            genome_database,
            kept_genome_ids,
        )
        kept_genome_id_set = set(kept_genome_ids)
        kept_leaf_node_id_set = set(kept_leaf_node_ids)

        return FilteredGenomeScope(
            kept_leaf_node_ids=kept_leaf_node_ids,
            removed_leaf_node_ids=[
                leaf_node_id
                for leaf_node_id in resolved_scope.leaf_node_ids
                if leaf_node_id not in kept_leaf_node_id_set
            ],
            kept_genome_ids=kept_genome_ids,
            removed_genome_ids=[
                genome_id
                for genome_id in resolved_scope.genome_ids
                if genome_id not in kept_genome_id_set
            ],
        )

    def _query_filtered_genomes(
        self,
        genome_database: str,
        genome_ids: list[int],
        filters: GenomeFilterInput,
    ) -> list[int]:
        if not genome_ids:
            return []

        conditions = [
            "genome_database = :genome_database",
            "genome_id in :genome_ids",
        ]
        params: dict[str, object] = {
            "genome_database": genome_database,
            "genome_ids": genome_ids,
        }

        if filters.if_refseq is not None:
            conditions.append("if_refseq = :if_refseq")
            params["if_refseq"] = 1 if filters.if_refseq else 0
        if filters.min_checkm2_completeness is not None:
            conditions.append("checkm2_completeness >= :min_checkm2_completeness")
            params["min_checkm2_completeness"] = filters.min_checkm2_completeness
        if filters.max_checkm2_contamination is not None:
            conditions.append("checkm2_contamination <= :max_checkm2_contamination")
            params["max_checkm2_contamination"] = filters.max_checkm2_contamination
        if filters.min_quality_score is not None:
            conditions.append("quality_score >= :min_quality_score")
            params["min_quality_score"] = filters.min_quality_score
        if filters.max_contig is not None:
            conditions.append("contig <= :max_contig")
            params["max_contig"] = filters.max_contig

        rows = self.db.execute(
            text(
                f"""
                select genome_id
                from genome
                where {' and '.join(conditions)}
                order by genome_id asc
                """
            ).bindparams(bindparam("genome_ids", expanding=True)),
            params,
        ).fetchall()
        return [int(row[0]) for row in rows]
