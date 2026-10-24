import type { DatasetItem, TreeCoreResponse } from "../../types";
import type { TreeCoreNamedTaxonEntry, TreeCoreRuntime, TreeCoreSession, TreeCoreTaxonBinding } from "./treeCoreTypes";
import { buildAliveTreeRuntime, createDefaultRerootSpec } from "./aliveTreeRuntime";

interface TreeCorePayload {
  schema_version?: string;
  species_tree: string;
  genome_database: string;
  root_id: number;
  node_count: number;
  leaf_count: number;
  strings: string[];
  ranks: string[];
  parent: number[];
  node_in: number[];
  node_out: number[];
  rank_id: number[];
  is_leaf: number[];
  branch_length: number[];
  cumulative_branch_length: number[];
  leaf_name_id: number[];
  taxon_name_id: number[];
  children_offsets: number[];
  children_pool: number[];
  named_taxa_rank_id: number[];
  named_taxa_node_id: number[];
  named_taxa_name_id: number[];
}

export async function createTreeCoreSession(
  dataset: DatasetItem,
  summary: TreeCoreResponse,
  archive: ArrayBuffer,
): Promise<TreeCoreSession> {
  const payload = await decodeTreeCorePayload(archive);
  validateTreeCorePayload(payload, summary);
  const runtime = buildTreeCoreRuntime(dataset, summary, payload);
  return {
    summary,
    rawTree: runtime,
    aliveTree: buildAliveTreeRuntime(runtime, createDefaultRerootSpec(runtime)),
  };
}

async function decodeTreeCorePayload(archive: ArrayBuffer): Promise<TreeCorePayload> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Current browser does not support gzip tree core decoding.");
  }

  const compressed = new Blob([archive]);
  const stream = compressed.stream().pipeThrough(new DecompressionStream("gzip"));
  const jsonText = await new Response(stream).text();
  return JSON.parse(jsonText) as TreeCorePayload;
}

function validateTreeCorePayload(payload: TreeCorePayload, summary: TreeCoreResponse) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Tree core payload is empty.");
  }

  const nodeCount = payload.node_count;
  if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
    throw new Error("Tree core payload has an invalid node count.");
  }

  const requiredArrays: Array<[name: string, values: number[] | string[], expectedLength: number]> = [
    ["parent", payload.parent, nodeCount],
    ["node_in", payload.node_in, nodeCount],
    ["node_out", payload.node_out, nodeCount],
    ["rank_id", payload.rank_id, nodeCount],
    ["is_leaf", payload.is_leaf, nodeCount],
    ["branch_length", payload.branch_length, nodeCount],
    ["cumulative_branch_length", payload.cumulative_branch_length, nodeCount],
    ["leaf_name_id", payload.leaf_name_id, nodeCount],
    ["taxon_name_id", payload.taxon_name_id, nodeCount],
  ];

  requiredArrays.forEach(([name, values, expectedLength]) => {
    if (!Array.isArray(values) || values.length !== expectedLength) {
      throw new Error(`Tree core field "${name}" length does not match node_count.`);
    }
  });

  if (!Array.isArray(payload.children_offsets) || payload.children_offsets.length !== nodeCount + 1) {
    throw new Error('Tree core field "children_offsets" must have node_count + 1 items.');
  }

  if (!Array.isArray(payload.children_pool) || payload.children_pool.length < Math.max(0, nodeCount - 1)) {
    throw new Error('Tree core field "children_pool" is incomplete.');
  }

  if (
    payload.species_tree !== summary.species_tree ||
    payload.genome_database !== summary.genome_database ||
    payload.node_count !== summary.node_count ||
    payload.leaf_count !== summary.leaf_count
  ) {
    throw new Error("Tree core payload does not match the selected dataset.");
  }
}

