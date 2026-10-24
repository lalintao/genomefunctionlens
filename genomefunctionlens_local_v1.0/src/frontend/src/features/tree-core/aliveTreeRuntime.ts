import type {
  AliveTreeRuntime,
  TreeCoreNamedTaxonEntry,
  TreeCoreRuntime,
  TreeCoreTaxonBinding,
  TreeRerootSpec,
} from "./treeCoreTypes";

const REROOT_POSITION_TOLERANCE = 1e-9;

export function createDefaultRerootSpec(rawTree: TreeCoreRuntime): TreeRerootSpec {
  const rootChildren = childIdsOf(rawTree, rawTree.rootId);
  if (rawTree.rootId !== 0 || rawTree.isLeaf[0] === 1 || rootChildren.length !== 2) {
    throw new Error("The raw tree must use node 0 as a binary structural root.");
  }
  const [edgeNodeIdA, edgeNodeIdB] = rootChildren;
  return {
    edgeNodeIdA,
    edgeNodeIdB,
    position: 0.5,
  };
}

/** Returns true for the same unrooted edge and root position in either endpoint order. */
export function rerootSpecsEqual(left: TreeRerootSpec, right: TreeRerootSpec) {
  if (left.edgeNodeIdA === right.edgeNodeIdA && left.edgeNodeIdB === right.edgeNodeIdB) {
    return Math.abs(left.position - right.position) <= REROOT_POSITION_TOLERANCE;
  }
  return left.edgeNodeIdA === right.edgeNodeIdB
    && left.edgeNodeIdB === right.edgeNodeIdA
    && Math.abs(left.position - (1 - right.position)) <= REROOT_POSITION_TOLERANCE;
}

/**
 * Maps one rendered branch path to the real unrooted edge at its length midpoint.
 * A path may contain nodes compressed out of the visible tree.
 */
export function createRerootSpecForCanvasPath(
  aliveTree: AliveTreeRuntime,
  nodePath: readonly number[],
): TreeRerootSpec {
  if (nodePath.length < 2) throw new Error("A visible branch must contain at least one tree edge.");
  const segments = nodePath.slice(0, -1).map((nodeId, index) => (
    canvasPathSegment(aliveTree, nodeId, nodePath[index + 1])
  ));
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= 0) return segments[0].specAtOffset(segments[0].length / 2);
  const midpoint = totalLength / 2;
  let traversed = 0;
  for (const segment of segments) {
    if (midpoint <= traversed + segment.length || segment === segments[segments.length - 1]) {
      return segment.specAtOffset(Math.max(0, Math.min(segment.length, midpoint - traversed)));
    }
    traversed += segment.length;
  }
  throw new Error("The visible branch does not contain a rerootable edge.");
}

function canvasPathSegment(aliveTree: AliveTreeRuntime, nodeIdA: number, nodeIdB: number) {
  if (nodeIdA === aliveTree.rootId || nodeIdB === aliveTree.rootId) {
    const childNodeId = nodeIdA === aliveTree.rootId ? nodeIdB : nodeIdA;
    if (aliveTree.parent[childNodeId] !== aliveTree.rootId) {
      throw new Error("The visible root segment is not an edge in the current interaction tree.");
    }
    const rootChildren = childIdsOf(aliveTree, aliveTree.rootId);
    const otherChildNodeId = rootChildren.find((nodeId) => nodeId !== childNodeId);
    if (rootChildren.length !== 2 || otherChildNodeId === undefined) {
      throw new Error("The interaction root must have exactly two child branches.");
    }
    const segmentLength = aliveTree.branchLength[childNodeId] ?? 0;
    return {
      length: segmentLength,
      specAtOffset: (_offset: number): TreeRerootSpec => ({
        edgeNodeIdA: childNodeId,
        edgeNodeIdB: otherChildNodeId,
        position: 0.5,
      }),
    };
  }

  const forward = aliveTree.parent[nodeIdB] === nodeIdA;
  const reverse = aliveTree.parent[nodeIdA] === nodeIdB;
  if (!forward && !reverse) throw new Error(`Canvas path segment ${nodeIdA}-${nodeIdB} is not a current tree edge.`);
  const segmentLength = forward
    ? aliveTree.branchLength[nodeIdB] ?? 0
    : aliveTree.branchLength[nodeIdA] ?? 0;
  return {
    length: segmentLength,
    specAtOffset: (_offset: number): TreeRerootSpec => ({
      edgeNodeIdA: nodeIdA,
      edgeNodeIdB: nodeIdB,
      position: 0.5,
    }),
  };
}

