import type { HeatmapAggregateResponse } from "../../types";

export interface HeatmapAggregationColumn {
  annotation_id?: number | null;
  type: string;
  value: string;
}

export interface HeatmapAggregationInput {
  speciesTree: string;
  datasetRevision?: string;
  genomeDatabase: string;
  terminalRows: Array<{ nodeId: number; ownedLeafNodeIds: number[] }>;
  annotationColumns: HeatmapAggregationColumn[];
  moduleCompletenessThreshold: number | null;
  terminalRowsKey?: string;
  leafOwnerByNodeId?: ReadonlyMap<number, { rowIndex: number; position: number }>;
}

export interface HeatmapAggregateCacheEntry {
  key: string;
  scopeKey: string;
  datasetRevision?: string;
  terminalRows: HeatmapAggregationInput["terminalRows"];
  moduleCompletenessThreshold: number | null;
  response: HeatmapAggregateResponse;
}

interface AggregateVisibleRow {
  id: string;
  nodeId: number;
}

interface AggregateDisplayColumn {
  type: string;
  value: string;
  column_id?: string | null;
}

export interface HeatmapAggregateMatrices {
  counts: Map<string, number>;
  speciesHits: Map<string, number>;
}

function aggregateIndexes(response: HeatmapAggregateResponse, columns: readonly AggregateDisplayColumn[]) {
  return {
    rowIndexByNodeId: new Map(response.row_node_ids.map((nodeId, index) => [nodeId, index])),
    columnIndexByKey: new Map(response.columns.map((column, index) => [columnKey(column), index])),
    displayColumnKeys: columns.map((column) => column.column_id || `${column.type}|${column.value}`),
  };
}

function mapAggregateMatrix(
  response: HeatmapAggregateResponse,
  visibleRows: readonly AggregateVisibleRow[],
  columns: readonly AggregateDisplayColumn[],
  matrix: readonly (readonly number[])[],
) {
  const values = new Map<string, number>();
  const { rowIndexByNodeId, columnIndexByKey, displayColumnKeys } = aggregateIndexes(response, columns);
  visibleRows.forEach((row) => {
    const rowIndex = rowIndexByNodeId.get(row.nodeId);
    if (rowIndex === undefined) return;
    columns.forEach((column, columnPosition) => {
      const columnIndex = columnIndexByKey.get(columnKey(column));
      if (columnIndex === undefined) return;
      values.set(`${row.id}::${displayColumnKeys[columnPosition]}`, matrix[rowIndex]?.[columnIndex] ?? 0);
    });
  });
  return values;
}

export function mapHeatmapAggregateMatrix(
  response: HeatmapAggregateResponse,
  visibleRows: readonly AggregateVisibleRow[],
  columns: readonly AggregateDisplayColumn[],
  matrix: readonly (readonly number[])[],
) {
  return mapAggregateMatrix(response, visibleRows, columns, matrix);
}

/** Maps both heatmap metrics in one row/column pass for the render snapshot. */
export function mapHeatmapAggregateMatrices(
  response: HeatmapAggregateResponse,
  visibleRows: readonly AggregateVisibleRow[],
  columns: readonly AggregateDisplayColumn[],
): HeatmapAggregateMatrices {
  const counts = new Map<string, number>();
  const speciesHits = new Map<string, number>();
  const { rowIndexByNodeId, columnIndexByKey, displayColumnKeys } = aggregateIndexes(response, columns);
  visibleRows.forEach((row) => {
    const rowIndex = rowIndexByNodeId.get(row.nodeId);
    if (rowIndex === undefined) return;
    columns.forEach((column, columnPosition) => {
      const columnIndex = columnIndexByKey.get(columnKey(column));
      if (columnIndex === undefined) return;
      const key = `${row.id}::${displayColumnKeys[columnPosition]}`;
      counts.set(key, response.count_matrix[rowIndex]?.[columnIndex] ?? 0);
      speciesHits.set(key, response.species_hit_count_matrix[rowIndex]?.[columnIndex] ?? 0);
    });
  });
  return { counts, speciesHits };
}

