import {
  buildAliveTreeRuntime,
  createDefaultRerootSpec,
  rerootSpecsEqual,
  swapAliveTreeChildren,
} from "../tree-core/aliveTreeRuntime";
import {
  aliveBitsetFromLeafNodeIds,
  createFullAliveBitset,
  leafNodeIdsFromAliveBitset,
  removeSubtreeFromAliveBitset,
} from "../tree-core/treeBitmapState";
import type { AliveTreeRuntime, TreeCoreRuntime, TreeRerootSpec } from "../tree-core/treeCoreTypes";
import { createTreeCoreViewModel } from "../tree-core/treeCoreView";
import { defaultQueryScopeLeafNodeIds } from "../query/queryScope";
import {
  conflictingLocalRankNodeId,
  remapTaxonScopedNodesAfterReroot,
  type LocalRankConstraint,
  type LocalRankRule,
} from "../tree-core/treeState";
import {
  buildTerminalNodeTable,
  buildTerminalRowsForScope,
  reorderTerminalRowsAfterReroot,
  replaceTerminalRowsForScope,
  type TerminalNodeTableRow,
} from "../tree-core/terminalNodeTable";

export interface TreeWorkspaceSnapshot {
  runtime: AliveTreeRuntime;
  aliveBitset: Uint8Array;
  displayRank: string;
  stripRank: string;
  localRankRules: LocalRankRule[];
  localRankConstraints: LocalRankConstraint[];
  terminalNodeTable: TerminalNodeTableRow[];
  customTerminalLabels: Map<number, string>;
  viewRootNodeId: number | null;
  resetBaseline: TreeWorkspaceResetBaseline | null;
}

export type TreeWorkspaceResetBaseline = Omit<TreeWorkspaceSnapshot, "resetBaseline">;

export function captureTreeWorkspaceResetBaseline(snapshot: TreeWorkspaceSnapshot): TreeWorkspaceSnapshot {
  const { resetBaseline: _discarded, ...baseline } = snapshot;
  // Commands return new domain branches, so this is an immutable rollback
  // point and does not need another copy of the tree runtime.
  return { ...snapshot, resetBaseline: baseline };
}

export type TreeWorkspaceCommand =
  | { type: "set-global-rank"; rank: string; stripRank: string }
  | { type: "set-strip-rank"; rank: string }
  | { type: "expand-terminal"; nodeId: number; targetRank: string; collapseCeilingRank?: string }
  | { type: "collapse-node"; nodeId: number; rank: string; label?: string }
  | { type: "delete-branch"; nodeId: number }
  | { type: "apply-leaf-scope"; leafNodeIds: number[] }
  | { type: "append-leaf-scope"; leafNodeIds: number[]; localRankRules?: LocalRankRule[]; localRankConstraints?: LocalRankConstraint[] }
  | { type: "apply-cart-scope"; leafNodeIds: number[]; localRankRules: LocalRankRule[]; localRankConstraints: LocalRankConstraint[] }
  | { type: "replace-local-rules"; rules: LocalRankRule[] }
  | { type: "apply-local-rules" }
  | { type: "clear-local-rules" }
  | { type: "set-view-root"; nodeId: number | null }
  | { type: "reveal-node"; nodeId: number; targetRank: string }
  | { type: "swap-branches"; nodeId: number }
  | { type: "reroot"; rerootSpec: TreeRerootSpec }
  | { type: "reset-default-tree"; displayRank: string; stripRank: string }
  | { type: "restore-reset-baseline" };

export interface TreeWorkspaceInvalidation {
  terminalCut: boolean;
  heatmap: boolean;
  layout: boolean;
  treeStyles: boolean;
  selection: boolean;
  fitView: boolean;
}

export type TreeWorkspaceResult =
  | { accepted: true; snapshot: TreeWorkspaceSnapshot; invalidation: TreeWorkspaceInvalidation }
  | { accepted: false; snapshot: TreeWorkspaceSnapshot; rejection: string; invalidation: TreeWorkspaceInvalidation };

const NO_INVALIDATION: TreeWorkspaceInvalidation = {
  terminalCut: false,
  heatmap: false,
  layout: false,
  treeStyles: false,
  selection: false,
  fitView: false,
};

