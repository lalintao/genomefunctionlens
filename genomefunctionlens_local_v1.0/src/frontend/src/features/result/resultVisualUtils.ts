import type { ModuleQueryInfo, SearchColumn } from "../../types";
import type { TreeCoreViewModel } from "../tree-core/treeCoreView";
import { RANKS } from "./resultConstants";
import { RECT_COLUMN_LABEL_ROTATION, TREE_FONT_FAMILY } from "./resultVisualConstants";
import type { DisplayColumn, HeatmapDisplayColumn, HeatmapMetric, HeatmapStyleRecord, RatioDisplayMode, VisibleRow } from "./resultTypes";
import { colorForHeatmapValue, colorScalesForStyle } from "./heatmapStyleModel";
const heatmapScaleCache = new WeakMap<HeatmapStyleRecord, ReturnType<typeof colorScalesForStyle>>();

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function branchGuideStrokeWidth(branchStrokeWidth: number, highlighted = false) {
  const baseWidth = branchStrokeWidth;
  return highlighted ? baseWidth + Math.min(1, branchStrokeWidth * 0.15) : baseWidth;
}

export function branchGuideDashArray(branchStrokeWidth: number, highlighted = false) {
  const guideWidth = branchGuideStrokeWidth(branchStrokeWidth, highlighted);
  return `${Math.max(4, guideWidth * 3.25)} ${Math.max(5, guideWidth * 4)}`;
}

export function previousRank(rank: string) {
  const index = RANKS.indexOf(rank);
  return index > 0 ? RANKS[index - 1] : RANKS[0];
}

export function canvasFont(size: number, weight = 500) {
  return `${weight} ${size}px ${TREE_FONT_FAMILY}`;
}

export function formatBranchLength(value: number, maxChars = 6) {
  const candidates = [
    value >= 100 ? value.toFixed(0) : value.toFixed(2),
    value >= 100 ? value.toFixed(0) : value.toFixed(1),
    value.toPrecision(2),
    value.toPrecision(1),
  ];
  return candidates.find((item) => item.length <= maxChars) ?? candidates[candidates.length - 1];
}

export function rectangularTreeStyleRowBand(rows: readonly { y: number }[], startIndex: number, endIndex: number, rowHeight: number) {
  const first = rows[startIndex];
  const last = rows[endIndex];
  if (!first || !last) return null;
  const top = first.y;
  const height = last.y - first.y + rowHeight;
  return { top, height, center: top + height / 2 };
}

export function normalizeColumnKey(column: Pick<SearchColumn, "type" | "value"> & { column_id?: string | null }) {
  return "column_id" in column && column.column_id ? column.column_id : `${column.type}|${column.value}`;
}

export function leafCellKey(leafNodeId: number, column: Pick<SearchColumn, "type" | "value"> & { column_id?: string | null }) {
  return `${leafNodeId}::${normalizeColumnKey(column)}`;
}

export function rowCellKey(row: Pick<VisibleRow, "id">, column: Pick<SearchColumn, "type" | "value"> & { column_id?: string | null }) {
  return `${row.id}::${normalizeColumnKey(column)}`;
}

export function isHeatmapDisplayColumn(column: DisplayColumn): column is HeatmapDisplayColumn {
  return column.kind === "column";
}

export function heatmapSlotSpan(columns: DisplayColumn[]) {
  return columns.length
    ? Math.max(...columns.map((column) => column.slotIndex + (column.reserveTrailingGap ? 2 : 1)))
    : 0;
}

export function isModuleCompletenessColumn(column: Pick<SearchColumn, "column_role" | "type">) {
  return column.column_role === "module_completeness" || column.type === "module";
}

export function isModuleDetailColumn(column: Pick<SearchColumn, "column_role">) {
  return column.column_role === "module_detail";
}

export function moduleBraceLabel(moduleId: string, moduleName: string | null | undefined, showModuleNames: boolean, showModuleFullName = false) {
  if (!showModuleNames) return "";
  if (!showModuleFullName || !moduleName) return moduleId;
  const compactName = moduleName.trim();
  if (!compactName) return moduleId;
  return `${moduleId} ${compactName}`;
}

export function moduleColumnRanges(moduleQuery: ModuleQueryInfo | null, columns: DisplayColumn[]) {
  return moduleQuery?.modules.map((module) => {
    const slotIndexes = module.column_ids
      .map((columnId) => columns.find((column) => normalizeColumnKey(column) === columnId)?.slotIndex)
      .filter((slotIndex): slotIndex is number => slotIndex !== undefined);
    if (!slotIndexes.length) return null;
    return {
      moduleId: module.module_id,
      moduleName: module.module_name,
      start: Math.min(...slotIndexes),
      end: Math.max(...slotIndexes),
    };
  }).filter((item): item is { moduleId: string; moduleName: string; start: number; end: number } => Boolean(item)) ?? [];
}