/**
 * Builds the mutable main-canvas tree from the immutable raw tree.
 * Node ids remain stable; only direction, DFS values, and mutable indexes are copied.
 */
export function buildAliveTreeRuntime(
  rawTree: TreeCoreRuntime,
  rerootSpec: TreeRerootSpec,
): AliveTreeRuntime {
  validateRerootSpec(rawTree, rerootSpec);
  const oriented = orientFromUnrootedEdge(rawTree, rerootSpec);
  const taxonIndexes = rebuildTaxonIndexes(rawTree, oriented.traversalOrder, oriented.childrenIndex, oriented.parent);
  const nodeTaxonFields = rebuildNodeTaxonFields(rawTree, taxonIndexes.taxonBindingsByNode);
  return {
    dataset: rawTree.dataset,
    rootId: rawTree.rootId,
    nodeCount: rawTree.nodeCount,
    leafCount: rawTree.leafCount,
    genomeCount: rawTree.genomeCount,
    treeCoreFormat: rawTree.treeCoreFormat,
    strings: rawTree.strings,
    ranks: rawTree.ranks,
    parent: oriented.parent,
    nodeIn: oriented.nodeIn,
    nodeOut: oriented.nodeOut,
    dfsId: oriented.dfsId,
    rankId: nodeTaxonFields.rankId,
    isLeaf: rawTree.isLeaf,
    branchLength: oriented.branchLength,
    cumulativeBranchLength: oriented.cumulativeBranchLength,
    leafNameId: rawTree.leafNameId,
    taxonNameId: nodeTaxonFields.taxonNameId,
    childrenIndex: oriented.childrenIndex,
    rankIndexes: taxonIndexes.rankIndexes,
    taxonNameByRankAndNode: taxonIndexes.taxonNameByRankAndNode,
    taxonBindingsByNode: taxonIndexes.taxonBindingsByNode,
    rerootSpec: { ...rerootSpec },
    swappedBranchNodeIds: [],
  };
}

/** Swaps the two direct child branches of the current interaction tree node. */
export function swapAliveTreeChildren(aliveTree: AliveTreeRuntime, nodeId: number): AliveTreeRuntime {
  const start = aliveTree.childrenIndex.offsets[nodeId] ?? 0;
  const end = aliveTree.childrenIndex.offsets[nodeId + 1] ?? start;
  if (end - start !== 2) {
    throw new Error(`Node ${nodeId} does not have exactly two child branches to swap.`);
  }
  const swaps = new Set(aliveTree.swappedBranchNodeIds ?? []);
  if (!swaps.delete(nodeId)) swaps.add(nodeId);
  return rebuildAliveTreeDfsOrder(aliveTree, new Set([nodeId]), swaps);
}

