import type { AnnotationColumnSearchResult, SearchColumn } from "../../types";
import { appendHeatmapColumnKeysWithModuleGaps, normalizeHeatmapColumnSlots } from "./heatmapColumnLayout";
import type { HeatmapColumnSlot } from "./resultTypes";
import { normalizeColumnKey } from "./resultVisualUtils";

export type SearchedHeatmapColumnAppend = {
  resultSession: AnnotationColumnSearchResult;
  columnSlots: HeatmapColumnSlot[];
  appendedColumns: SearchColumn[];
};

/**
 * Adds only new searched columns. Initial search is the same operation with
 * an empty session, so every heatmap column follows one ordering rule.
 */
export function appendSearchedHeatmapColumns(
  currentSession: AnnotationColumnSearchResult | null,
  currentSlots: HeatmapColumnSlot[],
  searchedColumns: AnnotationColumnSearchResult,
): SearchedHeatmapColumnAppend {
  const baseSession: AnnotationColumnSearchResult = currentSession ?? {
    species_tree: searchedColumns.species_tree,
    genome_database: searchedColumns.genome_database,
    columns: [],
    module_groups: [],
  };
  const existingColumnKeys = new Set(baseSession.columns.map(normalizeColumnKey));
  const appendedColumns = searchedColumns.columns.filter((column) => {
    const key = normalizeColumnKey(column);
    if (existingColumnKeys.has(key)) return false;
    existingColumnKeys.add(key);
    return true;
  });
  const moduleGroups = new Map(baseSession.module_groups.map((group) => [group.module_id, group]));
  searchedColumns.module_groups.forEach((group) => moduleGroups.set(group.module_id, group));
  const columns = [...baseSession.columns, ...appendedColumns];

  return {
    resultSession: {
      ...baseSession,
      columns,
      module_groups: [...moduleGroups.values()],
    },
    columnSlots: appendHeatmapColumnKeysWithModuleGaps(
      normalizeHeatmapColumnSlots(currentSlots, baseSession.columns),
      appendedColumns.map(normalizeColumnKey),
      [...moduleGroups.values()],
    ),
    appendedColumns,
  };
}