function changedInvalidation(patch: Partial<TreeWorkspaceInvalidation>): TreeWorkspaceInvalidation {
  return { ...NO_INVALIDATION, ...patch };
}

function copyRows(rows: readonly TerminalNodeTableRow[]) {
  return rows.map((row) => ({ ...row, ownedLeafNodeIds: [...row.ownedLeafNodeIds] }));
}

function copyRules<T extends LocalRankConstraint>(rules: readonly T[]): T[] {
  return rules.map((rule) => ({ ...rule }));
}

function copyRuntime(runtime: AliveTreeRuntime): AliveTreeRuntime {
  return {
    ...runtime,
    dataset: { ...runtime.dataset },
    strings: [...runtime.strings],
    ranks: [...runtime.ranks],
    parent: Int32Array.from(runtime.parent),
    nodeIn: Int32Array.from(runtime.nodeIn),
    nodeOut: Int32Array.from(runtime.nodeOut),
    rankId: Int16Array.from(runtime.rankId),
    isLeaf: Uint8Array.from(runtime.isLeaf),
    branchLength: Float64Array.from(runtime.branchLength),
    cumulativeBranchLength: Float64Array.from(runtime.cumulativeBranchLength),
    leafNameId: Int32Array.from(runtime.leafNameId),
    taxonNameId: Int32Array.from(runtime.taxonNameId),
    childrenIndex: {
      offsets: Int32Array.from(runtime.childrenIndex.offsets),
      pool: Int32Array.from(runtime.childrenIndex.pool),
    },
    rankIndexes: Object.fromEntries(Object.entries(runtime.rankIndexes).map(([rank, entries]) => [
      rank,
      entries.map((entry) => ({ ...entry })),
    ])),
    taxonNameByRankAndNode: Object.fromEntries(Object.entries(runtime.taxonNameByRankAndNode).map(([rank, names]) => [
      rank,
      new Map(names),
    ])),
    taxonBindingsByNode: new Map([...runtime.taxonBindingsByNode].map(([nodeId, bindings]) => [
      nodeId,
      bindings.map((binding) => ({ ...binding })),
    ])),
    dfsId: Int32Array.from(runtime.dfsId),
    rerootSpec: { ...runtime.rerootSpec },
  };
}

export function copyTreeWorkspaceSnapshot(snapshot: TreeWorkspaceSnapshot): TreeWorkspaceSnapshot {
  const copyBaseline = (baseline: TreeWorkspaceResetBaseline | null): TreeWorkspaceResetBaseline | null => baseline ? {
    ...baseline,
    runtime: copyRuntime(baseline.runtime),
    aliveBitset: Uint8Array.from(baseline.aliveBitset),
    localRankRules: copyRules(baseline.localRankRules),
    localRankConstraints: copyRules(baseline.localRankConstraints),
    terminalNodeTable: copyRows(baseline.terminalNodeTable),
    customTerminalLabels: new Map(baseline.customTerminalLabels),
  } : null;
  return {
    ...snapshot,
    aliveBitset: Uint8Array.from(snapshot.aliveBitset),
    localRankRules: copyRules(snapshot.localRankRules),
    localRankConstraints: copyRules(snapshot.localRankConstraints),
    terminalNodeTable: copyRows(snapshot.terminalNodeTable),
    customTerminalLabels: new Map(snapshot.customTerminalLabels),
    resetBaseline: copyBaseline(snapshot.resetBaseline),
  };
}

export function createTreeWorkspace(
  rawTree: TreeCoreRuntime,
  displayRank: string,
  stripRank: string,
): TreeWorkspaceSnapshot {
  const runtime = buildAliveTreeRuntime(rawTree, createDefaultRerootSpec(rawTree));
  const tree = createTreeCoreViewModel(runtime);
  const aliveBitset = createFullAliveBitset(tree.nodeCount);
  return {
    runtime,
    aliveBitset,
    displayRank,
    stripRank,
    localRankRules: [],
    localRankConstraints: [],
    terminalNodeTable: buildTerminalNodeTable(tree, aliveBitset, displayRank, [], null),
    customTerminalLabels: new Map(),
    viewRootNodeId: null,
    resetBaseline: null,
  };
}

