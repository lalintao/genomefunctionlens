import type { TerminalCutSnapshot } from "../../tree-core/terminalCutSnapshot";
import { heatCellFill, isModuleCompletenessColumn, normalizeColumnKey, ratioValueLabel } from "../resultVisualUtils";
import type { DisplayColumn, HeatmapMetric, HeatmapStyleRecord, RatioDisplayMode, TreeLayoutNode, VisibleRow } from "../resultTypes";
import type { RenderRow, ResolvedHeatmapCell, ResultRenderSnapshot } from "./renderSnapshot";
import { compileTreeStyleProjection } from "./treeStyleProjection";
import type { TreeStyleRecord } from "../treeStyleModel";
import type { TreeCoreViewModel } from "../../tree-core/treeCoreView";
import { frozenArray, immutableMap } from "../../../shared/immutableCollections";
import type { RenderRowRange, RenderTaxonomyGroup, RenderTreeNode } from "./renderSnapshot";
import { RECT_TREE_ROOT_X } from "../resultVisualConstants";
import type { TaxonColorPlan } from "../taxonColorSystem";
import { groupHeatmapBorderEdges, heatmapBorderEdges, type HeatmapBorderCell } from "../heatmapBorderModel";

export interface RenderCompileInput {
  terminalCut: TerminalCutSnapshot;
  visibleRows: readonly VisibleRow[];
  treeLayoutNodes: readonly TreeLayoutNode[];
  columns: readonly DisplayColumn[];
  rowCounts: ReadonlyMap<string, number>;
  rowSpeciesHits: ReadonlyMap<string, number>;
  cellValues: ReadonlyMap<string, number>;
  leafStyleMap: ReadonlyMap<string, HeatmapStyleRecord>;
  defaultHeatmapStyle: HeatmapStyleRecord;
  metric: HeatmapMetric;
  ratioDisplayMode: RatioDisplayMode;
  treeStyles: readonly TreeStyleRecord[];
  treeModel: TreeCoreViewModel | null;
  taxonColorPlan: TaxonColorPlan<RenderTaxonomyGroup>;
}

interface StyleCandidate {
  position: number;
  style: HeatmapStyleRecord;
}

let nextRenderRevision = 1;

interface RenderTopologyCache {
  terminalCut: TerminalCutSnapshot;
  visibleRows: readonly VisibleRow[];
  treeLayoutNodes: readonly TreeLayoutNode[];
  columns: readonly DisplayColumn[];
  treeModel: TreeCoreViewModel | null;
  rows: readonly RenderRow[];
  columnsSnapshot: readonly Readonly<DisplayColumn>[];
  treeNodes: readonly RenderTreeNode[];
  treeNodeById: ReadonlyMap<number, RenderTreeNode>;
  treeNodeByNodeId: ReadonlyMap<number, RenderTreeNode>;
  renderRowByTerminalIndex: ReadonlyMap<number, RenderRow>;
  rowIndexById: ReadonlyMap<string, number>;
  rowIndexByNodeId: ReadonlyMap<number, number>;
  rowRangeByNodeId: ReadonlyMap<number, RenderRowRange>;
}

let lastTopologyCache: RenderTopologyCache | null = null;