function buildTreeCoreRuntime(
  dataset: DatasetItem,
  summary: TreeCoreResponse,
  payload: TreeCorePayload,
): TreeCoreRuntime {
  const strings = Array.isArray(payload.strings) ? payload.strings : [];
  const ranks = Array.isArray(payload.ranks) ? payload.ranks : [];
  const taxonIndexes = buildTaxonIndexes(payload, strings, ranks);

  return {
    dataset,
    rootId: payload.root_id,
    nodeCount: payload.node_count,
    leafCount: payload.leaf_count,
    genomeCount: summary.genome_count,
    treeCoreFormat: summary.tree_core_format,
    strings,
    ranks,
    parent: Int32Array.from(payload.parent),
    nodeIn: Int32Array.from(payload.node_in),
    nodeOut: Int32Array.from(payload.node_out),
    rankId: Int16Array.from(payload.rank_id),
    isLeaf: Uint8Array.from(payload.is_leaf),
    branchLength: Float64Array.from(payload.branch_length),
    cumulativeBranchLength: Float64Array.from(payload.cumulative_branch_length),
    leafNameId: Int32Array.from(payload.leaf_name_id),
    taxonNameId: Int32Array.from(payload.taxon_name_id),
    childrenIndex: {
      offsets: Int32Array.from(payload.children_offsets),
      pool: Int32Array.from(payload.children_pool),
    },
    rankIndexes: taxonIndexes.rankIndexes,
    taxonNameByRankAndNode: taxonIndexes.taxonNameByRankAndNode,
    taxonBindingsByNode: taxonIndexes.taxonBindingsByNode,
  };
}

function buildTaxonIndexes(
  payload: TreeCorePayload,
  strings: string[],
  ranks: string[],
): {
  rankIndexes: Record<string, TreeCoreNamedTaxonEntry[]>;
  taxonNameByRankAndNode: Record<string, Map<number, string>>;
  taxonBindingsByNode: Map<number, TreeCoreTaxonBinding[]>;
} {
  const rankIndexes: Record<string, TreeCoreNamedTaxonEntry[]> = {};
  const taxonNameByRankAndNode: Record<string, Map<number, string>> = {};
  const taxonBindingsByNode = new Map<number, TreeCoreTaxonBinding[]>();

  for (let index = 0; index < payload.named_taxa_node_id.length; index += 1) {
    const rankName = ranks[payload.named_taxa_rank_id[index]] ?? "";
    const taxonName = strings[payload.named_taxa_name_id[index]] ?? "";
    if (!rankName || !taxonName) {
      continue;
    }

    const entry: TreeCoreNamedTaxonEntry = {
      nodeId: payload.named_taxa_node_id[index],
      taxonName,
      taxonNameNorm: normalizeTreeTaxonName(taxonName),
    };

    (taxonNameByRankAndNode[rankName] ??= new Map()).set(entry.nodeId, entry.taxonName);
    const bindings = taxonBindingsByNode.get(entry.nodeId) ?? [];
    bindings.push({ ...entry, rank: rankName, taxonNameId: payload.named_taxa_name_id[index] });
    taxonBindingsByNode.set(entry.nodeId, bindings);
  }

  taxonBindingsByNode.forEach((bindings) => {
    bindings.sort((left, right) => ranks.indexOf(left.rank) - ranks.indexOf(right.rank));
  });
  const nodeIdByDfsIn = new Int32Array(payload.node_count);
  nodeIdByDfsIn.fill(-1);
  for (let nodeId = 0; nodeId < payload.node_count; nodeId += 1) {
    const dfsIn = payload.node_in[nodeId];
    if (!Number.isInteger(dfsIn) || dfsIn < 0 || dfsIn >= payload.node_count || nodeIdByDfsIn[dfsIn] !== -1) {
      throw new Error("Tree core DFS positions must be a permutation of the node IDs.");
    }
    nodeIdByDfsIn[dfsIn] = nodeId;
  }
  for (const nodeId of nodeIdByDfsIn) {
    (taxonBindingsByNode.get(nodeId) ?? []).forEach((binding) => {
      (rankIndexes[binding.rank] ??= []).push({
        nodeId,
        taxonName: binding.taxonName,
        taxonNameNorm: binding.taxonNameNorm,
      });
    });
  }
  return { rankIndexes, taxonNameByRankAndNode, taxonBindingsByNode };
}

function normalizeTreeTaxonName(value: string) {
  return value.trim().toLowerCase();
}
