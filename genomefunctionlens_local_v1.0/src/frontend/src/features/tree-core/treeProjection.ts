import type { TreeLayoutNode, VisibleRow } from "../result/resultTypes";
import { RECT_TREE_ROOT_X } from "../result/resultVisualConstants";
import type { TerminalNodeTableRow } from "./terminalNodeTable";
import type { TreeCoreViewModel } from "./treeCoreView";
import { buildVisibleTreeTopology, type VisibleTreeTopology } from "./visibleTreeTopology";

export interface TreeProjection {
  terminalNodeTable: TerminalNodeTableRow[];
  visibleTopology: VisibleTreeTopology;
  treeLayoutNodes: TreeLayoutNode[];
  visibleRows: VisibleRow[];
  terminalNodeIds: number[];
}

/**
 * The sole bridge from tree state to drawing data.  Keeping this pure makes
 * state changes deterministic and prevents the canvas from becoming a source
 * of tree truth.
 */
export function buildTreeProjection(
  tree: TreeCoreViewModel,
  aliveBitset: Uint8Array,
  terminalNodeTable: readonly TerminalNodeTableRow[],
  viewRootNodeId: number | null,
  rowHeight: number,
): TreeProjection {
  const currentTerminalNodeTable = Array.from(terminalNodeTable);
  const terminalByNodeId = new Map(currentTerminalNodeTable.map((row) => [row.nodeId, row]));
  const terminalNodeIds = currentTerminalNodeTable.map((row) => row.nodeId);
  const visibleTopology = buildVisibleTreeTopology(tree, aliveBitset, terminalNodeIds, viewRootNodeId);

  const treeLayoutNodes = visibleTopology.nodes.map((topologyNode): TreeLayoutNode => {
    const terminal = terminalByNodeId.get(topologyNode.originalNodeId);
    const parent = topologyNode.parent === null ? null : visibleTopology.nodes[topologyNode.parent];
    const cumulativeLength = tree.cumulativeBranchLengthOf(topologyNode.originalNodeId);
    const ownedLeafNodeIds = terminal?.ownedLeafNodeIds;
    const aliveLeafCount = ownedLeafNodeIds?.length ?? 0;
    return {
      id: topologyNode.id,
      nodeId: topologyNode.originalNodeId,
      kind: terminal ? "terminal" : "internal",
      rank: terminal?.rank ?? tree.exactTaxonRank(topologyNode.originalNodeId),
      label: terminal?.label ?? tree.sourceLabel(topologyNode.originalNodeId),
      parent: topologyNode.parent,
      children: topologyNode.children,
      x: cumulativeLength,
      y: 0,
      branchLength: parent ? Math.max(0, cumulativeLength - tree.cumulativeBranchLengthOf(parent.originalNodeId)) : 0,
      cumulativeLength,
      nodePath: topologyNode.nodePath,
      speciesCount: aliveLeafCount,
      genomeCount: aliveLeafCount,
      ownedLeafNodeIds,
      aliveLeafCount,
    };
  });

  for (let index = treeLayoutNodes.length - 1; index >= 0; index -= 1) {
    const node = treeLayoutNodes[index];
    if (node.kind === "terminal") continue;
    node.aliveLeafCount = node.children.reduce((sum, childId) => sum + treeLayoutNodes[childId].aliveLeafCount, 0);
    node.speciesCount = node.aliveLeafCount;
    node.genomeCount = node.aliveLeafCount;
  }

  const terminals = treeLayoutNodes.filter((node) => node.kind === "terminal");
  terminals.forEach((node, index) => {
    node.y = index;
  });
  for (let index = treeLayoutNodes.length - 1; index >= 0; index -= 1) {
    const node = treeLayoutNodes[index];
    if (!node.children.length) continue;
    node.y = node.children.reduce((sum, childId) => sum + treeLayoutNodes[childId].y, 0) / node.children.length;
  }
  const maxBranch = Math.max(0.0001, tree.maxCumulativeBranchLength || 1);
  treeLayoutNodes.forEach((node) => {
    node.x = RECT_TREE_ROOT_X + node.cumulativeLength * 330 / maxBranch;
    node.y = node.y * rowHeight + rowHeight / 2;
  });

  const visibleRows = terminals.map((node): VisibleRow => ({
    id: `terminal-${node.nodeId}-${node.rank ?? "node"}`,
    kind: "terminal",
    nodeId: node.nodeId,
    rank: node.rank,
    label: node.label,
    collapseCeilingRank: terminalByNodeId.get(node.nodeId)?.collapseCeilingRank ?? node.rank ?? "species",
    ownedLeafNodeIds: node.ownedLeafNodeIds ?? [],
    y: node.y - rowHeight / 2,
  }));
  return { terminalNodeTable: currentTerminalNodeTable, visibleTopology, treeLayoutNodes, visibleRows, terminalNodeIds };
}