function compileRenderTopology(input: RenderCompileInput): RenderTopologyCache {
  if (lastTopologyCache
    && lastTopologyCache.terminalCut === input.terminalCut
    && lastTopologyCache.visibleRows === input.visibleRows
    && lastTopologyCache.treeLayoutNodes === input.treeLayoutNodes
    && lastTopologyCache.columns === input.columns
    && lastTopologyCache.treeModel === input.treeModel) {
    return lastTopologyCache;
  }
  const rows: RenderRow[] = input.visibleRows.map((row) => Object.freeze({
    id: row.id,
    kind: "terminal",
    nodeId: row.nodeId,
    rank: row.rank,
    label: row.label,
    collapseCeilingRank: row.collapseCeilingRank,
    y: row.y,
    leafCount: input.terminalCut.rows[input.terminalCut.rowIndexByNodeId.get(row.nodeId) ?? -1]?.ownedLeafNodeIds.length ?? 0,
  }));
  const renderRowByTerminalIndex = new Map<number, RenderRow>();
  rows.forEach((row) => {
    const rowIndex = input.terminalCut.rowIndexByNodeId.get(row.nodeId);
    if (rowIndex !== undefined) renderRowByTerminalIndex.set(rowIndex, row);
  });
  const columnsSnapshot = input.columns.map((column) => Object.freeze({ ...column }));
  const treeNodes: RenderTreeNode[] = input.treeLayoutNodes.map(({ ownedLeafNodeIds: _ownedLeafNodeIds, children, nodePath, ...node }) => Object.freeze({
    ...node,
    children: frozenArray(children),
    nodePath: frozenArray(nodePath),
    tooltipLabel: node.kind === "internal"
      ? input.treeModel?.runtime.taxonBindingsByNode.get(node.nodeId)?.at(-1)?.taxonName.trim() ?? ""
      : node.label.trim(),
  }));
  const treeNodeById = new Map(treeNodes.map((node) => [node.id, node]));
  const treeNodeByNodeId = new Map(treeNodes.map((node) => [node.nodeId, node]));
  const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
  const rowIndexByNodeId = new Map(rows.map((row, index) => [row.nodeId, index]));
  const rowRangeByNodeId = new Map<number, RenderRowRange>();
  // Iterate backwards without copying the whole topology. Use a loop instead
  // of spreading child ranges so a wide polytomy cannot overflow the JS stack.
  for (let index = treeNodes.length - 1; index >= 0; index -= 1) {
    const node = treeNodes[index];
    const directRowIndex = rowIndexByNodeId.get(node.nodeId);
    if (directRowIndex !== undefined) {
      rowRangeByNodeId.set(node.nodeId, Object.freeze({ startIndex: directRowIndex, endIndex: directRowIndex }));
      continue;
    }
    let startIndex = Number.POSITIVE_INFINITY;
    let endIndex = Number.NEGATIVE_INFINITY;
    for (const childId of node.children) {
      const range = rowRangeByNodeId.get(treeNodeById.get(childId)?.nodeId ?? -1);
      if (!range) continue;
      if (range.startIndex < startIndex) startIndex = range.startIndex;
      if (range.endIndex > endIndex) endIndex = range.endIndex;
    }
    if (Number.isFinite(startIndex) && Number.isFinite(endIndex)) {
      rowRangeByNodeId.set(node.nodeId, Object.freeze({ startIndex, endIndex }));
    }
  }
  lastTopologyCache = {
    terminalCut: input.terminalCut, visibleRows: input.visibleRows, treeLayoutNodes: input.treeLayoutNodes,
    columns: input.columns, treeModel: input.treeModel, rows: frozenArray(rows), columnsSnapshot: frozenArray(columnsSnapshot),
    treeNodes: frozenArray(treeNodes), treeNodeById: immutableMap(treeNodeById), treeNodeByNodeId: immutableMap(treeNodeByNodeId),
    renderRowByTerminalIndex: immutableMap(renderRowByTerminalIndex), rowIndexById: immutableMap(rowIndexById),
    rowIndexByNodeId: immutableMap(rowIndexByNodeId), rowRangeByNodeId: immutableMap(rowRangeByNodeId),
  };
  return lastTopologyCache;
}

function sourceXResolver(treeLayoutNodes: readonly TreeLayoutNode[], treeModel: TreeCoreViewModel | null) {
  const sourceNodeByNodeId = new Map(treeLayoutNodes.map((node) => [node.nodeId, node]));
  return (nodeId: number) => {
    const visible = sourceNodeByNodeId.get(nodeId);
    if (visible) return visible.x;
    if (!treeModel) return 0;
    return RECT_TREE_ROOT_X + treeModel.cumulativeBranchLengthOf(nodeId) * 330 / Math.max(0.0001, treeModel.maxCumulativeBranchLength || 1);
  };
}

export interface RenderTaxonomyGroupCompileInput {
  visibleRows: readonly Pick<VisibleRow, "nodeId">[];
  treeLayoutNodes: readonly TreeLayoutNode[];
  treeModel: TreeCoreViewModel | null;
  activeStripRank: string;
}