/** Replays saved binary-branch swaps on a freshly built rerooted tree. */
export function rebuildAliveTreeWithSwappedBranches(
  rawTree: TreeCoreRuntime,
  rerootSpec: TreeRerootSpec,
  swappedBranchNodeIds: readonly number[],
) {
  const aliveTree = buildAliveTreeRuntime(rawTree, rerootSpec);
  const swaps = new Set(swappedBranchNodeIds);
  if (swaps.size !== swappedBranchNodeIds.length) throw new Error("Duplicate saved branch swap.");
  for (const nodeId of swaps) {
    if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= aliveTree.nodeCount
      || aliveTree.childrenIndex.offsets[nodeId + 1] - aliveTree.childrenIndex.offsets[nodeId] !== 2) {
      throw new Error("Saved branch swap is not a binary node.");
    }
  }
  return swaps.size ? rebuildAliveTreeDfsOrder(aliveTree, swaps, swaps) : aliveTree;
}

/** Derives the minimal saved-query swap description from the current runtime. */
export function swappedBranchNodeIdsFromAliveTree(
  rawTree: TreeCoreRuntime,
  aliveTree: AliveTreeRuntime,
) {
  if (aliveTree.swappedBranchNodeIds) return [...aliveTree.swappedBranchNodeIds];
  const baseline = buildAliveTreeRuntime(rawTree, aliveTree.rerootSpec);
  const swappedNodeIds: number[] = [];
  for (let nodeId = 0; nodeId < aliveTree.nodeCount; nodeId += 1) {
    const baselineChildren = childIdsOf(baseline, nodeId);
    const currentChildren = childIdsOf(aliveTree, nodeId);
    if (
      baselineChildren.length === 2
      && currentChildren.length === 2
      && baselineChildren[0] === currentChildren[1]
      && baselineChildren[1] === currentChildren[0]
    ) swappedNodeIds.push(nodeId);
  }
  return swappedNodeIds;
}

function rebuildAliveTreeDfsOrder(
  aliveTree: AliveTreeRuntime,
  swappedNodeIds: ReadonlySet<number>,
  savedSwaps: ReadonlySet<number> = new Set(aliveTree.swappedBranchNodeIds ?? []),
): AliveTreeRuntime {
  const nodeCount = aliveTree.nodeCount;
  const dfsId = new Int32Array(nodeCount);
  const nodeIn = new Int32Array(nodeCount);
  const nodeOut = new Int32Array(nodeCount);
  const offsets = new Int32Array(nodeCount + 1);
  const pool = new Int32Array(aliveTree.childrenIndex.pool.length);
  let poolCursor = 0;

  for (let currentNodeId = 0; currentNodeId < nodeCount; currentNodeId += 1) {
    offsets[currentNodeId] = poolCursor;
    const start = aliveTree.childrenIndex.offsets[currentNodeId] ?? poolCursor;
    const end = aliveTree.childrenIndex.offsets[currentNodeId + 1] ?? start;
    if (swappedNodeIds.has(currentNodeId)) {
      pool[poolCursor] = aliveTree.childrenIndex.pool[start + 1];
      pool[poolCursor + 1] = aliveTree.childrenIndex.pool[start];
      poolCursor += 2;
      continue;
    }
    pool.set(aliveTree.childrenIndex.pool.subarray(start, end), poolCursor);
    poolCursor += end - start;
  }
  offsets[nodeCount] = poolCursor;

  let cursor = 0;
  const rankIndexes: Record<string, TreeCoreNamedTaxonEntry[]> = {};
  const stack = [aliveTree.rootId];
  while (stack.length) {
    const event = stack.pop();
    if (event === undefined) continue;
    if (event < 0) {
      nodeOut[~event] = cursor;
      continue;
    }
    dfsId[event] = cursor;
    nodeIn[event] = cursor;
    cursor += 1;
    (aliveTree.taxonBindingsByNode.get(event) ?? []).forEach((binding) => {
      (rankIndexes[binding.rank] ??= []).push({
        nodeId: event,
        taxonName: binding.taxonName,
        taxonNameNorm: binding.taxonNameNorm,
      });
    });
    stack.push(~event);
    for (let index = offsets[event + 1] - 1; index >= offsets[event]; index -= 1) {
      stack.push(pool[index]);
    }
  }

  return {
    ...aliveTree,
    nodeIn,
    nodeOut,
    dfsId,
    childrenIndex: { offsets, pool },
    rankIndexes,
    swappedBranchNodeIds: [...savedSwaps],
  };
}

