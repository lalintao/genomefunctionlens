import { DISPLAY_RANKS, RANKS } from "../result/resultConstants";
import type { TreeCoreRuntime } from "./treeCoreTypes";

const viewModelCache = new WeakMap<TreeCoreRuntime, TreeCoreViewModel>();


export interface TreeCoreViewModel {
  runtime: TreeCoreRuntime;
  rootId: number;
  nodeCount: number;
  leafCount: number;
  genomeCount: number;
  displayRanks: string[];
  maxCumulativeBranchLength: number;
  nodeIdsInDfsOrder: Int32Array;
  leafCountByNode: Int32Array;
  genomeCountByNode: Int32Array;
  aliveLeafCountByNode(aliveBitset: Uint8Array): Int32Array;
  childrenOf(nodeId: number): ArrayLike<number>;
  parentOf(nodeId: number): number;
  branchLengthOf(nodeId: number): number;
  cumulativeBranchLengthOf(nodeId: number): number;
  leafRangeOf(nodeId: number): readonly [number, number];
  forEachLeafNodeId(nodeId: number, visitor: (leafNodeId: number) => void): void;
  someLeafNodeId(nodeId: number, predicate: (leafNodeId: number) => boolean): boolean;
  countLeafNodeIds(nodeId: number, predicate?: (leafNodeId: number) => boolean): number;
  materializeLeafNodeIds(nodeId: number): number[];
  taxonomyValue(nodeId: number, rank: string): string;
  sourceName(nodeId: number): string;
  sourceLabel(nodeId: number, rank?: string | null): string;
  deepestRank(nodeId: number): string | null;
  isRankRoot(nodeId: number, rank: string): boolean;
  exactTaxonRank(nodeId: number): string | null;
  branchRank(nodeId: number, fallbackRank?: string | null): string;
  nodePathBetween(ancestorNodeId: number, nodeId: number): number[];
  taxonomyPath(nodeId: number): string;
  taxonRootForRank(nodeId: number, rank: string): number;
  isAncestorOf(ancestorNodeId: number, nodeId: number): boolean;
}