export function compileRenderTaxonomyGroups(input: RenderTaxonomyGroupCompileInput): readonly RenderTaxonomyGroup[] {
  if (!input.treeModel || input.activeStripRank === "none") return frozenArray([]);
  const sourceX = sourceXResolver(input.treeLayoutNodes, input.treeModel);
  const treeNodeByNodeId = new Map(input.treeLayoutNodes.map((node) => [node.nodeId, node]));
  const groups: RenderTaxonomyGroup[] = [];
  let active: {
    label: string;
    startIndex: number;
    endIndex: number;
    nodeIds: number[];
    commonPath: readonly number[];
  } | null = null;

  const finishActive = () => {
    if (!active) return;
    const rootNodeId = active.nodeIds.length === 1
      ? active.nodeIds[0]
      : active.commonPath.at(-1) ?? active.nodeIds[0];
    groups.push(Object.freeze({
      label: active.label,
      startIndex: active.startIndex,
      endIndex: active.endIndex,
      nodeIds: Object.freeze(active.nodeIds),
      rootNodeId,
      rootX: sourceX(rootNodeId),
    }));
    active = null;
  };

  input.visibleRows.forEach((row, index) => {
    const label = input.treeModel?.taxonomyValue(row.nodeId, input.activeStripRank) ?? "";
    if (!label) {
      finishActive();
      return;
    }
    const nodePath = treeNodeByNodeId.get(row.nodeId)?.nodePath ?? [];
    if (!active || active.label !== label || active.endIndex !== index - 1) {
      finishActive();
      active = { label, startIndex: index, endIndex: index, nodeIds: [row.nodeId], commonPath: nodePath };
      return;
    }
    // Extend the group in place. Rebuilding every prior path for each row made
    // one large contiguous taxon group quadratic during rank expansion.
    active.endIndex = index;
    active.nodeIds.push(row.nodeId);
    let prefix = 0;
    const limit = Math.min(active.commonPath.length, nodePath.length);
    while (prefix < limit && active.commonPath[prefix] === nodePath[prefix]) prefix += 1;
    if (prefix < active.commonPath.length) active.commonPath = active.commonPath.slice(0, prefix);
  });
  finishActive();
  return frozenArray(groups);
}
function parseLeafCellKey(key: string) {
  const separator = key.indexOf("::");
  if (separator < 1) return null;
  const leafNodeId = Number(key.slice(0, separator));
  if (!Number.isInteger(leafNodeId)) return null;
  return { leafNodeId, columnKey: key.slice(separator + 2) };
}

