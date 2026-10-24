from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services.dataset_service import DatasetService
from app.services.runtime_catalog import RuntimeCatalog
from app.services.tree_runtime_service import TreeRuntimeService
from app.schemas.workspace_document import CanvasDocument


class ProjectDatasetIdentityLookup:
    def __init__(self, db: Session):
        self.catalog = RuntimeCatalog(db)
        self.trees = TreeRuntimeService(db)

    def validate_document(self, document: CanvasDocument) -> None:
        runtime = self.trees.get_runtime(document.dataset.speciesTree, document.dataset.genomeDatabase)
        validate_workspace_references(document, len(runtime.parent_by_node), runtime.genome_id_by_leaf_node)

    def current_revision(self, species_tree: str, genome_database: str) -> str | None:
        try:
            record = self.catalog.get_dataset(species_tree, genome_database)
        except HTTPException as error:
            if error.status_code == 404:
                return None
            raise
        return DatasetService.dataset_revision(record)


def validate_workspace_references(document: CanvasDocument, node_count: int, leaves: dict[int, int]) -> None:
    """Linear validation against the cached tree; no query per saved node."""
    def node(value):
        if value is not None and (type(value) is not int or not 0 <= value < node_count):
            raise ValueError(f"Unknown canvas node: {value}")

    def leaf(value):
        if value not in leaves:
            raise ValueError(f"Unknown canvas leaf: {value}")

    for tree in (document.tree, document.resetBaseline):
        if tree is None:
            continue
        node(tree.rerootSpec.edgeNodeIdA); node(tree.rerootSpec.edgeNodeIdB)
        node(tree.viewRootNodeId)
        for value in tree.swappedBranchNodeIds:
            node(value)
        for value in tree.aliveLeafNodeIds:
            leaf(value)
        for row in tree.terminalNodeTable:
            node(row.nodeId)
            for value in row.ownedLeafNodeIds:
                leaf(value)
        for rule in [*tree.localRankRules, *tree.localRankConstraints]:
            node(rule.nodeId)
        for value, _ in tree.customTerminalLabels:
            node(value)
    for value in document.cart.aliveLeafNodeIds:
        leaf(value)
    for record in document.cart.records:
        node(record.nodeId); node(record.ancestorNodeId)
        for value in record.leafNodeIds:
            leaf(value)
    for batch in document.cart.batches:
        node(batch.ancestorNodeId)
    for style in document.treeStyles:
        node(style.nodeId)
        for value in style.nodeIds:
            node(value)
    for style in document.heatmap.styles:
        for key in style.leafCellKeys:
            leaf(int(key.partition("::")[0]))
    node(document.view.selectedNodeId)
    node(document.drafts.nameTarget.nodeId)
    node(document.drafts.treeStyle.nodeId)