export function createTreeCoreViewModel(runtime: TreeCoreRuntime): TreeCoreViewModel {
  const cached = viewModelCache.get(runtime);
  if (cached) return cached;

  const traversalOrder = collectTraversalOrder(runtime);
  const nodeIdsInDfsOrder = Int32Array.from(traversalOrder);
  const leafCountByNode = collectLeafCounts(runtime, traversalOrder);
  const preferredNameIds = new Int32Array(runtime.nodeCount);
  const lineageByNode = collectLineage(runtime, traversalOrder, preferredNameIds);
  const leafNodeIdsInDfsOrder = Int32Array.from(traversalOrder.filter((nodeId) => runtime.isLeaf[nodeId] === 1));
  const leafNodeInDfsOrder = Int32Array.from(leafNodeIdsInDfsOrder, (nodeId) => runtime.nodeIn[nodeId]);
  const maxCumulativeBranchLength = traversalOrder.reduce(
    (maxValue, nodeId) => Math.max(maxValue, runtime.cumulativeBranchLength[nodeId] ?? 0),
    0,
  );
  // Workspace transitions replace bitmaps instead of mutating them in place.
  // The identity cache therefore reuses counts across terminal/rule derivations.
  const aliveLeafCountCache = new WeakMap<Uint8Array, Int32Array>();

  function parentOf(nodeId: number) {
    return runtime.parent[nodeId] ?? -1;
  }

  function childrenOf(nodeId: number) {
    const start = runtime.childrenIndex.offsets[nodeId] ?? 0;
    const end = runtime.childrenIndex.offsets[nodeId + 1] ?? start;
    return runtime.childrenIndex.pool.subarray(start, end);
  }

  function aliveLeafCountByNode(aliveBitset: Uint8Array) {
    if (aliveBitset.length !== runtime.nodeCount) {
      throw new Error("Alive bitset length must match the tree node count.");
    }
    const cachedCounts = aliveLeafCountCache.get(aliveBitset);
    if (cachedCounts) return cachedCounts;
    const counts = new Int32Array(runtime.nodeCount);
    for (let index = nodeIdsInDfsOrder.length - 1; index >= 0; index -= 1) {
      const nodeId = nodeIdsInDfsOrder[index];
      if (runtime.isLeaf[nodeId] === 1) {
        counts[nodeId] = aliveBitset[nodeId] === 1 ? 1 : 0;
        continue;
      }
      const start = runtime.childrenIndex.offsets[nodeId] ?? 0;
      const end = runtime.childrenIndex.offsets[nodeId + 1] ?? start;
      for (let childIndex = start; childIndex < end; childIndex += 1) {
        counts[nodeId] += counts[runtime.childrenIndex.pool[childIndex]] ?? 0;
      }
    }
    aliveLeafCountCache.set(aliveBitset, counts);
    return counts;
  }

  function lineageOffset(nodeId: number, rank: string) {
    return nodeId * RANKS.length + RANKS.indexOf(rank);
  }

  function lowerBound(values: Int32Array, target: number) {
    let left = 0;
    let right = values.length;
    while (left < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (values[middle] < target) left = middle + 1;
      else right = middle;
    }
    return left;
  }

  function leafRangeOf(nodeId: number): readonly [number, number] {
    const start = lowerBound(leafNodeInDfsOrder, runtime.nodeIn[nodeId]);
    const end = lowerBound(leafNodeInDfsOrder, runtime.nodeOut[nodeId]);
    return [start, end];
  }

  function forEachLeafNodeId(nodeId: number, visitor: (leafNodeId: number) => void) {
    const [start, end] = leafRangeOf(nodeId);
    for (let index = start; index < end; index += 1) visitor(leafNodeIdsInDfsOrder[index]);
  }

  function someLeafNodeId(nodeId: number, predicate: (leafNodeId: number) => boolean) {
    const [start, end] = leafRangeOf(nodeId);
    for (let index = start; index < end; index += 1) {
      if (predicate(leafNodeIdsInDfsOrder[index])) return true;
    }
    return false;
  }

  function countLeafNodeIds(nodeId: number, predicate?: (leafNodeId: number) => boolean) {
    const [start, end] = leafRangeOf(nodeId);
    if (!predicate) return end - start;
    let count = 0;
    for (let index = start; index < end; index += 1) {
      if (predicate(leafNodeIdsInDfsOrder[index])) count += 1;
    }
    return count;
  }

  function materializeLeafNodeIds(nodeId: number) {
    const [start, end] = leafRangeOf(nodeId);
    return Array.from(leafNodeIdsInDfsOrder.slice(start, end));
  }

  function taxonomyValue(nodeId: number, rank: string) {
    const rankIndex = RANKS.indexOf(rank);
    if (rankIndex < 0) return "";
    const stringId = lineageByNode[lineageOffset(nodeId, rank)];
    return runtime.strings[stringId] || "";
  }

  function sourceName(nodeId: number) {
    const stringId = preferredNameIds[nodeId] ?? 0;
    return runtime.strings[stringId] || "";
  }

  function deepestRank(nodeId: number) {
    for (let index = RANKS.length - 1; index >= 0; index -= 1) {
      const stringId = lineageByNode[nodeId * RANKS.length + index];
      if (stringId) return RANKS[index];
    }
    return null;
  }

  function isRankRoot(nodeId: number, rank: string) {
    const rankIndex = RANKS.indexOf(rank);
    if (rankIndex < 0) return false;
    const value = lineageByNode[nodeId * RANKS.length + rankIndex];
    if (!value || nodeId === runtime.rootId) return nodeId === runtime.rootId && Boolean(value);
    const parentId = parentOf(nodeId);
    if (parentId < 0) return true;
    return lineageByNode[parentId * RANKS.length + rankIndex] !== value;
  }

  function exactTaxonRank(nodeId: number) {
    if (!childrenOf(nodeId).length) return null;
    for (let index = RANKS.length - 2; index >= RANKS.indexOf("domain"); index -= 1) {
      const rank = RANKS[index];
      if (taxonomyValue(nodeId, rank) && isRankRoot(nodeId, rank)) return rank;
    }
    return null;
  }

  function sourceLabel(nodeId: number, rank: string | null = null) {
    const rankName = rank || deepestRank(nodeId);
    if (rankName) {
      const value = taxonomyValue(nodeId, rankName);
      if (value) return value;
    }
    return sourceName(nodeId) || `node ${nodeId}`;
  }

  function branchRank(nodeId: number, fallbackRank: string | null = null) {
    return exactTaxonRank(nodeId) ?? fallbackRank ?? deepestRank(nodeId) ?? "node";
  }

  function nodePathBetween(ancestorNodeId: number, nodeId: number) {
    const path: number[] = [];
    let current = nodeId;
    while (current >= 0) {
      path.push(current);
      if (current === ancestorNodeId) return path.reverse();
      current = parentOf(current);
    }
    return [nodeId];
  }

  function taxonomyPath(nodeId: number) {
    return RANKS.map((rank) => taxonomyValue(nodeId, rank)).filter(Boolean).join(" / ");
  }

  function taxonRootForRank(nodeId: number, rank: string) {
    const rankIndex = RANKS.indexOf(rank);
    if (rankIndex < 0) return nodeId;
    const target = lineageByNode[nodeId * RANKS.length + rankIndex];
    if (!target) return nodeId;
    let current = nodeId;
    while (current >= 0) {
      const parentId = parentOf(current);
      if (parentId < 0 || lineageByNode[parentId * RANKS.length + rankIndex] !== target) {
        return current;
      }
      current = parentId;
    }
    return nodeId;
  }

  function isAncestorOf(ancestorNodeId: number, nodeId: number) {
    return runtime.nodeIn[ancestorNodeId] <= runtime.nodeIn[nodeId]
      && runtime.nodeOut[nodeId] <= runtime.nodeOut[ancestorNodeId];
  }

  const viewModel: TreeCoreViewModel = {
    runtime,
    rootId: runtime.rootId,
    nodeCount: runtime.nodeCount,
    leafCount: runtime.leafCount,
    genomeCount: runtime.genomeCount,
    displayRanks: DISPLAY_RANKS.filter((rank) => rank === "species" || Boolean(runtime.rankIndexes[rank]?.length)),
    maxCumulativeBranchLength,
    nodeIdsInDfsOrder,
    leafCountByNode,
    genomeCountByNode: leafCountByNode,
    aliveLeafCountByNode,
    childrenOf,
    parentOf,
    branchLengthOf: (nodeId: number) => runtime.branchLength[nodeId] ?? 0,
    cumulativeBranchLengthOf: (nodeId: number) => runtime.cumulativeBranchLength[nodeId] ?? 0,
    leafRangeOf,
    forEachLeafNodeId,
    someLeafNodeId,
    countLeafNodeIds,
    materializeLeafNodeIds,
    taxonomyValue,
    sourceName,
    sourceLabel,
    deepestRank,
    isRankRoot,
    exactTaxonRank,
    branchRank,
    nodePathBetween,
    taxonomyPath,
    taxonRootForRank,
    isAncestorOf,
  };
  viewModelCache.set(runtime, viewModel);
  return viewModel;
}


