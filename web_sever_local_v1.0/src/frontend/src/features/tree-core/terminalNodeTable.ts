import type { LocalRankConstraint } from "./treeState";
import type { TreeCoreViewModel } from "./treeCoreView";

export interface TerminalNodeTableRow {
  nodeId: number;
  rank: string;
  label: string;
  collapseCeilingRank: string;
  ownedLeafNodeIds: number[];
}

interface VisibleLeafIndex {
  collect(nodeId: number): number[];
  hasVisibleLeaves(nodeId: number): boolean;
}

function createVisibleLeafIndex(tree: TreeCoreViewModel, aliveBitset: Uint8Array): VisibleLeafIndex {
  const aliveLeafCountByNode = tree.aliveLeafCountByNode(aliveBitset);

  return {
    hasVisibleLeaves(nodeId) {
      return (aliveLeafCountByNode[nodeId] ?? 0) > 0;
    },
    collect(nodeId) {
      const leaves: number[] = [];
      if (typeof tree.forEachLeafNodeId === "function") {
        tree.forEachLeafNodeId(nodeId, (leafNodeId) => {
          if (aliveBitset[leafNodeId] === 1) leaves.push(leafNodeId);
        });
      } else {
        tree.materializeLeafNodeIds(nodeId).forEach((leafNodeId) => {
          if (aliveBitset[leafNodeId] === 1) leaves.push(leafNodeId);
        });
      }
      return leaves;
    },
  };
}

function rankNodeIdsInScope(
  tree: TreeCoreViewModel,
  scopeNodeId: number,
  rank: string,
  visibleLeafIndex: VisibleLeafIndex,
) {
  const entries = tree.runtime.rankIndexes[rank] ?? [];
  const nodeIn = tree.runtime.nodeIn;
  const scopeStart = nodeIn[scopeNodeId];
  const scopeEnd = tree.runtime.nodeOut[scopeNodeId];
  let left = 0;
  let right = entries.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (nodeIn[entries[middle].nodeId] < scopeStart) left = middle + 1;
    else right = middle;
  }
  const nodeIds: number[] = [];
  for (let index = left; index < entries.length; index += 1) {
    const nodeId = entries[index].nodeId;
    if (nodeIn[nodeId] >= scopeEnd) break;
    if (visibleLeafIndex.hasVisibleLeaves(nodeId)) nodeIds.push(nodeId);
  }
  return nodeIds;
}

/**
 * Replaces one terminal scope while discarding rows that no longer own any
 * living leaf. This keeps manual expand/collapse edits inside the current
 * canvas bitmap even when a bitmap update and the derived table update render
 * in separate React passes.
 */
export function replaceTerminalRowsForScope(
  tree: TreeCoreViewModel,
  aliveBitset: Uint8Array,
  currentRows: readonly TerminalNodeTableRow[],
  scopeNodeId: number,
  replacementRows: readonly TerminalNodeTableRow[],
) {
  const activeRows = currentRows.filter((row) => (
    row.ownedLeafNodeIds.some((leafNodeId) => aliveBitset[leafNodeId] === 1)
  ));
  const nextRows = [
    ...activeRows.filter((row) => !tree.isAncestorOf(scopeNodeId, row.nodeId)),
    ...replacementRows,
  ];
  const byNodeId = new Map(nextRows.map((row) => [row.nodeId, row]));
  return {
    removedRows: activeRows.filter((row) => tree.isAncestorOf(scopeNodeId, row.nodeId)),
    rows: Array.from(byNodeId.values())
      .filter((row) => row.ownedLeafNodeIds.some((leafNodeId) => aliveBitset[leafNodeId] === 1))
      .sort((left, right) => tree.runtime.nodeIn[left.nodeId] - tree.runtime.nodeIn[right.nodeId]),
  };
}

/** Keeps the current terminal cut and only applies the rerooted DFS order. */
export function reorderTerminalRowsAfterReroot(
  tree: TreeCoreViewModel,
  aliveBitset: Uint8Array,
  currentRows: readonly TerminalNodeTableRow[],
) {
  const rows = currentRows
    .map((row) => ({
      ...row,
      ownedLeafNodeIds: row.ownedLeafNodeIds.filter((leafNodeId) => aliveBitset[leafNodeId] === 1),
    }))
    .filter((row) => row.ownedLeafNodeIds.length > 0);
  const invalid = rows.find((row) => row.ownedLeafNodeIds.some((leafNodeId) => !tree.isAncestorOf(row.nodeId, leafNodeId)));
  if (invalid) {
    throw new Error(`Rerooting this branch would split visible terminal node ${invalid.nodeId}.`);
  }
  return rows.sort((left, right) => tree.runtime.nodeIn[left.nodeId] - tree.runtime.nodeIn[right.nodeId]);
}

