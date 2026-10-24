import type { GenomeFilterRequest, TreeFilterGenomesResponse } from "../../types";
import type { VisibleRow } from "./resultTypes";
import type { TreeCoreViewModel } from "../tree-core/treeCoreView";

export type BranchPruneDraft = {
  refseqOnly: boolean;
  minCompleteness: string;
  maxContamination: string;
  minQuality: string;
  maxContig: string;
  longBranchIqrMultiplier: string;
  minimumTerminalLeafCount: string;
};

export type BranchPruneStatus = "idle" | "loading" | "ready" | "error";

export type BranchPruneErrorCode =
  | "empty_scope"
  | "empty_filters"
  | "invalid_min_completeness"
  | "invalid_max_contamination"
  | "invalid_min_quality"
  | "invalid_max_contig"
  | "invalid_long_branch_iqr_multiplier"
  | "invalid_minimum_terminal_leaf_count"
  | "request_failed";

export type BranchPruneRule = "genome_metadata" | "long_branch" | "small_branch";

export type BranchPruneSummary = {
  mode: "preview" | "apply";
  activeRules: BranchPruneRule[];
  currentScopeLeafCount: number;
  keptLeafCount: number;
  removedLeafCount: number;
  currentTerminalCount: number;
  keptTerminalCount: number;
  removedTerminalCount: number;
  previewSourceCount: number;
  genomeMetadata:
    | {
        keptGenomeCount: number;
        removedGenomeCount: number;
        removedLeafCount: number;
      }
    | null;
  longBranch:
    | {
        multiplier: number;
        q1: number | null;
        q3: number | null;
        upperBound: number | null;
        removedSourceCount: number;
        removedLeafCount: number;
      }
    | null;
  smallBranch:
    | {
        minimumTerminalLeafCount: number;
        removedSourceCount: number;
        removedLeafCount: number;
      }
    | null;
};

export type BranchPrunePlan = {
  nextAliveLeafNodeIds: number[] | null;
  previewNodeIds: Set<number>;
  summary: BranchPruneSummary;
};

export const EMPTY_BRANCH_PRUNE_DRAFT: BranchPruneDraft = {
  refseqOnly: false,
  minCompleteness: "",
  maxContamination: "",
  minQuality: "",
  maxContig: "",
  longBranchIqrMultiplier: "",
  minimumTerminalLeafCount: "",
};

type NormalizedBranchPruneDraft = {
  remoteFilters: GenomeFilterRequest;
  longBranchIqrMultiplier: number | null;
  minimumTerminalLeafCount: number | null;
  activeRules: BranchPruneRule[];
  errorCode: BranchPruneErrorCode | null;
};

type BranchPrunePlannerInput = {
  draft: BranchPruneDraft;
  mode: "preview" | "apply";
  treeModel: TreeCoreViewModel;
  currentVisibleRows: VisibleRow[];
  visibleScopeLeafNodeIds: number[];
  currentAliveLeafNodeIds: number[];
  fullTreeLeafNodeIds: number[];
  buildScopedRows: (leafNodeIds: number[]) => VisibleRow[];
  requestGenomeScope: (filters: GenomeFilterRequest, leafNodeIds: number[]) => Promise<TreeFilterGenomesResponse>;
};

type BranchPrunePlannerResult =
  | {
      ok: true;
      plan: BranchPrunePlan;
    }
  | {
      ok: false;
      errorCode: BranchPruneErrorCode;
      errorDetail: string | null;
    };

type LongBranchStage = {
  removedNodeIds: number[];
  removedLeafNodeIds: number[];
  q1: number | null;
  q3: number | null;
  upperBound: number | null;
};

type SmallBranchStage = {
  removedNodeIds: number[];
  removedLeafNodeIds: number[];
};