function collectTraversalOrder(runtime: TreeCoreRuntime) {
  const traversalOrder: number[] = [];
  const stack = [runtime.rootId];
  while (stack.length) {
    const nodeId = stack.pop();
    if (nodeId === undefined) continue;
    traversalOrder.push(nodeId);
    const start = runtime.childrenIndex.offsets[nodeId];
    const end = runtime.childrenIndex.offsets[nodeId + 1];
    for (let index = end - 1; index >= start; index -= 1) {
      stack.push(runtime.childrenIndex.pool[index]);
    }
  }
  return traversalOrder;
}

function collectLeafCounts(
  runtime: TreeCoreRuntime,
  traversalOrder: number[],
) {
  const leafCountByNode = new Int32Array(runtime.nodeCount);
  for (let index = traversalOrder.length - 1; index >= 0; index -= 1) {
    const nodeId = traversalOrder[index];
    if (runtime.isLeaf[nodeId] === 1) {
      leafCountByNode[nodeId] = 1;
      continue;
    }
    const start = runtime.childrenIndex.offsets[nodeId] ?? 0;
    const end = runtime.childrenIndex.offsets[nodeId + 1] ?? start;
    for (let childIndex = start; childIndex < end; childIndex += 1) {
      leafCountByNode[nodeId] += leafCountByNode[runtime.childrenIndex.pool[childIndex]] ?? 0;
    }
  }
  return leafCountByNode;
}

function collectLineage(
  runtime: TreeCoreRuntime,
  traversalOrder: number[],
  preferredNameIds: Int32Array,
) {
  const lineageByNode = new Int32Array(runtime.nodeCount * RANKS.length);
  const rankIndexByName = new Map(RANKS.map((rank, index) => [rank, index]));

  traversalOrder.forEach((nodeId) => {
    const parentId = runtime.parent[nodeId] ?? -1;
    const offset = nodeId * RANKS.length;
    if (parentId >= 0) {
      const parentOffset = parentId * RANKS.length;
      for (let index = 0; index < RANKS.length; index += 1) {
        lineageByNode[offset + index] = lineageByNode[parentOffset + index];
      }
    }

    const bindings = runtime.taxonBindingsByNode.get(nodeId) ?? [];
    bindings.forEach((binding) => {
      const rankIndex = rankIndexByName.get(binding.rank) ?? -1;
      if (rankIndex >= 0 && binding.taxonNameId > 0) {
        lineageByNode[offset + rankIndex] = binding.taxonNameId;
      }
    });

    const leafNameId = runtime.leafNameId[nodeId] ?? 0;
    preferredNameIds[nodeId] = leafNameId > 0 ? leafNameId : runtime.taxonNameId[nodeId] ?? 0;
  });

  return lineageByNode;
}