function rebuildNodeTaxonFields(
  rawTree: TreeCoreRuntime,
  taxonBindingsByNode: Map<number, TreeCoreTaxonBinding[]>,
) {
  const rankId = new Int16Array(rawTree.nodeCount);
  rankId.fill(-1);
  const taxonNameId = new Int32Array(rawTree.nodeCount);
  const rankIndexByName = new Map(rawTree.ranks.map((rank, index) => [rank, index]));

  taxonBindingsByNode.forEach((bindings, nodeId) => {
    const deepestBinding = bindings.reduce<TreeCoreTaxonBinding | null>((deepest, binding) => {
      if (!deepest) return binding;
      return (rankIndexByName.get(binding.rank) ?? -1) > (rankIndexByName.get(deepest.rank) ?? -1)
        ? binding
        : deepest;
    }, null);
    if (!deepestBinding) return;
    rankId[nodeId] = rankIndexByName.get(deepestBinding.rank) ?? -1;
    taxonNameId[nodeId] = deepestBinding.taxonNameId;
  });
  return { rankId, taxonNameId };
}

function validateRerootSpec(rawTree: TreeCoreRuntime, spec: TreeRerootSpec) {
  if (
    !Number.isInteger(spec.edgeNodeIdA)
    || !Number.isInteger(spec.edgeNodeIdB)
    || spec.edgeNodeIdA <= 0
    || spec.edgeNodeIdB <= 0
    || spec.edgeNodeIdA >= rawTree.nodeCount
    || spec.edgeNodeIdB >= rawTree.nodeCount
    || spec.edgeNodeIdA === spec.edgeNodeIdB
  ) {
    throw new Error("The reroot edge must contain two distinct non-root nodes.");
  }
  if (!Number.isFinite(spec.position) || spec.position < 0 || spec.position > 1) {
    throw new Error("The reroot position must be between 0 and 1.");
  }
}

function childIdsOf(tree: TreeCoreRuntime, nodeId: number) {
  const start = tree.childrenIndex.offsets[nodeId];
  const end = tree.childrenIndex.offsets[nodeId + 1];
  return Array.from(tree.childrenIndex.pool.slice(start, end));
}

