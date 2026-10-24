import type {
  TreeNodeSearchItem,
  TreeScopeOption as ApiTreeScopeOption,
  TreeScopeOptionMember as ApiTreeScopeOptionMember,
} from "../../types";
import { RANKS } from "../result/resultConstants";
import type { TreeCoreViewModel } from "../tree-core/treeCoreView";
import { deepestRank, exactTaxonRank, sourceLabel, taxonomyPath, taxonomyValue, taxonRootForRank } from "../result/resultVisualUtils";

export type QueryScopePresetKey = "archaea_bacteria" | "archaea" | "bacteria" | "other";

export type QueryScopeOptionMember = ApiTreeScopeOptionMember;
export type QueryScopeOption = ApiTreeScopeOption;

const DEFAULT_QUERY_SCOPE_EXCLUDED_TAXA = [
  { rank: "phylum", taxonNameNorm: "huberarchaeota" },
] as const;

const PRESET_KEYS: Array<Exclude<QueryScopePresetKey, "other">> = [
  "archaea_bacteria",
  "archaea",
  "bacteria",
];

export function availableQueryScopePresets(options: readonly QueryScopeOption[]): QueryScopePresetKey[] {
  const available = new Set(options.filter((option) => option.status === "available").map((option) => option.key));
  return [...PRESET_KEYS.filter((key) => available.has(key)), "other"];
}

export function defaultQueryScopeSelection(options: readonly QueryScopeOption[]): Exclude<QueryScopePresetKey, "other"> | null {
  return PRESET_KEYS.find((key) => options.some((option) => option.key === key && option.status === "available")) ?? null;
}

export function defaultQueryScopeExpansionRank(ranks: readonly (string | null | undefined)[]): string {
  const mostSpecificIndex = ranks.reduce<number>((index, rank) => {
    const candidateIndex = rank ? RANKS.indexOf(rank) : -1;
    return Math.max(index, candidateIndex);
  }, 0);
  return RANKS[Math.min(mostSpecificIndex + 1, RANKS.length - 1)];
}

export function defaultQueryScopeLeafNodeIds(tree: TreeCoreViewModel, scopeNodeId: number): number[] {
  const excludedLeafNodeIds = new Set<number>();
  DEFAULT_QUERY_SCOPE_EXCLUDED_TAXA.forEach(({ rank, taxonNameNorm }) => {
    const matchingNodeIds = new Set<number>();
    (tree.runtime.rankIndexes[rank] ?? []).forEach((entry) => {
      const normalized = (entry.taxonNameNorm || entry.taxonName).trim().toLowerCase();
      if (normalized === taxonNameNorm) matchingNodeIds.add(entry.nodeId);
    });
    // Older tree-core artifacts may have a complete name map but an index
    // that was generated before normalized names were persisted. Keep the
    // default policy independent of that serialization detail.
    tree.runtime.taxonNameByRankAndNode?.[rank]?.forEach((name, nodeId) => {
      if (name.trim().toLowerCase() === taxonNameNorm) matchingNodeIds.add(nodeId);
    });
    matchingNodeIds.forEach((nodeId) => tree.materializeLeafNodeIds(nodeId).forEach((leafNodeId) => {
      excludedLeafNodeIds.add(leafNodeId);
    }));
  });
  return tree.materializeLeafNodeIds(scopeNodeId)
    .filter((leafNodeId) => !excludedLeafNodeIds.has(leafNodeId));
}

export function resolveQueryScopeSelection(
  selection: QueryScopePresetKey,
  options: readonly QueryScopeOption[],
): QueryScopePresetKey | null {
  if (selection === "other") return "other";
  return availableQueryScopePresets(options).includes(selection) ? selection : null;
}

export function queryScopeOption(options: readonly QueryScopeOption[], key: Exclude<QueryScopePresetKey, "other">) {
  return options.find((option) => option.key === key) ?? null;
}

export function searchQueryScopeCandidates(
  tree: TreeCoreViewModel | null,
  rank: string,
  query: string,
): TreeNodeSearchItem[] {
  if (!tree || !query.trim()) return [];
  const normalizedQuery = query.trim().toLowerCase();
  const ranks = rank === "all" ? RANKS : [rank];
  const results: Array<TreeNodeSearchItem & { score: number; order: number }> = [];
  const seen = new Set<string>();
  const score = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized === normalizedQuery) return 0;
    if (normalized.startsWith(normalizedQuery)) return 1;
    if (normalized.includes(normalizedQuery)) return 2;
    return null;
  };

  for (let nodeId = 0; nodeId < tree.nodeCount; nodeId += 1) {
    if (!tree.childrenOf(nodeId).length) continue;
    ranks.forEach((rankName, rankIndex) => {
      const value = taxonomyValue(tree, nodeId, rankName);
      const matchScore = value ? score(value) : null;
      if (matchScore === null) return;
      const targetId = taxonRootForRank(tree, nodeId, rankName);
      const key = `${targetId}:${rankName}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        id: targetId,
        label: taxonomyValue(tree, targetId, rankName) || value,
        rank: rankName,
        path: taxonomyPath(tree, targetId),
        speciesCount: tree.countLeafNodeIds(targetId),
        genomeCount: tree.countLeafNodeIds(targetId),
        score: matchScore,
        order: tree.runtime.nodeIn[targetId] * RANKS.length + rankIndex,
      });
    });

    if (rank !== "all") continue;
    const source = tree.sourceName(nodeId);
    const sourceScore = source ? score(source) : null;
    if (sourceScore === null) continue;
    const nodeRank = exactTaxonRank(tree, nodeId) ?? deepestRank(tree, nodeId) ?? "node";
    const key = `${nodeId}:${nodeRank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: nodeId,
      label: sourceLabel(tree, nodeId, nodeRank),
      rank: nodeRank,
      path: taxonomyPath(tree, nodeId),
      speciesCount: tree.countLeafNodeIds(nodeId),
      genomeCount: tree.countLeafNodeIds(nodeId),
      score: sourceScore + 1,
      order: tree.runtime.nodeIn[nodeId] * RANKS.length + RANKS.length,
    });
  }

  return results
    .sort((left, right) => left.score - right.score || left.order - right.order)
    .slice(0, 30)
    .map(({ score: _score, order: _order, ...item }) => item);
}