export type HeatmapAggregationPlan =
  | { kind: "reuse"; entry: HeatmapAggregateCacheEntry }
  | { kind: "project-columns"; entry: HeatmapAggregateCacheEntry }
  | { kind: "merge-columns"; entry: HeatmapAggregateCacheEntry; requestedColumns: HeatmapAggregationColumn[] }
  | { kind: "derive-collapse"; entry: HeatmapAggregateCacheEntry; sourceRowIndexes: number[][] }
  | { kind: "fetch-all"; requestedColumns: HeatmapAggregationColumn[] };

function columnKey(column: HeatmapAggregationColumn) {
  return `${column.type}\u0000${column.value}`;
}

function thresholdMatters(columns: readonly HeatmapAggregationColumn[]) {
  return columns.some((column) => column.type === "module");
}

export function heatmapAggregationScopeKey(input: Pick<HeatmapAggregationInput, "speciesTree" | "genomeDatabase" | "terminalRows" | "terminalRowsKey" | "datasetRevision">) {
  return [
    input.speciesTree,
    input.genomeDatabase,
    input.datasetRevision ?? "unversioned",
    "terminalRowsKey" in input && input.terminalRowsKey !== undefined
      ? input.terminalRowsKey
      : input.terminalRows.map((row) => `${row.nodeId}:${row.ownedLeafNodeIds.join(",")}`).join("|"),
  ].join("#");
}

export function heatmapAggregationKey(input: HeatmapAggregationInput) {
  const threshold = thresholdMatters(input.annotationColumns) ? input.moduleCompletenessThreshold ?? 80 : "none";
  return `${heatmapAggregationScopeKey(input)}#${input.annotationColumns.map(columnKey).join("|")}#${threshold}`;
}

/** Retain immutable terminal-row arrays by reference; copying million-leaf cuts per cache entry is wasteful. */
export function makeHeatmapAggregateCacheEntry(
  input: HeatmapAggregationInput,
  response: HeatmapAggregateResponse,
): HeatmapAggregateCacheEntry {
  return {
    key: heatmapAggregationKey(input),
    scopeKey: heatmapAggregationScopeKey(input),
    datasetRevision: input.datasetRevision,
    terminalRows: input.terminalRows,
    moduleCompletenessThreshold: input.moduleCompletenessThreshold,
    response,
  };
}

/** Return old rows grouped by new row only when the entire cut is a pure, order-preserving fold. */
function collapsedSourceRows(
  input: HeatmapAggregationInput,
  entry: HeatmapAggregateCacheEntry,
): number[][] | null {
  const currentRows = input.terminalRows;
  const oldRows = entry.terminalRows;
  const response = entry.response;
  if (currentRows.length >= oldRows.length
    || response.row_node_ids.length !== oldRows.length
    || response.row_leaf_counts.length !== oldRows.length
    || response.count_matrix.length !== oldRows.length
    || response.species_hit_count_matrix.length !== oldRows.length) return null;

  const rowOffsets = [0];
  const builtOwners = input.leafOwnerByNodeId ? null : new Map<number, { rowIndex: number; position: number }>();
  for (let rowIndex = 0; rowIndex < currentRows.length; rowIndex += 1) {
    const leaves = currentRows[rowIndex].ownedLeafNodeIds;
    if (!leaves.length) return null;
    rowOffsets.push(rowOffsets[rowIndex] + leaves.length);
    if (builtOwners) {
      for (let position = 0; position < leaves.length; position += 1) {
        const leafNodeId = leaves[position];
        if (builtOwners.has(leafNodeId)) return null;
        builtOwners.set(leafNodeId, { rowIndex, position });
      }
    }
  }
  const owners = input.leafOwnerByNodeId ?? builtOwners;
  if (!owners || owners.size !== rowOffsets[currentRows.length]) return null;
  const visited = new Uint8Array(owners.size);
  let visitedCount = 0;

  const sourceRowIndexes = currentRows.map(() => [] as number[]);
  for (let oldIndex = 0; oldIndex < oldRows.length; oldIndex += 1) {
    const oldRow = oldRows[oldIndex];
    if (!oldRow.ownedLeafNodeIds.length
      || response.row_node_ids[oldIndex] !== oldRow.nodeId
      || response.row_leaf_counts[oldIndex] !== oldRow.ownedLeafNodeIds.length
      || response.count_matrix[oldIndex].length !== response.columns.length
      || response.species_hit_count_matrix[oldIndex].length !== response.columns.length) return null;
    let newIndex: number | undefined;
    for (const leafNodeId of oldRow.ownedLeafNodeIds) {
      const owner = owners.get(leafNodeId);
      if (!owner || currentRows[owner.rowIndex]?.ownedLeafNodeIds[owner.position] !== leafNodeId
        || (newIndex !== undefined && newIndex !== owner.rowIndex)) return null;
      const offset = rowOffsets[owner.rowIndex] + owner.position;
      if (visited[offset]) return null;
      visited[offset] = 1;
      visitedCount += 1;
      newIndex = owner.rowIndex;
    }
    if (newIndex === undefined) return null;
    sourceRowIndexes[newIndex].push(oldIndex);
  }
  if (visitedCount !== owners.size) return null;

  let expectedOldIndex = 0;
  let mergedAnyRow = false;
  for (let newIndex = 0; newIndex < sourceRowIndexes.length; newIndex += 1) {
    const sources = sourceRowIndexes[newIndex];
    if (!sources.length) return null;
    if (sources.length > 1) mergedAnyRow = true;
    else if (oldRows[sources[0]].nodeId !== currentRows[newIndex].nodeId) return null;
    for (const sourceIndex of sources) {
      if (sourceIndex !== expectedOldIndex) return null;
      expectedOldIndex += 1;
    }
  }
  return mergedAnyRow && expectedOldIndex === oldRows.length ? sourceRowIndexes : null;
}

