from bisect import bisect_left
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.runtime_catalog import DatasetRecord, RuntimeCatalog


@dataclass(frozen=True)
class TreeArtifacts:
    dataset: DatasetRecord
    tree_core_file: Path
    tree_newick_file: Path


@dataclass
class TreeRuntime:
    dataset: DatasetRecord
    parent_by_node: tuple[int | None, ...]
    children_by_node: tuple[tuple[int, ...], ...]
    node_interval_by_node: tuple[tuple[int, int], ...]
    leaf_node_starts: tuple[int, ...]
    leaf_node_ids_in_dfs_order: tuple[int, ...]
    leaf_node_by_genome_id: tuple[int, ...]
    genome_id_by_leaf_node: dict[int, int]
    root_node_id: int

    def leaf_node_ids_for_node(self, node_id: int) -> list[int]:
        self._require_node_id(node_id)
        node_in, node_out = self.node_interval_by_node[node_id]
        start_index = bisect_left(self.leaf_node_starts, node_in)
        end_index = bisect_left(self.leaf_node_starts, node_out)
        return list(self.leaf_node_ids_in_dfs_order[start_index:end_index])

    def leaf_node_ids_for_nodes(self, node_ids: list[int]) -> list[int]:
        leaf_node_ids: set[int] = set()
        for node_id in node_ids:
            leaf_node_ids.update(self.leaf_node_ids_for_node(node_id))
        return sorted(leaf_node_ids)

    def lineage_node_ids(self, node_id: int) -> list[int]:
        self._require_node_id(node_id)
        lineage: list[int] = []
        seen: set[int] = set()
        current: int | None = node_id
        while current is not None:
            if current in seen:
                raise HTTPException(status_code=500, detail="Tree runtime contains a parent cycle")
            seen.add(current)
            lineage.append(current)
            current = self.parent_by_node[current]
        lineage.reverse()
        return lineage

    def genome_ids_for_leaf_nodes(self, leaf_node_ids: list[int]) -> list[int]:
        missing_leaf_nodes = [leaf_node_id for leaf_node_id in leaf_node_ids if leaf_node_id not in self.genome_id_by_leaf_node]
        if missing_leaf_nodes:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown leaf_node_id values: {', '.join(str(item) for item in missing_leaf_nodes[:10])}",
            )
        return sorted({self.genome_id_by_leaf_node[leaf_node_id] for leaf_node_id in leaf_node_ids})

    def leaf_node_ids_for_genome_ids(self, genome_ids: list[int]) -> list[int]:
        missing_genome_ids = [
            genome_id
            for genome_id in genome_ids
            if genome_id < 0 or genome_id >= len(self.leaf_node_by_genome_id)
        ]
        if missing_genome_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown genome_id values: {', '.join(str(item) for item in missing_genome_ids[:10])}",
            )
        return sorted({self.leaf_node_by_genome_id[genome_id] for genome_id in genome_ids})

    def _require_node_id(self, node_id: int) -> None:
        if node_id < 0 or node_id >= len(self.parent_by_node):
            raise HTTPException(status_code=400, detail=f"Unknown node_id: {node_id}")


