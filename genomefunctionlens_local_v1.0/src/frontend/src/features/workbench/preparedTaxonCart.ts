import { RANKS } from "../result/resultConstants";
import type { BranchCartBatch, BranchCartRecord } from "../result/resultTypes";
import { leafNodeIdsFromAliveBitset } from "../tree-core/treeBitmapState";
import type { TreeCoreViewModel } from "../tree-core/treeCoreView";
import { createCartWorkspace, executeCartWorkspace, type CartWorkspaceSnapshot } from "./cartWorkspace";

export type PreparedTaxonMember = {
  nodeId: number;
  taxonName: string;
  taxonRank: string;
  expansionRank: string;
};

export type PreparedTaxonScope = {
  mode: "replace" | "append";
  members: PreparedTaxonMember[];
};

export type PreparedTaxonCartResult =
  | { accepted: true; snapshot: CartWorkspaceSnapshot }
  | { accepted: false; rejection: string };

function hashLeafNodeScope(leafNodeIds: number[]) {
  let hash = 0;
  leafNodeIds.forEach((leafNodeId) => {
    hash = (hash * 33 + leafNodeId) >>> 0;
    hash = (hash * 33 + 124) >>> 0;
  });
  return hash.toString(36);
}

function recordId(nodeId: number, leafNodeIds: number[], exact: boolean) {
  return exact ? `branch-cart-${nodeId}` : `branch-cart-${nodeId}-scope-${hashLeafNodeScope(leafNodeIds)}`;
}

function normalizedTaxonName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesTaxonBinding(tree: TreeCoreViewModel, member: PreparedTaxonMember) {
  const bindings = tree.runtime.taxonBindingsByNode?.get(member.nodeId) ?? [];
  if (bindings.some((binding) =>
    binding.rank === member.taxonRank
    && normalizedTaxonName(binding.taxonName) === normalizedTaxonName(member.taxonName)
  )) return true;
  // Leaf taxa and older tree-core payloads can expose a rank/name index
  // without a separate binding record. That index is still part of the
  // immutable dataset identity and is valid evidence for the same check.
  const indexedName = tree.runtime.taxonNameByRankAndNode?.[member.taxonRank]?.get(member.nodeId);
  if (indexedName !== undefined
    && normalizedTaxonName(indexedName) === normalizedTaxonName(member.taxonName)
  ) return true;
  // Minimal/legacy runtimes may report a leaf's inherited rank (or the
  // synthetic `node` rank) while retaining its canonical name under a
  // concrete rank. Do not use this fallback when explicit bindings exist:
  // those bindings are authoritative and a rank mismatch must be rejected.
  if (bindings.length) return false;
  return Object.values(tree.runtime.taxonNameByRankAndNode ?? {}).some((index) => {
    const name = index.get(member.nodeId);
    return name !== undefined && normalizedTaxonName(name) === normalizedTaxonName(member.taxonName);
  });
}

function addRecord(
  tree: TreeCoreViewModel,
  cart: CartWorkspaceSnapshot,
  nodeId: number,
  expandRank: string,
  leafNodeIds: number[],
  exact: boolean,
  scopeSource: "database" | "current_view",
  taxon?: Pick<PreparedTaxonMember, "taxonName" | "taxonRank">,
): PreparedTaxonCartResult {
  if (nodeId < 0 || nodeId >= tree.nodeCount || !leafNodeIds.length) {
    return { accepted: false, rejection: "The prepared taxon scope is invalid." };
  }
  const sourceRank = tree.branchRank(nodeId);
  if (!tree.childrenOf(nodeId).length) expandRank = sourceRank;
  // A candidate set may use one default expansion rank for several taxa.
  // Some taxa have no node at that rank, so use the first structural rank
  // available below the selected node instead of rejecting the whole batch.
  if (RANKS.indexOf(expandRank) < RANKS.indexOf(sourceRank)) expandRank = sourceRank;
  const batchId = cart.batches.reduce((max, batch) => Math.max(max, batch.id), 0) + 1;
  const rank = taxon?.taxonRank ?? tree.branchRank(nodeId, expandRank);
  const label = taxon?.taxonName || tree.sourceLabel(nodeId, rank);
  const batch: BranchCartBatch = {
    id: batchId,
    sourceType: "manual",
    ancestorNodeId: nodeId,
    ancestorLabel: label,
    ancestorRank: rank,
    expandRank,
    recordCount: 0,
  };
  const record: BranchCartRecord = {
    id: recordId(nodeId, leafNodeIds, exact),
    nodeId,
    label,
    taxonLabel: label,
    rank,
    expandRank,
    ancestorNodeId: batch.ancestorNodeId,
    ancestorLabel: batch.ancestorLabel,
    ancestorRank: batch.ancestorRank,
    path: tree.taxonomyPath(nodeId),
    leafCount: leafNodeIds.length,
    fullTreeLeafCount: tree.leafCountByNode[nodeId],
    leafNodeIds,
    isExactNodeScope: exact,
    batchId,
    sourceType: batch.sourceType,
    scopeSource,
  };
  const result = executeCartWorkspace(tree, cart, { type: "add-batch", batch, records: [record] });
  return result.accepted
    ? { accepted: true, snapshot: result.snapshot }
    : { accepted: false, rejection: result.rejection };
}

export function prepareTaxonCart(
  tree: TreeCoreViewModel,
  currentAliveBitset: Uint8Array,
  currentViewRootNodeId: number | null,
  scope: PreparedTaxonScope,
): PreparedTaxonCartResult {
  let cart = createCartWorkspace(tree);
  if (scope.mode === "append") {
    const rootNodeId = currentViewRootNodeId ?? tree.rootId;
    const visibleLeaves = leafNodeIdsFromAliveBitset(tree, currentAliveBitset);
    const rawLeaves = tree.materializeLeafNodeIds(rootNodeId);
    const current = addRecord(
      tree,
      cart,
      rootNodeId,
      tree.branchRank(rootNodeId),
      visibleLeaves,
      visibleLeaves.length === rawLeaves.length,
      "current_view",
    );
    if (!current.accepted) return current;
    cart = current.snapshot;
  }
  for (const member of scope.members) {
    if (!matchesTaxonBinding(tree, member)) {
      return { accepted: false, rejection: "The prepared taxon identity no longer matches this dataset." };
    }
    const added = addRecord(
      tree,
      cart,
      member.nodeId,
      member.expansionRank,
      tree.materializeLeafNodeIds(member.nodeId),
      true,
      "database",
      member,
    );
    if (!added.accepted) return added;
    cart = added.snapshot;
  }
  if (!cart.records.length) return { accepted: false, rejection: "The prepared taxon scope is empty." };
  return { accepted: true, snapshot: cart };
}