export function normalizeBranchPruneDraft(draft: BranchPruneDraft): NormalizedBranchPruneDraft {
  const normalizeNumber = (rawValue: string, integerOnly: boolean) => {
    const trimmed = rawValue.trim();
    if (!trimmed) return { value: null, error: false };
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0 || (integerOnly && !Number.isInteger(value))) {
      return { value: null, error: true };
    }
    return { value, error: false };
  };

  const minCompleteness = normalizeNumber(draft.minCompleteness, false);
  if (minCompleteness.error) {
    return emptyNormalizedBranchPruneDraft("invalid_min_completeness");
  }

  const maxContamination = normalizeNumber(draft.maxContamination, false);
  if (maxContamination.error) {
    return emptyNormalizedBranchPruneDraft("invalid_max_contamination");
  }

  const minQuality = normalizeNumber(draft.minQuality, false);
  if (minQuality.error) {
    return emptyNormalizedBranchPruneDraft("invalid_min_quality");
  }

  const maxContig = normalizeNumber(draft.maxContig, true);
  if (maxContig.error) {
    return emptyNormalizedBranchPruneDraft("invalid_max_contig");
  }

  const iqrMultiplier = normalizeNumber(draft.longBranchIqrMultiplier, false);
  if (iqrMultiplier.error || (iqrMultiplier.value !== null && iqrMultiplier.value <= 0)) {
    return emptyNormalizedBranchPruneDraft("invalid_long_branch_iqr_multiplier");
  }

  const minimumTerminalLeafCount = normalizeNumber(draft.minimumTerminalLeafCount, true);
  if (
    minimumTerminalLeafCount.error
    || (minimumTerminalLeafCount.value !== null && minimumTerminalLeafCount.value <= 0)
  ) {
    return emptyNormalizedBranchPruneDraft("invalid_minimum_terminal_leaf_count");
  }

  const remoteFilters: GenomeFilterRequest = {
    if_refseq: draft.refseqOnly ? true : null,
    min_checkm2_completeness: minCompleteness.value,
    max_checkm2_contamination: maxContamination.value,
    min_quality_score: minQuality.value,
    max_contig: maxContig.value,
  };
  const activeRules: BranchPruneRule[] = [];
  if (Object.values(remoteFilters).some((value) => value !== null && value !== undefined)) {
    activeRules.push("genome_metadata");
  }
  if (iqrMultiplier.value !== null) {
    activeRules.push("long_branch");
  }
  if (minimumTerminalLeafCount.value !== null) {
    activeRules.push("small_branch");
  }

  return {
    remoteFilters,
    longBranchIqrMultiplier: iqrMultiplier.value,
    minimumTerminalLeafCount: minimumTerminalLeafCount.value,
    activeRules,
    errorCode: null,
  };
}

export async function planBranchPrune(input: BranchPrunePlannerInput): Promise<BranchPrunePlannerResult> {
  const normalized = normalizeBranchPruneDraft(input.draft);
  if (normalized.errorCode) {
    return { ok: false, errorCode: normalized.errorCode, errorDetail: null };
  }
  if (!input.visibleScopeLeafNodeIds.length) {
    return { ok: false, errorCode: "empty_scope", errorDetail: null };
  }
  if (!normalized.activeRules.length) {
    return { ok: false, errorCode: "empty_filters", errorDetail: null };
  }

  let scopedLeafNodeIds = sortUniqueNumbers(input.visibleScopeLeafNodeIds);
  let scopedRows = input.currentVisibleRows;
  let genomeMetadata: BranchPruneSummary["genomeMetadata"] = null;

  try {
    if (normalized.activeRules.includes("genome_metadata")) {
      const response = await input.requestGenomeScope(normalized.remoteFilters, scopedLeafNodeIds);
      scopedLeafNodeIds = sortUniqueNumbers(response.kept_leaf_node_ids);
      scopedRows = input.buildScopedRows(scopedLeafNodeIds);
      genomeMetadata = {
        keptGenomeCount: response.kept_genome_count,
        removedGenomeCount: response.removed_genome_ids.length,
        removedLeafCount: response.removed_leaf_node_ids.length,
      };
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: "request_failed",
      errorDetail: error instanceof Error ? error.message : null,
    };
  }

  let longBranch: BranchPruneSummary["longBranch"] = null;
  if (normalized.longBranchIqrMultiplier !== null) {
    const stage = collectLongBranchStage(input.treeModel, scopedRows, normalized.longBranchIqrMultiplier);
    longBranch = {
      multiplier: normalized.longBranchIqrMultiplier,
      q1: stage.q1,
      q3: stage.q3,
      upperBound: stage.upperBound,
      removedSourceCount: stage.removedNodeIds.length,
      removedLeafCount: stage.removedLeafNodeIds.length,
    };
    if (stage.removedLeafNodeIds.length) {
      const removedLeafNodeIds = new Set(stage.removedLeafNodeIds);
      scopedLeafNodeIds = scopedLeafNodeIds.filter((leafNodeId) => !removedLeafNodeIds.has(leafNodeId));
      scopedRows = input.buildScopedRows(scopedLeafNodeIds);
    }
  }

  let smallBranch: BranchPruneSummary["smallBranch"] = null;
  if (normalized.minimumTerminalLeafCount !== null) {
    const stage = collectSmallBranchStage(scopedRows, normalized.minimumTerminalLeafCount);
    smallBranch = {
      minimumTerminalLeafCount: normalized.minimumTerminalLeafCount,
      removedSourceCount: stage.removedNodeIds.length,
      removedLeafCount: stage.removedLeafNodeIds.length,
    };
    if (stage.removedLeafNodeIds.length) {
      const removedLeafNodeIds = new Set(stage.removedLeafNodeIds);
      scopedLeafNodeIds = scopedLeafNodeIds.filter((leafNodeId) => !removedLeafNodeIds.has(leafNodeId));
      scopedRows = input.buildScopedRows(scopedLeafNodeIds);
    }
  }

  const previewNodeIds = collectPreviewNodeIds(input.currentVisibleRows, scopedRows);
  const nextAliveLeafNodeIds = mergeVisibleScopeIntoAliveScope(
    input.currentAliveLeafNodeIds,
    input.visibleScopeLeafNodeIds,
    scopedLeafNodeIds,
    input.fullTreeLeafNodeIds,
  );

  return {
    ok: true,
    plan: {
      nextAliveLeafNodeIds,
      previewNodeIds,
      summary: {
        mode: input.mode,
        activeRules: normalized.activeRules,
        currentScopeLeafCount: input.visibleScopeLeafNodeIds.length,
        keptLeafCount: scopedLeafNodeIds.length,
        removedLeafCount: Math.max(0, input.visibleScopeLeafNodeIds.length - scopedLeafNodeIds.length),
        currentTerminalCount: input.currentVisibleRows.length,
        keptTerminalCount: scopedRows.length,
        removedTerminalCount: Math.max(0, input.currentVisibleRows.length - scopedRows.length),
        previewSourceCount: previewNodeIds.size,
        genomeMetadata,
        longBranch,
        smallBranch,
      },
    },
  };
}