class TreeRuntimeService:
    _runtime_cache: dict[tuple[str, str], TreeRuntime] = {}

    def __init__(self, db: Session):
        self.db = db
        self.catalog = RuntimeCatalog(db)
        self.settings = get_settings()

    def get_artifacts(self, species_tree: str, genome_database: str) -> TreeArtifacts:
        dataset = self.catalog.get_dataset(species_tree, genome_database)
        return TreeArtifacts(
            dataset=dataset,
            tree_core_file=self._resolve_project_data_path(dataset.tree_core_path),
            tree_newick_file=self._resolve_project_data_path(dataset.tree_newick_path),
        )

    def get_runtime(self, species_tree: str, genome_database: str) -> TreeRuntime:
        cache_key = (species_tree.strip(), genome_database.strip())
        runtime = self._runtime_cache.get(cache_key)
        if runtime is None:
            runtime = self._load_runtime(*cache_key)
            self._runtime_cache[cache_key] = runtime
        return runtime

    def leaf_node_ids_for_nodes(
        self,
        species_tree: str,
        genome_database: str,
        node_ids: list[int],
    ) -> list[int]:
        return self.get_runtime(species_tree, genome_database).leaf_node_ids_for_nodes(node_ids)

    def genome_ids_for_leaf_nodes(
        self,
        species_tree: str,
        genome_database: str,
        leaf_node_ids: list[int],
    ) -> list[int]:
        return self.get_runtime(species_tree, genome_database).genome_ids_for_leaf_nodes(leaf_node_ids)

    def leaf_node_ids_for_genome_ids(
        self,
        species_tree: str,
        genome_database: str,
        genome_ids: list[int],
    ) -> list[int]:
        return self.get_runtime(species_tree, genome_database).leaf_node_ids_for_genome_ids(genome_ids)

    def display_taxon_lineage(
        self, species_tree: str, genome_database: str, node_id: int,
    ) -> list[dict[str, Any]]:
        """Return display-safe named ancestors without exposing structural IDs."""
        node_ids = self.get_runtime(species_tree, genome_database).lineage_node_ids(node_id)
        statement = text(
            """
            select node_id, rank, taxon_name
            from tree_named_taxon_index
            where node_id in :node_ids
            """
        ).bindparams(bindparam("node_ids", expanding=True))
        rows = self.db.execute(statement, {"node_ids": node_ids}).mappings().all()
        bindings_by_node: dict[int, list[dict[str, str]]] = {}
        for row in rows:
            binding = {"rank": str(row["rank"]), "taxon_name": str(row["taxon_name"])}
            bindings_by_node.setdefault(int(row["node_id"]), []).append(binding)
        lineage: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for ancestor_id in node_ids:
            for binding in sorted(bindings_by_node.get(ancestor_id, []), key=lambda item: item["rank"]):
                identity = (binding["rank"].casefold(), binding["taxon_name"].casefold())
                if identity not in seen:
                    seen.add(identity)
                    lineage.append(binding)
        return lineage

    def _load_runtime(self, species_tree: str, genome_database: str) -> TreeRuntime:
        dataset = self.catalog.get_dataset(species_tree, genome_database)
        tree_rows = self.db.execute(
            text(
                """
                select node_id, parent_id, node_in, node_out, is_leaf
                from tree_node
                order by node_id asc
                """
            )
        ).mappings().all()
        genome_rows = self.db.execute(
            text(
                """
                select genome_id, leaf_node_id
                from genome
                where genome_database = :genome_database
                order by genome_id asc
                """
            ),
            {"genome_database": dataset.genome_database},
        ).mappings().all()

        parent_buffer: list[int | None] = [None] * dataset.node_count
        children_buffer: list[list[int]] = [[] for _ in range(dataset.node_count)]
        interval_buffer: list[tuple[int, int]] = [(0, 0)] * dataset.node_count
        leaf_positions: list[tuple[int, int]] = []
        root_node_id: int | None = None

        for row in tree_rows:
            node_id = int(row["node_id"])
            parent_id = int(row["parent_id"]) if row["parent_id"] is not None else None
            node_in = int(row["node_in"])
            node_out = int(row["node_out"])
            is_leaf = bool(row["is_leaf"])

            parent_buffer[node_id] = parent_id
            interval_buffer[node_id] = (node_in, node_out)
            if parent_id is None:
                root_node_id = node_id
            else:
                children_buffer[parent_id].append(node_id)
            if is_leaf:
                leaf_positions.append((node_in, node_id))

        if root_node_id is None:
            raise HTTPException(status_code=500, detail="Tree runtime is missing a root node")

        leaf_node_by_genome_id: list[int] = []
        genome_id_by_leaf_node: dict[int, int] = {}
        for row in genome_rows:
            genome_id = int(row["genome_id"])
            leaf_node_id = int(row["leaf_node_id"])
            if genome_id != len(leaf_node_by_genome_id):
                raise HTTPException(status_code=500, detail="Genome ids are not dense 0-based values")
            leaf_node_by_genome_id.append(leaf_node_id)
            genome_id_by_leaf_node[leaf_node_id] = genome_id

        leaf_positions.sort(key=lambda item: item[0])
        return TreeRuntime(
            dataset=dataset,
            parent_by_node=tuple(parent_buffer),
            children_by_node=tuple(tuple(children) for children in children_buffer),
            node_interval_by_node=tuple(interval_buffer),
            leaf_node_starts=tuple(item[0] for item in leaf_positions),
            leaf_node_ids_in_dfs_order=tuple(item[1] for item in leaf_positions),
            leaf_node_by_genome_id=tuple(leaf_node_by_genome_id),
            genome_id_by_leaf_node=genome_id_by_leaf_node,
            root_node_id=root_node_id,
        )

    def _resolve_project_data_path(self, relative_path: str) -> Path:
        path = (self.settings.project_data_root / relative_path).resolve()
        root = self.settings.project_data_root.resolve()
        if root != path and root not in path.parents:
            raise HTTPException(status_code=400, detail="Resolved path is outside project_data_root")
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Runtime asset not found: {relative_path}")
        return path