export function moduleBracePath(x: number, widthValue: number, topY: number, bottomY: number) {
  const right = x + widthValue;
  const mid = x + widthValue / 2;
  const cap = Math.min(14, Math.max(10, widthValue * 0.08));
  const neck = Math.min(18, Math.max(12, widthValue * 0.1));
  const shoulderY = topY + 10;
  const cuspY = topY;
  const endY = bottomY;
  return [
    `M ${x} ${endY}`,
    `C ${x} ${shoulderY + 4}, ${x + cap * 0.2} ${shoulderY}, ${x + cap} ${shoulderY}`,
    `L ${mid - neck} ${shoulderY}`,
    `C ${mid - neck * 0.45} ${shoulderY}, ${mid - neck * 0.18} ${shoulderY - 5}, ${mid} ${cuspY}`,
    `C ${mid + neck * 0.18} ${shoulderY - 5}, ${mid + neck * 0.45} ${shoulderY}, ${mid + neck} ${shoulderY}`,
    `L ${right - cap} ${shoulderY}`,
    `C ${right - cap * 0.2} ${shoulderY}, ${right} ${shoulderY + 4}, ${right} ${endY}`,
  ].join(" ");
}

export function rectangularModuleHeaderLayout(fontSize: number) {
  const labelBaseline = Math.max(22, Math.ceil(fontSize));
  const braceTop = labelBaseline + 6;
  return { labelBaseline, braceTop, braceBottom: braceTop + 18 };
}

export function columnLabelWidth(label: string, fontSize = 13) {
  return Math.max(46, label.length * fontSize * 0.58 + fontSize + 10);
}

export function rectangularColumnLabelProjection(labelWidth: number) {
  const radians = Math.abs(RECT_COLUMN_LABEL_ROTATION) * Math.PI / 180;
  return {
    height: labelWidth * Math.sin(radians) + 26,
    width: labelWidth * Math.cos(radians) + 32,
  };
}

export function heatCellFill(count: number, value: number, metric: HeatmapMetric, style: HeatmapStyleRecord | null, fallbackStyle: HeatmapStyleRecord) {
  const target = style ?? fallbackStyle;
  let scales = heatmapScaleCache.get(target);
  if (!scales) {
    scales = colorScalesForStyle(target);
    heatmapScaleCache.set(target, scales);
  }
  return colorForHeatmapValue(metric === "count" ? count : value, scales[metric]);
}

export function ratioValueLabel(hitCount: number, totalCount: number, mode: RatioDisplayMode) {
  if (mode === "percent") return `${Math.round(totalCount ? hitCount / totalCount * 100 : 0)}%`;
  return `${hitCount}/${totalCount}`;
}

let circularLabelMeasurementContext: CanvasRenderingContext2D | null | undefined;

export function circularLabelWidth(label: string, fontSize = 12) {
  if (circularLabelMeasurementContext === undefined && typeof document !== "undefined") {
    circularLabelMeasurementContext = document.createElement("canvas").getContext("2d");
  }
  if (circularLabelMeasurementContext) {
    circularLabelMeasurementContext.font = canvasFont(fontSize, 500);
    return Math.max(84, Math.ceil(circularLabelMeasurementContext.measureText(label).width + fontSize + 20));
  }
  return Math.max(84, Math.ceil(label.length * fontSize * 0.58 + fontSize + 20));
}

export function taxonomyValue(tree: TreeCoreViewModel, nodeId: number, rank: string) {
  return tree.taxonomyValue(nodeId, rank);
}

export function sourceName(tree: TreeCoreViewModel, nodeId: number) {
  return tree.sourceName(nodeId);
}

export function sourceLabel(tree: TreeCoreViewModel, nodeId: number, rank: string | null = null) {
  return tree.sourceLabel(nodeId, rank);
}

export function deepestRank(tree: TreeCoreViewModel, nodeId: number) {
  return tree.deepestRank(nodeId);
}

export function isRankRoot(tree: TreeCoreViewModel, nodeId: number, rank: string) {
  return tree.isRankRoot(nodeId, rank);
}

export function exactTaxonRank(tree: TreeCoreViewModel, nodeId: number) {
  return tree.exactTaxonRank(nodeId);
}

export function branchRank(tree: TreeCoreViewModel, nodeId: number, fallbackRank: string | null = null) {
  return tree.branchRank(nodeId, fallbackRank);
}

export function taxonomyPath(tree: TreeCoreViewModel, nodeId: number) {
  return tree.taxonomyPath(nodeId);
}

export function taxonRootForRank(tree: TreeCoreViewModel, nodeId: number, rank: string) {
  return tree.taxonRootForRank(nodeId, rank);
}

export function isAncestorOf(tree: TreeCoreViewModel, ancestorNodeId: number, nodeId: number) {
  return tree.isAncestorOf(ancestorNodeId, nodeId);
}