/** Resolve semantic data into the leaf-free structures used by every painter. */
export function compileResultRenderSnapshot(input: RenderCompileInput): ResultRenderSnapshot {
  const topology = compileRenderTopology(input);
  const { rows: renderRows, columnsSnapshot: renderColumns, renderRowByTerminalIndex } = topology;
  // This preserves the legacy "first styled owned leaf wins" rule in O(S),
  // where S is the number of styled leaf cells.
  const styleByCellKey = new Map<string, StyleCandidate>();
  input.leafStyleMap.forEach((style, leafKey) => {
    const parsed = parseLeafCellKey(leafKey);
    if (!parsed) return;
    const owner = input.terminalCut.leafOwnerByNodeId.get(parsed.leafNodeId);
    const row = owner ? renderRowByTerminalIndex.get(owner.rowIndex) : undefined;
    if (!owner || !row) return;
    const key = `${row.id}::${parsed.columnKey}`;
    const current = styleByCellKey.get(key);
    if (!current || owner.position < current.position) styleByCellKey.set(key, { position: owner.position, style });
  });

  const renderColumnMeta = renderColumns.map((column) => ({
    column,
    columnKey: normalizeColumnKey(column),
    metric: isModuleCompletenessColumn(column) ? "ratio" as const : input.metric,
  }));
  const cells: ResolvedHeatmapCell[] = [];
  const cellByKey = new Map<string, ResolvedHeatmapCell>();
  const cellsByColumnKey = new Map<string, ResolvedHeatmapCell[]>();
  const cellsByRowId = new Map<string, ResolvedHeatmapCell[]>();
  renderRows.forEach((row) => {
    const rowCells: ResolvedHeatmapCell[] = [];
    renderColumnMeta.forEach(({ column, columnKey, metric }) => {
      const key = `${row.id}::${columnKey}`;
      const count = input.rowCounts.get(key) ?? 0;
      const speciesHits = input.rowSpeciesHits.get(key) ?? 0;
      const value = input.cellValues.get(key) ?? 0;
      const style = styleByCellKey.get(key)?.style ?? null;
      const effectiveStyle = style ?? input.defaultHeatmapStyle;
      const cell: ResolvedHeatmapCell = Object.freeze({
        key,
        row,
        column,
        columnKey,
        count,
        speciesHits,
        value,
        styleId: effectiveStyle.id,
        shape: style?.shape ?? input.defaultHeatmapStyle.shape,
        borderMode: effectiveStyle.borderMode,
        fill: heatCellFill(count, value, metric, style, input.defaultHeatmapStyle),
        label: metric === "ratio" ? ratioValueLabel(speciesHits, row.leafCount, input.ratioDisplayMode) : String(count),
      });
      cells.push(cell);
      rowCells.push(cell);
      cellByKey.set(key, cell);
      const columnCells = cellsByColumnKey.get(columnKey) ?? [];
      columnCells.push(cell);
      cellsByColumnKey.set(columnKey, columnCells);
    });
    cellsByRowId.set(row.id, rowCells);
  });
  cells.sort((left, right) => left.row.y - right.row.y || left.column.slotIndex - right.column.slotIndex);

  const rowIndexById = topology.rowIndexById;
  const heatmapBorderCells: HeatmapBorderCell[] = cells.map((cell) => ({
    rowIndex: rowIndexById.get(cell.row.id) ?? 0,
    slotIndex: cell.column.slotIndex,
    styleId: cell.styleId,
    borderMode: cell.borderMode,
  }));
  const rectangularHeatmapBorderEdges = heatmapBorderEdges(heatmapBorderCells, { rowCount: renderRows.length });
  const circularHeatmapBorderEdges = heatmapBorderEdges(heatmapBorderCells, { rowCount: renderRows.length });
  const circularWrappedHeatmapBorderEdges = heatmapBorderEdges(heatmapBorderCells, { rowCount: renderRows.length, wrapRows: true });
  const rectangularHeatmapBorderEdgesByBoundary = groupHeatmapBorderEdges(rectangularHeatmapBorderEdges);
  const circularHeatmapBorderEdgesByBoundary = groupHeatmapBorderEdges(circularHeatmapBorderEdges);
  const circularWrappedHeatmapBorderEdgesByBoundary = groupHeatmapBorderEdges(circularWrappedHeatmapBorderEdges);

  const { treeNodes, treeNodeById, treeNodeByNodeId, rowRangeByNodeId } = topology;
  const frozenCellsByColumnKey = new Map(Array.from(cellsByColumnKey, ([key, columnCells]) => [key, frozenArray(columnCells)] as const));
  const snapshot: ResultRenderSnapshot = {
    revision: `render-${nextRenderRevision++}`,
    rows: renderRows,
    treeNodes,
    cells: frozenArray(cells),
    cellByKey: immutableMap(cellByKey),
    cellsByColumnKey: immutableMap(frozenCellsByColumnKey),
    cellsByRowId: immutableMap(new Map(Array.from(cellsByRowId, ([key, rowCells]) => [key, frozenArray(rowCells)] as const))),
    heatmapBorderCells: frozenArray(heatmapBorderCells),
    rectangularHeatmapBorderEdges: frozenArray(rectangularHeatmapBorderEdges),
    rectangularHeatmapBorderEdgesByBoundary: Object.freeze({
      interior: frozenArray(rectangularHeatmapBorderEdgesByBoundary.interior),
      perimeter: frozenArray(rectangularHeatmapBorderEdgesByBoundary.perimeter),
    }),
    circularHeatmapBorderEdges: frozenArray(circularHeatmapBorderEdges),
    circularHeatmapBorderEdgesByBoundary: Object.freeze({
      interior: frozenArray(circularHeatmapBorderEdgesByBoundary.interior),
      perimeter: frozenArray(circularHeatmapBorderEdgesByBoundary.perimeter),
    }),
    circularWrappedHeatmapBorderEdges: frozenArray(circularWrappedHeatmapBorderEdges),
    circularWrappedHeatmapBorderEdgesByBoundary: Object.freeze({
      interior: frozenArray(circularWrappedHeatmapBorderEdgesByBoundary.interior),
      perimeter: frozenArray(circularWrappedHeatmapBorderEdgesByBoundary.perimeter),
    }),
    treeNodeById: immutableMap(treeNodeById),
    treeNodeByNodeId: immutableMap(treeNodeByNodeId),
    rowRangeByNodeId: immutableMap(rowRangeByNodeId),
    taxonColorPlan: input.taxonColorPlan,
    treeStyles: compileTreeStyleProjection(input.treeStyles, treeNodes, renderRows, sourceXResolver(input.treeLayoutNodes, input.treeModel)),
  };
  return Object.freeze(snapshot);
}
