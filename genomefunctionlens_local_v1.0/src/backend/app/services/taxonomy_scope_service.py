from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.tree import (
    TreeScopeOption,
    TreeScopeOptionMember,
    TreeScopeOptionsResponse,
)
from app.services.runtime_catalog import RuntimeCatalog


PRESET_MEMBERS = {
    "archaea": ("archaea",),
    "bacteria": ("bacteria",),
    "archaea_bacteria": ("archaea", "bacteria"),
}


class TaxonomyScopeService:
    def __init__(self, db: Session):
        self.db = db
        self.catalog = RuntimeCatalog(db)

    def resolve_options(self, species_tree: str, genome_database: str) -> TreeScopeOptionsResponse:
        dataset = self.catalog.get_dataset(species_tree, genome_database)
        resolved = {
            name: self._resolve_domain(name)
            for name in {member for members in PRESET_MEMBERS.values() for member in members}
        }
        options = []
        for key, member_names in PRESET_MEMBERS.items():
            members = [resolved[name] for name in member_names]
            available = all(member is not None for member in members)
            options.append(TreeScopeOption(
                key=key,
                status="available" if available else "unavailable",
                members=[member for member in members if member is not None] if available else [],
            ))
        return TreeScopeOptionsResponse(
            species_tree=dataset.species_tree,
            genome_database=dataset.genome_database,
            options=options,
        )

    def _resolve_domain(self, normalized_name: str) -> TreeScopeOptionMember | None:
        rows = self.db.execute(
            text(
                """
                select idx.node_id, idx.taxon_name, idx.rank, count(leaf.node_id) as leaf_count
                from tree_named_taxon_index as idx
                join tree_node as scope on scope.node_id = idx.node_id
                join tree_node as leaf
                  on leaf.is_leaf = 1
                 and leaf.node_in >= scope.node_in
                 and leaf.node_in < scope.node_out
                where idx.taxon_name_norm = :name
                  and idx.rank = 'domain'
                group by idx.node_id, idx.taxon_name, idx.rank
                order by idx.node_id asc
                """
            ),
            {"name": normalized_name},
        ).mappings().all()
        if len(rows) != 1:
            return None
        row = rows[0]
        return TreeScopeOptionMember(
            node_id=int(row["node_id"]),
            taxon_name=str(row["taxon_name"]),
            rank=str(row["rank"]),
            leaf_count=int(row["leaf_count"]),
        )