export function planHeatmapAggregation(
  input: HeatmapAggregationInput,
  cacheEntries: readonly HeatmapAggregateCacheEntry[],
): HeatmapAggregationPlan {
  const key = heatmapAggregationKey(input);
  const exact = cacheEntries.find((entry) => entry.key === key);
  if (exact) return { kind: "reuse", entry: exact };

  const scopeKey = heatmapAggregationScopeKey(input);
  const requestedKeys = new Set(input.annotationColumns.map(columnKey));
  const candidates = cacheEntries
    .filter((entry) => entry.scopeKey === scopeKey)
    .sort((left, right) => {
      const score = (entry: HeatmapAggregateCacheEntry) => {
        const available = new Set(entry.response.columns.map(columnKey));
        const moduleThresholdChanged = thresholdMatters(input.annotationColumns)
          && entry.moduleCompletenessThreshold !== input.moduleCompletenessThreshold;
        return input.annotationColumns.filter((column) => (
          available.has(columnKey(column)) && !(moduleThresholdChanged && column.type === "module")
        )).length;
      };
      return score(right) - score(left);
    });
  for (const entry of candidates) {
    const availableKeys = new Set(entry.response.columns.map(columnKey));
    const moduleThresholdChanged = thresholdMatters(input.annotationColumns)
      && entry.moduleCompletenessThreshold !== input.moduleCompletenessThreshold;
    const requestedColumns = input.annotationColumns.filter((column) => (
      !availableKeys.has(columnKey(column)) || (moduleThresholdChanged && column.type === "module")
    ));
    if (!requestedColumns.length && [...requestedKeys].every((value) => availableKeys.has(value))) {
      return { kind: "project-columns", entry };
    }
    return { kind: "merge-columns", entry, requestedColumns };
  }
  for (const entry of cacheEntries) {
    if (entry.response.species_tree !== input.speciesTree
      || entry.response.genome_database !== input.genomeDatabase
      || entry.datasetRevision !== input.datasetRevision
      || (thresholdMatters(input.annotationColumns)
        && entry.moduleCompletenessThreshold !== input.moduleCompletenessThreshold)) continue;
    const availableKeys = new Set(entry.response.columns.map(columnKey));
    if (![...requestedKeys].every((value) => availableKeys.has(value))) continue;
    const sourceRowIndexes = collapsedSourceRows(input, entry);
    if (sourceRowIndexes) return { kind: "derive-collapse", entry, sourceRowIndexes };
  }
  return { kind: "fetch-all", requestedColumns: input.annotationColumns };
}

