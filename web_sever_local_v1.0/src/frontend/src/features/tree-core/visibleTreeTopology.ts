import type { TreeCoreViewModel } from "./treeCoreView";
const TOPOLOGY_CACHE_LIMIT = 12;
const topologyCacheByTree = new WeakMap<TreeCoreViewModel, WeakMap<Uint8Array, Map<string, VisibleTreeTopology>>>();

export interface VisibleTreeTopologyNode {
  id: number;
  originalNodeId: number;
  parent: number | null;
  children: number[];
  nodePath: number[];
  terminal: boolean;
}

export interface VisibleTreeTopology {
  terminalNodeIds: number[];
  nodes: VisibleTreeTopologyNode[];
  nodeIdToVisibleId: Map<number, number>;
}

export function buildVisibleTreeTopology(
  tree: TreeCoreViewModel,
  aliveBitset: Uint8Array,
  terminalNodeIds: readonly number[],
  viewRootNodeId: number | null = null,
): VisibleTreeTopology {
  const cacheKey = `${viewRootNodeId ?? tree.rootId}|${terminalNodeIds.join(",")}`;
  let cacheByAliveBitset = topologyCacheByTree.get(tree);
  if (!cacheByAliveBitset) {
    cacheByAliveBitset = new WeakMap();
    topologyCacheByTree.set(tree, cacheByAliveBitset);
  }
  let cache = cacheByAliveBitset.get(aliveBitset);
  if (!cache) {
    cache = new Map();
    cacheByAliveBitset.set(aliveBitset, cache);
  }
  const cached = cache.get(cacheKey);
  if (cached) {
    // Refresh insertion order for a small LRU cache. The topology is read-only
    // after construction, so callers can safely share this derived object.
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }
  const rootNodeId = viewRootNodeId ?? tree.rootId;
  const terminalSet = new Set(
    terminalNodeIds.filter((nodeId) => aliveBitset[nodeId] === 1 && tree.isAncestorOf(rootNodeId, nodeId)),
  );
  const visibleOriginalNodeIds = new Set<number>([rootNodeId]);

  terminalSet.forEach((terminalNodeId) => {
    let current = terminalNodeId;
    while (current >= 0 && aliveBitset[current] === 1) {
      if (visibleOriginalNodeIds.has(current)) break;
      visibleOriginalNodeIds.add(current);
      if (current === rootNodeId) break;
      current = tree.parentOf(current);
    }
  });

  const originalNodeIds = Array.from(visibleOriginalNodeIds);
  if (!tree.nodeIdsInDfsOrder || originalNodeIds.length * Math.log2(Math.max(2, originalNodeIds.length)) < tree.nodeCount) {
    originalNodeIds.sort((left, right) => tree.runtime.nodeIn[left] - tree.runtime.nodeIn[right]);
  } else {
    originalNodeIds.length = 0;
    for (const nodeId of tree.nodeIdsInDfsOrder) {
      if (visibleOriginalNodeIds.has(nodeId)) originalNodeIds.push(nodeId);
    }
  }
  const visibleChildCount = new Map<number, number>();
  originalNodeIds.forEach((nodeId) => {
    if (nodeId === rootNodeId) return;
    const parentNodeId = tree.parentOf(nodeId);
    if (visibleOriginalNodeIds.has(parentNodeId)) {
      visibleChildCount.set(parentNodeId, (visibleChildCount.get(parentNodeId) ?? 0) + 1);
    }
  });
  const keptOriginalNodeIds = originalNodeIds.filter((nodeId) => (
    terminalSet.has(nodeId) || (visibleChildCount.get(nodeId) ?? 0) !== 1
  ));
  const visibleIdByOriginalNodeId = new Map(
    keptOriginalNodeIds.map((originalNodeId, id) => [originalNodeId, id]),
  );
  const normalized: VisibleTreeTopologyNode[] = keptOriginalNodeIds.map((originalNodeId, id) => ({
    id,
    originalNodeId,
    parent: null,
    children: [],
    nodePath: [originalNodeId],
    terminal: terminalSet.has(originalNodeId),
  }));
  normalized.forEach((node) => {
    let current = tree.parentOf(node.originalNodeId);
    const reversePath = [node.originalNodeId];
    while (current >= 0 && !visibleIdByOriginalNodeId.has(current)) {
      reversePath.push(current);
      current = tree.parentOf(current);
    }
    const parentId = visibleIdByOriginalNodeId.get(current);
    if (parentId === undefined) return;
    node.parent = parentId;
    node.nodePath = [...reversePath, current].reverse();
    normalized[parentId].children.push(node.id);
  });

  const topology = {
    terminalNodeIds: terminalNodeIds.filter((nodeId) => terminalSet.has(nodeId)),
    nodes: normalized,
    nodeIdToVisibleId: visibleIdByOriginalNodeId,
  };
  cache.set(cacheKey, topology);
  if (cache.size > TOPOLOGY_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  return topology;
}