function orientFromUnrootedEdge(rawTree: TreeCoreRuntime, spec: TreeRerootSpec) {
  const nodeCount = rawTree.nodeCount;
  const [rootChildA, rootChildB] = childIdsOf(rawTree, rawTree.rootId);
  if (childIdsOf(rawTree, rawTree.rootId).length !== 2) {
    throw new Error("The raw tree root must have exactly two children.");
  }
  const rootEdgeLength = (rawTree.branchLength[rootChildA] ?? 0) + (rawTree.branchLength[rootChildB] ?? 0);
  const isRootEdge = (spec.edgeNodeIdA === rootChildA && spec.edgeNodeIdB === rootChildB)
    || (spec.edgeNodeIdA === rootChildB && spec.edgeNodeIdB === rootChildA);
  const targetLength = isRootEdge
    ? rootEdgeLength
    : rawTree.parent[spec.edgeNodeIdA] === spec.edgeNodeIdB
      ? rawTree.branchLength[spec.edgeNodeIdA]
      : rawTree.parent[spec.edgeNodeIdB] === spec.edgeNodeIdA
        ? rawTree.branchLength[spec.edgeNodeIdB]
        : null;
  if (targetLength === null) {
    throw new Error(`Reroot edge ${spec.edgeNodeIdA}-${spec.edgeNodeIdB} does not exist in the raw unrooted tree.`);
  }

  const parent = new Int32Array(nodeCount);
  parent.fill(-1);
  const visited = new Uint8Array(nodeCount);
  const branchLength = new Float64Array(nodeCount);
  const cumulativeBranchLength = new Float64Array(nodeCount);
  const dfsId = new Int32Array(nodeCount);
  const nodeIn = new Int32Array(nodeCount);
  const nodeOut = new Int32Array(nodeCount);
  const traversalOrder: number[] = [];
  const stack = [rawTree.rootId];
  const isCut = (a: number, b: number) => (a === spec.edgeNodeIdA && b === spec.edgeNodeIdB)
    || (a === spec.edgeNodeIdB && b === spec.edgeNodeIdA);
  const pushNeighbor = (nodeId: number, neighborId: number, length: number) => {
    if (neighborId === parent[nodeId] || isCut(nodeId, neighborId)
      || visited[neighborId] === 1 || parent[neighborId] !== -1) return;
    parent[neighborId] = nodeId;
    branchLength[neighborId] = length;
    cumulativeBranchLength[neighborId] = cumulativeBranchLength[nodeId] + length;
    stack.push(neighborId);
  };

  while (stack.length) {
    const event = stack.pop();
    if (event === undefined) continue;
    if (event < 0) {
      nodeOut[~event] = traversalOrder.length;
      continue;
    }
    const nodeId = event;
    if (visited[nodeId] === 1) continue;
    visited[nodeId] = 1;
    dfsId[nodeId] = traversalOrder.length;
    nodeIn[nodeId] = traversalOrder.length;
    traversalOrder.push(nodeId);
    stack.push(~nodeId);
    if (nodeId === rawTree.rootId) {
      pushNeighbor(nodeId, spec.edgeNodeIdB, targetLength * (1 - spec.position));
      pushNeighbor(nodeId, spec.edgeNodeIdA, targetLength * spec.position);
      continue;
    }
    if (nodeId === rootChildA || nodeId === rootChildB) {
      const otherRootChild = nodeId === rootChildA ? rootChildB : rootChildA;
      pushNeighbor(nodeId, otherRootChild, rootEdgeLength);
    }
    const start = rawTree.childrenIndex.offsets[nodeId];
    const end = rawTree.childrenIndex.offsets[nodeId + 1];
    for (let index = end - 1; index >= start; index -= 1) {
      const childId = rawTree.childrenIndex.pool[index];
      pushNeighbor(nodeId, childId, rawTree.branchLength[childId]);
    }
    const rawParentId = rawTree.parent[nodeId];
    if (rawParentId > 0) pushNeighbor(nodeId, rawParentId, rawTree.branchLength[nodeId]);
  }

  if (traversalOrder.length !== nodeCount) {
    throw new Error("The rerooted interaction tree is disconnected.");
  }

  const offsets = new Int32Array(nodeCount + 1);
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    if (nodeId !== rawTree.rootId) offsets[parent[nodeId] + 1] += 1;
  }
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) offsets[nodeId + 1] += offsets[nodeId];
  const pool = new Int32Array(nodeCount - 1);
  const cursors = Int32Array.from(offsets.subarray(0, nodeCount));
  // Traversal order is also the sibling order. Filling CSR from it keeps the
  // interval arrays and the child pool consistent even when stable node IDs
  // are unrelated to the source file's sibling order.
  traversalOrder.forEach((nodeId) => {
    if (nodeId === rawTree.rootId) return;
    pool[cursors[parent[nodeId]]++] = nodeId;
  });
  return {
    parent,
    nodeIn,
    nodeOut,
    dfsId,
    branchLength,
    cumulativeBranchLength,
    traversalOrder,
    childrenIndex: { offsets, pool },
  };
}