function reject(snapshot: TreeWorkspaceSnapshot, rejection: string): TreeWorkspaceResult {
  return { accepted: false, snapshot, rejection, invalidation: NO_INVALIDATION };
}

function accept(
  snapshot: TreeWorkspaceSnapshot,
  invalidation: Partial<TreeWorkspaceInvalidation>,
): TreeWorkspaceResult {
  return { accepted: true, snapshot, invalidation: changedInvalidation(invalidation) };
}

function rebuildTerminalCut(snapshot: TreeWorkspaceSnapshot, patch: Partial<TreeWorkspaceSnapshot>) {
  const next = { ...snapshot, ...patch };
  const tree = createTreeCoreViewModel(next.runtime);
  return {
    ...next,
    terminalNodeTable: buildTerminalNodeTable(
      tree,
      next.aliveBitset,
      next.displayRank,
      next.localRankConstraints,
      next.viewRootNodeId,
    ),
  };
}

export function executeTreeWorkspace(
  rawTree: TreeCoreRuntime,
  snapshot: TreeWorkspaceSnapshot,
  command: TreeWorkspaceCommand,
): TreeWorkspaceResult {
  let tree: ReturnType<typeof createTreeCoreViewModel> | null = null;
  const getTree = () => tree ??= createTreeCoreViewModel(snapshot.runtime);

  switch (command.type) {
    case "restore-reset-baseline": {
      if (!snapshot.resetBaseline) return reject(snapshot, "No applied Cart baseline is available yet.");
      const restored = copyTreeWorkspaceSnapshot({
        ...snapshot.resetBaseline,
        resetBaseline: snapshot.resetBaseline,
      });
      return accept(restored, { terminalCut: true, heatmap: true, layout: true, selection: true, fitView: true });
    }
    case "set-global-rank": {
      if (!snapshot.runtime.ranks.includes(command.rank)) return reject(snapshot, `Unknown rank: ${command.rank}`);
      if (snapshot.displayRank === command.rank && snapshot.stripRank === command.stripRank) return reject(snapshot, "Tree ranks are unchanged.");
      return accept(rebuildTerminalCut(snapshot, { displayRank: command.rank, stripRank: command.stripRank }), {
        terminalCut: true, heatmap: true, layout: true, fitView: true,
      });
    }
    case "set-strip-rank":
      if (snapshot.stripRank === command.rank) return reject(snapshot, "Strip rank is unchanged.");
      return accept({ ...snapshot, stripRank: command.rank }, { layout: true });
    case "expand-terminal": {
      const tree = getTree();
      const currentRow = snapshot.terminalNodeTable.find((row) => row.nodeId === command.nodeId);
      if (!currentRow) return reject(snapshot, "The node is not a current terminal.");
      const replacement = buildTerminalRowsForScope(
        tree,
        snapshot.aliveBitset,
        command.nodeId,
        command.targetRank,
        command.collapseCeilingRank ?? currentRow.collapseCeilingRank,
      );
      const nextRows = replaceTerminalRowsForScope(tree, snapshot.aliveBitset, snapshot.terminalNodeTable, command.nodeId, replacement).rows;
      return accept({ ...snapshot, terminalNodeTable: nextRows }, { terminalCut: true, heatmap: true, layout: true });
    }
    case "collapse-node": {
      const tree = getTree();
      if (!snapshot.aliveBitset[command.nodeId]) return reject(snapshot, "The node is outside the alive tree scope.");
      const covered = snapshot.terminalNodeTable.filter((row) => tree.isAncestorOf(command.nodeId, row.nodeId));
      if (!covered.length) return reject(snapshot, "The node does not cover a current terminal.");
      const ceiling = covered.reduce((rank, row) => {
        const current = snapshot.runtime.ranks.indexOf(rank);
        const candidate = snapshot.runtime.ranks.indexOf(row.collapseCeilingRank);
        return candidate >= 0 && (current < 0 || candidate < current) ? row.collapseCeilingRank : rank;
      }, snapshot.displayRank);
      const replacement = buildTerminalRowsForScope(
        tree,
        snapshot.aliveBitset,
        command.nodeId,
        command.rank,
        ceiling,
        command.label,
      );
      const nextRows = replaceTerminalRowsForScope(tree, snapshot.aliveBitset, snapshot.terminalNodeTable, command.nodeId, replacement).rows;
      const labels = command.label
        ? new Map(snapshot.customTerminalLabels).set(command.nodeId, command.label)
        : snapshot.customTerminalLabels;
      return accept({ ...snapshot, terminalNodeTable: nextRows, customTerminalLabels: labels }, {
        terminalCut: true, heatmap: true, layout: true,
      });
    }
    case "delete-branch": {
      const tree = getTree();
      if (command.nodeId === tree.rootId) return reject(snapshot, "The root branch cannot be deleted.");
      const aliveBitset = removeSubtreeFromAliveBitset(tree, snapshot.aliveBitset, command.nodeId);
      const aliveLeafCount = tree.aliveLeafCountByNode(aliveBitset);
      const hasAliveLeaf = (nodeId: number) => aliveLeafCount[nodeId] > 0;
      const localRankRules = snapshot.localRankRules.filter((rule) => hasAliveLeaf(rule.nodeId));
      const localRankConstraints = snapshot.localRankConstraints.filter((rule) => hasAliveLeaf(rule.nodeId));
      const customTerminalLabels = new Map(
        [...snapshot.customTerminalLabels].filter(([nodeId]) => hasAliveLeaf(nodeId)),
      );
      return accept(rebuildTerminalCut(snapshot, { aliveBitset, localRankRules, localRankConstraints, customTerminalLabels }), {
        terminalCut: true, heatmap: true, layout: true, selection: true,
      });
    }
    case "apply-leaf-scope": {
      const tree = getTree();
      const aliveBitset = aliveBitsetFromLeafNodeIds(tree, command.leafNodeIds);
      const aliveLeafCount = tree.aliveLeafCountByNode(aliveBitset);
      const hasAliveLeaf = (nodeId: number) => aliveLeafCount[nodeId] > 0;
      return accept(rebuildTerminalCut(snapshot, {
        aliveBitset,
        localRankRules: snapshot.localRankRules.filter((rule) => hasAliveLeaf(rule.nodeId)),
        localRankConstraints: snapshot.localRankConstraints.filter((rule) => hasAliveLeaf(rule.nodeId)),
        customTerminalLabels: new Map([...snapshot.customTerminalLabels].filter(([nodeId]) => hasAliveLeaf(nodeId))),
      }), { terminalCut: true, heatmap: true, layout: true, selection: true });
    }
    case "append-leaf-scope": {
      const tree = getTree();
      const requested = new Set(command.leafNodeIds);
      const currentLeaves = leafNodeIdsFromAliveBitset(tree, snapshot.aliveBitset);
      const mergedLeaves = Array.from(new Set([...currentLeaves, ...requested]));
      const localRankConstraints = command.localRankConstraints?.length
        ? copyRules(command.localRankConstraints)
        : snapshot.localRankConstraints;
      const localRankRules = command.localRankRules?.length
        ? copyRules(command.localRankRules)
        : snapshot.localRankRules;
      const changedConstraints = localRankConstraints.filter((constraint) => !snapshot.localRankConstraints.some((current) => (
        current.nodeId === constraint.nodeId && current.expandRank === constraint.expandRank
      )));
      if (mergedLeaves.length === currentLeaves.length && !changedConstraints.length) {
        return reject(snapshot, "The requested query scope is already active.");
      }
      const aliveBitset = aliveBitsetFromLeafNodeIds(tree, mergedLeaves);
      let terminalNodeTable = snapshot.terminalNodeTable.map((row) => ({
        ...row,
        ownedLeafNodeIds: Array.from(new Set([
          ...row.ownedLeafNodeIds,
          ...mergedLeaves.filter((leafNodeId) => tree.isAncestorOf(row.nodeId, leafNodeId)),
        ])),
      }));
      const covered = new Set(terminalNodeTable.flatMap((row) => row.ownedLeafNodeIds));
      const additions = mergedLeaves.filter((leafNodeId) => !covered.has(leafNodeId));
      const additionRows = buildTerminalNodeTable(
        tree,
        aliveBitsetFromLeafNodeIds(tree, additions),
        snapshot.displayRank,
        localRankConstraints,
        null,
      );
      terminalNodeTable = [...terminalNodeTable, ...additionRows]
        .filter((row) => row.ownedLeafNodeIds.length > 0)
        .sort((left, right) => tree.runtime.nodeIn[left.nodeId] - tree.runtime.nodeIn[right.nodeId]);
      changedConstraints.forEach((constraint) => {
        const coveringTerminal = terminalNodeTable.find((row) => tree.isAncestorOf(row.nodeId, constraint.nodeId));
        const scopeNodeId = coveringTerminal?.nodeId ?? constraint.nodeId;
        const replacement = buildTerminalRowsForScope(
          tree,
          aliveBitset,
          scopeNodeId,
          constraint.expandRank,
          coveringTerminal?.collapseCeilingRank ?? snapshot.displayRank,
        );
        terminalNodeTable = replaceTerminalRowsForScope(
          tree,
          aliveBitset,
          terminalNodeTable,
          scopeNodeId,
          replacement,
        ).rows;
      });
      return accept({ ...snapshot, aliveBitset, localRankRules, localRankConstraints, terminalNodeTable }, {
        terminalCut: true, heatmap: true, layout: true, selection: true,
      });
    }
    case "apply-cart-scope": {
      const runtime = buildAliveTreeRuntime(rawTree, createDefaultRerootSpec(rawTree));
      const nextTree = createTreeCoreViewModel(runtime);
      const aliveBitset = aliveBitsetFromLeafNodeIds(nextTree, command.leafNodeIds);
      const next = rebuildTerminalCut(snapshot, {
        runtime,
        aliveBitset,
        localRankRules: copyRules(command.localRankRules),
        localRankConstraints: copyRules(command.localRankConstraints),
        customTerminalLabels: new Map(),
        viewRootNodeId: null,
      });
      return accept(next, {
        terminalCut: true, heatmap: true, layout: true, treeStyles: true, selection: true, fitView: true,
      });
    }
    case "replace-local-rules":
      return accept({ ...snapshot, localRankRules: copyRules(command.rules) }, {});
    case "apply-local-rules": {
      const localRankConstraints = snapshot.localRankRules
        .filter((rule) => rule.enabled)
        .map(({ enabled: _enabled, ...constraint }) => constraint);
      if (conflictingLocalRankNodeId(localRankConstraints) !== null) {
        return reject(snapshot, "Local-rank rules assign different target ranks to one tree component.");
      }
      return accept(rebuildTerminalCut(snapshot, { localRankConstraints }), {
        terminalCut: true, heatmap: true, layout: true,
      });
    }
    case "clear-local-rules":
      if (!snapshot.localRankRules.length && !snapshot.localRankConstraints.length) return reject(snapshot, "Local-rank rules are already empty.");
      return accept(rebuildTerminalCut(snapshot, { localRankRules: [], localRankConstraints: [] }), {
        terminalCut: true, heatmap: true, layout: true,
      });
    case "set-view-root":
      {
      if (snapshot.viewRootNodeId === command.nodeId) return reject(snapshot, "View root is unchanged.");
      if (command.nodeId !== null && !snapshot.aliveBitset[command.nodeId]) return reject(snapshot, "The view root is outside the alive tree scope.");
      return accept(rebuildTerminalCut(snapshot, { viewRootNodeId: command.nodeId }), {
        terminalCut: true, heatmap: true, layout: true, fitView: true,
      });
      }
    case "reveal-node": {
      const tree = getTree();
      if (!snapshot.aliveBitset[command.nodeId]) return reject(snapshot, "The node is outside the alive tree scope.");
      const viewRootNodeId = snapshot.viewRootNodeId !== null && !tree.isAncestorOf(snapshot.viewRootNodeId, command.nodeId)
        ? null
        : snapshot.viewRootNodeId;
      const containingTerminal = snapshot.terminalNodeTable.find((row) => tree.isAncestorOf(row.nodeId, command.nodeId));
      if (!containingTerminal || containingTerminal.nodeId === command.nodeId) {
        return viewRootNodeId === snapshot.viewRootNodeId
          ? reject(snapshot, "The node is already visible.")
          : accept(rebuildTerminalCut(snapshot, { viewRootNodeId }), { terminalCut: true, heatmap: true, layout: true, fitView: true });
      }
      const replacement = buildTerminalRowsForScope(
        tree,
        snapshot.aliveBitset,
        containingTerminal.nodeId,
        command.targetRank,
        containingTerminal.collapseCeilingRank,
      );
      const terminalNodeTable = replaceTerminalRowsForScope(
        tree,
        snapshot.aliveBitset,
        snapshot.terminalNodeTable,
        containingTerminal.nodeId,
        replacement,
      ).rows;
      return accept({ ...snapshot, viewRootNodeId, terminalNodeTable }, {
        terminalCut: true, heatmap: true, layout: true, fitView: true,
      });
    }
    case "swap-branches": {
      const tree = getTree();
      if (tree.childrenOf(command.nodeId).length !== 2) return reject(snapshot, "Only binary branches can be swapped.");
      try {
        const runtime = swapAliveTreeChildren(snapshot.runtime, command.nodeId);
        const terminalNodeTable = copyRows(snapshot.terminalNodeTable)
          .sort((left, right) => runtime.nodeIn[left.nodeId] - runtime.nodeIn[right.nodeId]);
        return accept({ ...snapshot, runtime, terminalNodeTable }, {
          terminalCut: true, heatmap: true, layout: true,
        });
      } catch (error) {
        return reject(snapshot, error instanceof Error ? error.message : "Could not swap this branch.");
      }
    }
    case "reroot": {
      if (snapshot.viewRootNodeId !== null) return reject(snapshot, "Reset the current view root before rerooting.");
      if (rerootSpecsEqual(snapshot.runtime.rerootSpec, command.rerootSpec)) return reject(snapshot, "The requested root is already active.");
      try {
        const runtime = buildAliveTreeRuntime(rawTree, command.rerootSpec);
        const nextTree = createTreeCoreViewModel(runtime);
        const aliveLeaves = leafNodeIdsFromAliveBitset(getTree(), snapshot.aliveBitset);
        const aliveBitset = aliveBitsetFromLeafNodeIds(nextTree, aliveLeaves);
        const aliveLeafCount = nextTree.aliveLeafCountByNode(aliveBitset);
        const includeAliveNode = (nodeId: number) => aliveLeafCount[nodeId] > 0;
        const localRankRules = remapTaxonScopedNodesAfterReroot(snapshot.runtime, runtime, snapshot.localRankRules, includeAliveNode);
        const localRankConstraints = remapTaxonScopedNodesAfterReroot(snapshot.runtime, runtime, snapshot.localRankConstraints, includeAliveNode);
        const terminalNodeTable = reorderTerminalRowsAfterReroot(nextTree, aliveBitset, snapshot.terminalNodeTable);
        return accept({
          ...snapshot,
          runtime,
          aliveBitset,
          localRankRules,
          localRankConstraints,
          terminalNodeTable,
          viewRootNodeId: null,
        }, { terminalCut: true, heatmap: true, layout: true, treeStyles: true, selection: true, fitView: true });
      } catch (error) {
        return reject(snapshot, error instanceof Error ? error.message : "Could not reroot this branch.");
      }
    }
    case "reset-default-tree": {
      const reset = createTreeWorkspace(rawTree, command.displayRank, command.stripRank);
      const resetTree = createTreeCoreViewModel(reset.runtime);
      const defaultLeafNodeIds = defaultQueryScopeLeafNodeIds(resetTree, resetTree.rootId);
      const scoped = defaultLeafNodeIds.length === resetTree.leafCount
        ? reset
        : rebuildTerminalCut(reset, {
          aliveBitset: aliveBitsetFromLeafNodeIds(resetTree, defaultLeafNodeIds),
        });
      return accept(scoped, {
        terminalCut: true, heatmap: true, layout: true, treeStyles: true, selection: true, fitView: true,
      });
    }
  }
}