/** Build the replacement terminal rows for one canvas scope. */
export function buildTerminalRowsForScope(
  tree: TreeCoreViewModel,
  aliveBitset: Uint8Array,
  scopeNodeId: number,
  targetRank: string,
  collapseCeilingRank: string,
  customLabel?: string,
) {
  return buildTerminalRowsForScopeWithIndex(
    tree,
    scopeNodeId,
    targetRank,
    collapseCeilingRank,
    customLabel,
    createVisibleLeafIndex(tree, aliveBitset),
  );
}

function buildTerminalRowsForScopeWithIndex(
  tree: TreeCoreViewModel,
  scopeNodeId: number,
  targetRank: string,
  collapseCeilingRank: string,
  customLabel: string | undefined,
  visibleLeafIndex: VisibleLeafIndex,
  materializeLeaves = true,
) {
  const visibleLeavesFor = (nodeId: number) => visibleLeafIndex.collect(nodeId);
  const targetNodeIds = customLabel || tree.runtime.taxonNameByRankAndNode[targetRank]?.has(scopeNodeId)
    ? [scopeNodeId]
    : rankNodeIdsInScope(tree, scopeNodeId, targetRank, visibleLeafIndex);
  const rows = targetNodeIds.map((nodeId): TerminalNodeTableRow => ({
    nodeId,
    rank: targetRank,
    label: customLabel ?? tree.runtime.taxonNameByRankAndNode[targetRank]?.get(nodeId) ?? tree.sourceLabel(nodeId, targetRank),
    collapseCeilingRank,
    ownedLeafNodeIds: materializeLeaves ? visibleLeavesFor(nodeId) : [],
  }));
  if (rows.length) return rows;
  return visibleLeavesFor(scopeNodeId).map((nodeId): TerminalNodeTableRow => ({
    nodeId,
    rank: "species",
    label: tree.runtime.taxonNameByRankAndNode.species?.get(nodeId) ?? tree.sourceLabel(nodeId, "species"),
    collapseCeilingRank,
    ownedLeafNodeIds: [nodeId],
  }));
}

/**
 * Builds classification terminals from taxon bindings.  The original tree is
 * only used to test subtree membership and to keep DFS order; it never decides
 * which taxonomic rank should be displayed.
 */
export function buildTerminalNodeTable(
  tree: TreeCoreViewModel,
  aliveBitset: Uint8Array,
  displayRank: string,
  localRankConstraints: readonly LocalRankConstraint[],
  viewRootNodeId: number | null,
) {
  const rootNodeId = viewRootNodeId ?? tree.rootId;
  const visibleLeafIndex = createVisibleLeafIndex(tree, aliveBitset);
  const hasVisibleLeaves = (nodeId: number) => visibleLeafIndex.hasVisibleLeaves(nodeId);
  const inScope = (nodeId: number) => tree.isAncestorOf(rootNodeId, nodeId) && hasVisibleLeaves(nodeId);

  const baseRows = buildTerminalRowsForScopeWithIndex(
    tree,
    rootNodeId,
    displayRank,
    displayRank,
    undefined,
    visibleLeafIndex,
    false,
  );
  const activeOverrides = localRankConstraints
    .filter((override) => inScope(override.nodeId))
    .sort((left, right) => tree.runtime.nodeIn[left.nodeId] - tree.runtime.nodeIn[right.nodeId]);

  let rows = baseRows;
  activeOverrides.forEach((override) => {
    // A local rule may refine a terminal that originated from the global
    // rank.  The whole former terminal scope must then move to the same
    // target rank: keeping its coarse row would make its leaf range overlap
    // the newly detailed rows.  This produces a disjoint terminal cut.
    const coveringTerminal = rows.find((row) => tree.isAncestorOf(row.nodeId, override.nodeId));
    const scopeNodeId = coveringTerminal?.nodeId ?? override.nodeId;
    const ceilingRank = coveringTerminal?.collapseCeilingRank ?? displayRank;
    rows = rows.filter((row) => !tree.isAncestorOf(scopeNodeId, row.nodeId));
    rows.push(...buildTerminalRowsForScopeWithIndex(
      tree,
      scopeNodeId,
      override.expandRank,
      ceilingRank,
      undefined,
      visibleLeafIndex,
      false,
    ));
  });

  const byNodeId = new Map<number, TerminalNodeTableRow>();
  rows.forEach((row) => byNodeId.set(row.nodeId, row));
  return Array.from(byNodeId.values())
    .filter((row) => visibleLeafIndex.hasVisibleLeaves(row.nodeId))
    .map((row) => ({
      ...row,
      ownedLeafNodeIds: row.ownedLeafNodeIds.length ? row.ownedLeafNodeIds : visibleLeafIndex.collect(row.nodeId),
    }))
    .sort((left, right) => tree.runtime.nodeIn[left.nodeId] - tree.runtime.nodeIn[right.nodeId]);
}