function rebuildTaxonIndexes(
  rawTree: TreeCoreRuntime,
  traversalOrder: number[],
  childrenIndex: TreeCoreRuntime["childrenIndex"],
  parent: Int32Array,
): {
  rankIndexes: Record<string, TreeCoreNamedTaxonEntry[]>;
  taxonNameByRankAndNode: Record<string, Map<number, string>>;
  taxonBindingsByNode: Map<number, TreeCoreTaxonBinding[]>;
} {
  const rankCount = rawTree.ranks.length;
  const canonicalLineage = new Int32Array(rawTree.nodeCount * rankCount);
  const rankIndexByName = new Map(rawTree.ranks.map((rank, index) => [rank, index]));
  const rawTraversalOrder = collectTraversalOrder(rawTree);

  rawTraversalOrder.forEach((nodeId) => {
    const parentId = rawTree.parent[nodeId] ?? -1;
    const offset = nodeId * rankCount;
    if (parentId >= 0) {
      canonicalLineage.set(
        canonicalLineage.subarray(parentId * rankCount, (parentId + 1) * rankCount),
        offset,
      );
    }
    (rawTree.taxonBindingsByNode.get(nodeId) ?? []).forEach((binding) => {
      const rankIndex = rankIndexByName.get(binding.rank);
      if (rankIndex !== undefined) canonicalLineage[offset + rankIndex] = binding.taxonNameId;
    });
  });

  const pureTaxonNameId = new Int32Array(rawTree.nodeCount * rankCount);
  for (let orderIndex = traversalOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const nodeId = traversalOrder[orderIndex];
    const offset = nodeId * rankCount;
    if (rawTree.isLeaf[nodeId] === 1) {
      pureTaxonNameId.set(canonicalLineage.subarray(offset, offset + rankCount), offset);
      continue;
    }
    const childStart = childrenIndex.offsets[nodeId];
    const childEnd = childrenIndex.offsets[nodeId + 1];
    if (childStart === childEnd) continue;
    for (let rankIndex = 0; rankIndex < rankCount; rankIndex += 1) {
      const candidate = pureTaxonNameId[childrenIndex.pool[childStart] * rankCount + rankIndex];
      if (candidate <= 0) continue;
      let allChildrenMatch = true;
      for (let childIndex = childStart + 1; childIndex < childEnd; childIndex += 1) {
        if (pureTaxonNameId[childrenIndex.pool[childIndex] * rankCount + rankIndex] !== candidate) {
          allChildrenMatch = false;
          break;
        }
      }
      if (allChildrenMatch) pureTaxonNameId[offset + rankIndex] = candidate;
    }
  }

  const rankIndexes: Record<string, TreeCoreNamedTaxonEntry[]> = {};
  const taxonNameByRankAndNode: Record<string, Map<number, string>> = {};
  const taxonBindingsByNode = new Map<number, TreeCoreTaxonBinding[]>();
  traversalOrder.forEach((nodeId) => {
    const parentId = parent[nodeId] ?? -1;
    for (let rankIndex = 0; rankIndex < rankCount; rankIndex += 1) {
      const taxonNameId = pureTaxonNameId[nodeId * rankCount + rankIndex];
      if (!taxonNameId) continue;
      const parentTaxonNameId = parentId >= 0 ? pureTaxonNameId[parentId * rankCount + rankIndex] : 0;
      if (parentTaxonNameId === taxonNameId) continue;
      const rank = rawTree.ranks[rankIndex];
      const taxonName = rawTree.strings[taxonNameId] ?? "";
      if (!rank || !taxonName) continue;
      const entry: TreeCoreNamedTaxonEntry = {
        nodeId,
        taxonName,
        taxonNameNorm: taxonName.trim().toLowerCase(),
      };
      (rankIndexes[rank] ??= []).push(entry);
      (taxonNameByRankAndNode[rank] ??= new Map()).set(nodeId, taxonName);
      const bindings = taxonBindingsByNode.get(nodeId) ?? [];
      bindings.push({ ...entry, rank, taxonNameId });
      taxonBindingsByNode.set(nodeId, bindings);
    }
  });
  return { rankIndexes, taxonNameByRankAndNode, taxonBindingsByNode };
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