function emptyNormalizedBranchPruneDraft(errorCode: BranchPruneErrorCode): NormalizedBranchPruneDraft {
  return {
    remoteFilters: {},
    longBranchIqrMultiplier: null,
    minimumTerminalLeafCount: null,
    activeRules: [],
    errorCode,
  };
}

function collectLongBranchStage(
  treeModel: TreeCoreViewModel,
  rows: VisibleRow[],
  multiplier: number,
): LongBranchStage {
  const candidates = rows
    .map((row) => ({ nodeId: row.nodeId, branchLength: treeModel.branchLengthOf(row.nodeId), leafNodeIds: row.ownedLeafNodeIds }))
    .filter((item) => item.branchLength > 0);
  if (!candidates.length) {
    return { removedNodeIds: [], removedLeafNodeIds: [], q1: null, q3: null, upperBound: null };
  }
  const sorted = candidates.map((item) => item.branchLength).sort((left, right) => left - right);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const upperBound = q3 + (q3 - q1) * multiplier;
  const removed = candidates.filter((item) => item.branchLength > upperBound);
  return {
    removedNodeIds: removed.map((item) => item.nodeId),
    removedLeafNodeIds: sortUniqueNumbers(removed.flatMap((item) => item.leafNodeIds)),
    q1,
    q3,
    upperBound,
  };
}

function collectSmallBranchStage(rows: VisibleRow[], minimumTerminalLeafCount: number): SmallBranchStage {
  const removedRows = rows.filter((row) => row.ownedLeafNodeIds.length < minimumTerminalLeafCount);
  return {
    removedNodeIds: removedRows.map((row) => row.nodeId),
    removedLeafNodeIds: sortUniqueNumbers(removedRows.flatMap((row) => row.ownedLeafNodeIds)),
  };
}

function collectPreviewNodeIds(previousRows: VisibleRow[], nextRows: VisibleRow[]) {
  const nextNodeIds = new Set(nextRows.map((row) => row.nodeId));
  return new Set(previousRows.filter((row) => !nextNodeIds.has(row.nodeId)).map((row) => row.nodeId));
}

function mergeVisibleScopeIntoAliveScope(
  currentAliveLeafNodeIds: number[],
  visibleScopeLeafNodeIds: number[],
  nextVisibleLeafNodeIds: number[],
  fullTreeLeafNodeIds: number[],
) {
  const visibleScope = new Set(visibleScopeLeafNodeIds);
  const merged = [
    ...currentAliveLeafNodeIds.filter((leafNodeId) => !visibleScope.has(leafNodeId)),
    ...nextVisibleLeafNodeIds,
  ];
  const nextAliveLeafNodeIds = sortUniqueNumbers(merged);
  if (sameNumberList(nextAliveLeafNodeIds, fullTreeLeafNodeIds)) {
    return null;
  }
  return nextAliveLeafNodeIds;
}

function sortUniqueNumbers(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function sameNumberList(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function quantile(sortedValues: number[], ratio: number) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
