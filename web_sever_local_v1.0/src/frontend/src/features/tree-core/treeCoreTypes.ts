import type { DatasetItem, TreeCoreResponse } from "../../types";

export interface TreeCoreNamedTaxonEntry {
  nodeId: number;
  taxonName: string;
  taxonNameNorm: string;
}

export interface TreeCoreTaxonBinding extends TreeCoreNamedTaxonEntry {
  rank: string;
  taxonNameId: number;
}

export interface TreeCoreChildrenIndex {
  offsets: Int32Array;
  pool: Int32Array;
}

export interface TreeCoreRuntime {
  dataset: DatasetItem;
  rootId: number;
  nodeCount: number;
  leafCount: number;
  genomeCount: number;
  treeCoreFormat: string;
  strings: string[];
  ranks: string[];
  parent: Int32Array;
  nodeIn: Int32Array;
  nodeOut: Int32Array;
  rankId: Int16Array;
  isLeaf: Uint8Array;
  branchLength: Float64Array;
  cumulativeBranchLength: Float64Array;
  leafNameId: Int32Array;
  taxonNameId: Int32Array;
  childrenIndex: TreeCoreChildrenIndex;
  rankIndexes: Record<string, TreeCoreNamedTaxonEntry[]>;
  taxonNameByRankAndNode: Record<string, Map<number, string>>;
  taxonBindingsByNode: Map<number, TreeCoreTaxonBinding[]>;
}

export interface TreeRerootSpec {
  edgeNodeIdA: number;
  edgeNodeIdB: number;
  position: number;
}

/** The mutable tree runtime used by every main-canvas tree interaction. */
export interface AliveTreeRuntime extends TreeCoreRuntime {
  /** Swaps relative to this reroot baseline; replaced immutably. */
  swappedBranchNodeIds?: readonly number[];
  dfsId: Int32Array;
  rerootSpec: TreeRerootSpec;
}

export interface TreeCoreSession {
  summary: TreeCoreResponse;
  rawTree: TreeCoreRuntime;
  aliveTree: AliveTreeRuntime;
}

export type TreeCoreLoadState =
  | {
      status: "idle";
      dataset: null;
      session: null;
      error: null;
    }
  | {
      status: "loading";
      dataset: DatasetItem;
      session: null;
      error: null;
    }
  | {
      status: "ready";
      dataset: DatasetItem;
      session: TreeCoreSession;
      error: null;
    }
  | {
      status: "error";
      dataset: DatasetItem;
      session: null;
      error: string;
    };
