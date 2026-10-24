import type { TreeCoreViewModel } from "./treeCoreView";

export function createFullAliveBitset(nodeCount: number) {
  const bitset = new Uint8Array(nodeCount);
  bitset.fill(1);
  return bitset;
}

export function createEmptyAliveBitset(nodeCount: number) {
  return new Uint8Array(nodeCount);
}

export function leafNodeIdsFromAliveBitset(tree: TreeCoreViewModel, aliveBitset: Uint8Array) {
  const leaves: number[] = [];
  tree.forEachLeafNodeId(tree.rootId, (nodeId) => {
    if (aliveBitset[nodeId] === 1) leaves.push(nodeId);
  });
  return leaves;
}

export function aliveBitsetFromLeafNodeIds(tree: TreeCoreViewModel, leafNodeIds: Iterable<number>) {
  const bitset = createEmptyAliveBitset(tree.nodeCount);
  for (const leafNodeId of leafNodeIds) {
    if (
      leafNodeId >= 0
      && leafNodeId < tree.nodeCount
      && tree.runtime.isLeaf[leafNodeId] === 1
    ) {
      bitset[leafNodeId] = 1;
    }
  }
  closeAliveAncestors(tree, bitset);
  return bitset;
}

/** Propagates selected nodes to their ancestors in one reverse DFS pass. */
function closeAliveAncestors(tree: TreeCoreViewModel, bitset: Uint8Array) {
  for (let index = tree.nodeIdsInDfsOrder.length - 1; index >= 0; index -= 1) {
    const nodeId = tree.nodeIdsInDfsOrder[index];
    if (bitset[nodeId] !== 1) continue;
    const parentNodeId = tree.parentOf(nodeId);
    if (parentNodeId >= 0) bitset[parentNodeId] = 1;
  }
}

export function removeSubtreeFromAliveBitset(tree: TreeCoreViewModel, aliveBitset: Uint8Array, nodeId: number) {
  const next = Uint8Array.from(aliveBitset);
  tree.forEachLeafNodeId(nodeId, (leafNodeId) => {
    next[leafNodeId] = 0;
  });
  return aliveBitsetFromLeafNodeIds(tree, leafNodeIdsFromAliveBitset(tree, next));
}