/** Sum additive metrics for verified folds; ratios are recomputed from hits and leaf counts. */
export function deriveCollapsedHeatmapAggregate(
  input: HeatmapAggregationInput,
  entry: HeatmapAggregateCacheEntry,
  sourceRowIndexes: readonly (readonly number[])[],
): HeatmapAggregateResponse {
  const response = entry.response;
  const columnIndexByKey = new Map(response.columns.map((column, index) => [columnKey(column), index]));
  const selected = input.annotationColumns.map((column) => columnIndexByKey.get(columnKey(column)));
  if (selected.some((index) => index === undefined)) {
    throw new Error("Cannot derive heatmap columns that are absent from the cached aggregate response.");
  }
  const columnIndexes = selected as number[];
  const rowLeafCounts = sourceRowIndexes.map((sources) =>
    sources.reduce((total, sourceIndex) => total + response.row_leaf_counts[sourceIndex], 0));
  const sumMatrix = (matrix: number[][]) => sourceRowIndexes.map((sources) =>
    columnIndexes.map((columnIndex) => sources.reduce((total, sourceIndex) =>
      total + matrix[sourceIndex][columnIndex], 0)));
  const countMatrix = sumMatrix(response.count_matrix);
  const speciesHitCountMatrix = sumMatrix(response.species_hit_count_matrix);
  return {
    ...response,
    row_node_ids: input.terminalRows.map((row) => row.nodeId),
    columns: columnIndexes.map((index) => response.columns[index]),
    count_matrix: countMatrix,
    species_hit_count_matrix: speciesHitCountMatrix,
    ratio_matrix: speciesHitCountMatrix.map((row, rowIndex) => row.map((hits) =>
      rowLeafCounts[rowIndex] ? hits / rowLeafCounts[rowIndex] : 0)),
    row_leaf_counts: rowLeafCounts,
  };
}

/** Reorder a response to exactly the requested columns without changing rows. */
export function projectHeatmapAggregateColumns(
  response: HeatmapAggregateResponse,
  requestedColumns: readonly HeatmapAggregationColumn[],
): HeatmapAggregateResponse {
  const indexByKey = new Map(response.columns.map((column, index) => [columnKey(column), index]));
  const indexes = requestedColumns.map((column) => indexByKey.get(columnKey(column)));
  if (indexes.some((index) => index === undefined)) throw new Error("Cannot project heatmap columns that are absent from the aggregate response.");
  const selected = indexes as number[];
  return {
    ...response,
    columns: selected.map((index) => response.columns[index]),
    count_matrix: response.count_matrix.map((row) => selected.map((index) => row[index] ?? 0)),
    species_hit_count_matrix: response.species_hit_count_matrix.map((row) => selected.map((index) => row[index] ?? 0)),
    ratio_matrix: response.ratio_matrix.map((row) => selected.map((index) => row[index] ?? 0)),
  };
}

/** Merge a delta response, then restore the exact requested column order. */
export function mergeHeatmapAggregateColumns(
  base: HeatmapAggregateResponse,
  delta: HeatmapAggregateResponse,
  requestedColumns: readonly HeatmapAggregationColumn[],
): HeatmapAggregateResponse {
  if (base.row_node_ids.join(",") !== delta.row_node_ids.join(",")) {
    throw new Error("Cannot merge heatmap aggregates with different terminal rows.");
  }
  const allColumns = [...base.columns, ...delta.columns];
  const allCounts = base.count_matrix.map((row, rowIndex) => [...row, ...(delta.count_matrix[rowIndex] ?? [])]);
  const allHits = base.species_hit_count_matrix.map((row, rowIndex) => [...row, ...(delta.species_hit_count_matrix[rowIndex] ?? [])]);
  const allRatios = base.ratio_matrix.map((row, rowIndex) => [...row, ...(delta.ratio_matrix[rowIndex] ?? [])]);
  return projectHeatmapAggregateColumns({
    ...base,
    columns: allColumns,
    count_matrix: allCounts,
    species_hit_count_matrix: allHits,
    ratio_matrix: allRatios,
  }, requestedColumns);
}
