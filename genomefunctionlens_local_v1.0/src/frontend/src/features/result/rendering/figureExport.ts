import type { ModuleQueryInfo } from "../../../types";
import type { HeatmapBorderEdge, HeatmapBorderEdgesByBoundary } from "../heatmapBorderModel";
import type { CircularSceneGeometry } from "../canvasPresentation";
import { resolveCircularTaxonomyBackgroundRange } from "../circularRadialLayout";
import { HEATMAP_BORDER_COLOR, HEATMAP_INTERIOR_BORDER_WIDTH, HEATMAP_PERIMETER_BORDER_WIDTH } from "../heatmapBorderModel";
import type { RenderRow, RenderTaxonomyGroup, RenderTreeNode, ResultRenderSnapshot } from "../render-compiler/renderSnapshot";
import type { ResolvedTreeStyleProjection } from "../render-compiler/treeStyleProjection";
import { branchGuideDashArray, branchGuideStrokeWidth, clamp, formatBranchLength, moduleBraceLabel, moduleColumnRanges, rectangularModuleHeaderLayout, rectangularTreeStyleRowBand } from "../resultVisualUtils";
import { taxonStyleColorCss } from "../taxonColorSystem";
import type { DisplayColumn, HeatmapStyleRecord, PartitionShape, TreeLayoutNode } from "../resultTypes";
import { RECT_COLUMN_LABEL_ROTATION, TREE_FONT_FAMILY } from "../resultVisualConstants";
import { svgTextAttributes } from "../resultTypography";
import { escapeXml, exportShapeMarkup } from "../resultExport";
import type { TaxonDisplayStyle, TaxonNameDisplayMode } from "../../workbench/workbenchAppearance";
import type { HeatmapLegendState } from "../resultTypes";
import { floatingLegendExportLayout, floatingLegendSvgMarkup } from "../floatingLegend";
import type { SceneBounds, ScenePlan } from "./scenePlan";
import { polarPoint } from "../tree-renderer/canvasScene";

export interface RectangularTreeLayout {
  labelX: number;
  labelTextBudget: number;
  speciesCountX: number;
  stripX: number;
  stripWidth: number;
  stripLabelWidth: number;
  treeWidth: number;
}

export interface CircularRingLayout {
  column: DisplayColumn;
  inner: number;
  outer: number;
  center: number;
  index: number;
  width: number;
}

export interface RectangularFigureGeometry {
  mode: "rectangular";
  renderSnapshot: ResultRenderSnapshot;
  treeLayoutNodes: readonly RenderTreeNode[];
  visibleRows: readonly RenderRow[];
  visibleStripGroups: readonly RenderTaxonomyGroup[];
  layout: RectangularTreeLayout;
  columns: readonly DisplayColumn[];
  moduleQuery: ModuleQueryInfo | null;
  fallbackHeatmapStyle: HeatmapStyleRecord;
  activeStripRank: string;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  showStripLabels: boolean;
  showBranchLabels: boolean;
  showSpeciesCount: boolean;
  showInternalNodes: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  showNumbers: boolean;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  branchScale: number;
  branchStrokeWidth: number;
  rowHeight: number;
  headerHeight: number;
  contentHeight: number;
  heatmapColumnWidth: number;
  heatmapShapeSize: number;
  branchLabelFontSize: number;
  branchMetricFontSize: number;
  speciesCountFontSize: number;
  stripNameFontSize: number;
  columnLabelFontSize: number;
  moduleLabelFontSize: number;
  heatmapValueFontSize: number;
}

export interface CircularFigureBranch {
  node: TreeLayoutNode;
  parent: TreeLayoutNode;
  parentAngle: number;
  childAngle: number;
  parentRadius: number;
  childRadius: number;
}

export interface CircularFigureLabel {
  row: RenderRow;
  node: TreeLayoutNode;
  angle: number;
  point: { x: number; y: number };
}

export interface CircularFigureGeometry extends Omit<CircularSceneGeometry, "angular" | "radiusByNodeId"> {
  mode: "circular";
  cx: number;
  cy: number;
  rootX: number;
  angleByTreeNodeId: ReadonlyMap<number, number>;
  angleByLayoutNodeId: ReadonlyMap<number, number>;
  spanByNodeId: CircularSceneGeometry["angular"]["spanByNodeId"];
  ringLayouts: readonly CircularRingLayout[];
  stripGroups: readonly RenderTaxonomyGroup[];
  startAngle: number;
  endAngle: number;
  leafStep: number;
  treeOuterRadius: number;
  labelRadius: number;
  labelOuterRadius: number;
  stripInnerRadius: number;
  stripOuterRadius: number;
  heatmapInnerRadius: number;
  heatmapOuterRadius: number;
  heatmapRingWidth: number;
  heatmapRingStride: number;
  renderSnapshot: ResultRenderSnapshot;
  treeLayoutNodes: readonly RenderTreeNode[];
  visibleRows: readonly RenderRow[];
  columns: DisplayColumn[];
  moduleQuery: ModuleQueryInfo | null;
  angular: CircularSceneGeometry["angular"];
  radiusByNodeId: ReadonlyMap<number, number>;
  visibleBranches: readonly CircularFigureBranch[];
  visibleLabels: readonly CircularFigureLabel[];
  stripLabelRingInnerRadius: number;
  stripLabelRingOuterRadius: number;
  stripLabelRadius: number;
  speciesInnerRadius: number;
  speciesOuterRadius: number;
  rootForkRadius: number;
  columnLabelAngle: number;
  columnLabelRotation: number;
  moduleBraceAngle: number;
  maxColumnLabelWidth: number;
  activeStripRank: string;
  showStrip: boolean;
  showStripLabels: boolean;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  showSpeciesLayer: boolean;
  showSpeciesCount: boolean;
  showBranchLabels: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  showInternalNodes: boolean;
  showHeatmapNumbers: boolean;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  branchScale: number;
  branchStrokeWidth: number;
  branchLabelFontSize: number;
  branchMetricFontSize: number;
  columnLabelFontSize: number;
  moduleLabelFontSize: number;
  speciesCountFontSize: number;
  stripNameFontSize: number;
  heatmapValueFontSize: number;
  heatmapMarkerSize: number;
  heatmapCellHalfStep: number;
  heatmapSectorHalfStep: number;
  treeStyles: ResolvedTreeStyleProjection;
}

export type FigureSceneGeometry = RectangularFigureGeometry | CircularFigureGeometry;
export type FigureScenePlan = ScenePlan<FigureSceneGeometry>;

export interface LegendFigureData {
  heatmap: { state: HeatmapLegendState; title: string; items: Array<{ label: string; color: string; marker: PartitionShape }>; itemFontSize: number } | null;
  taxon: { state: HeatmapLegendState; title: string; items: Array<{ label: string; color: string; marker: "swatch" }>; itemFontSize: number } | null;
}

export interface ExportRequest {
  format: "svg" | "png" | "pdf";
  width?: number;
  height?: number;
  dpi?: number;
  includeLegend?: boolean;
}

export interface ExportCamera {
  readonly documentScale: number;
  readonly offset: { readonly x: number; readonly y: number };
}

export interface ExportFrame {
  readonly scene: FigureScenePlan;
  readonly bounds: SceneBounds;
  readonly camera: ExportCamera;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly legend: LegendFigureData | null;
}

export interface FigureEncoder {
  png(svg: string, width: number, height: number): Promise<Blob>;
  pdf(svg: string, width: number, height: number): Promise<Blob>;
}

export function compileExportFrame(scene: FigureScenePlan, request: ExportRequest, legend: LegendFigureData | null): ExportFrame {
  const bounds = scene.bounds.export;
  const width = Math.max(1, Math.ceil(request.width ?? bounds.right - bounds.left));
  const height = Math.max(1, Math.ceil(request.height ?? bounds.bottom - bounds.top));
  const documentScale = Math.min(width / Math.max(1, bounds.right - bounds.left), height / Math.max(1, bounds.bottom - bounds.top));
  const camera = Object.freeze({
    documentScale,
    offset: Object.freeze({
      x: (width - (bounds.right - bounds.left) * documentScale) / 2 - bounds.left * documentScale,
      y: (height - (bounds.bottom - bounds.top) * documentScale) / 2 - bounds.top * documentScale,
    }),
  });
  return Object.freeze({ scene, bounds: Object.freeze({ ...bounds }), camera, targetWidth: width, targetHeight: height, legend: request.includeLegend === false ? null : legend });
}

function num(value: number, digits = 3) { return Number(value.toFixed(digits)).toString(); }

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const from = polarPoint(cx, cy, radius, start);
  const to = polarPoint(cx, cy, radius, end);
  const delta = Math.abs(end - start);
  const sweep = end >= start ? 1 : 0;
  return `M ${num(from.x)} ${num(from.y)} A ${num(radius)} ${num(radius)} 0 ${delta > Math.PI ? 1 : 0} ${sweep} ${num(to.x)} ${num(to.y)}`;
}

function annularSectorPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  const outerStart = polarPoint(cx, cy, outer, start);
  const outerEnd = polarPoint(cx, cy, outer, end);
  const innerEnd = polarPoint(cx, cy, inner, end);
  const innerStart = polarPoint(cx, cy, inner, start);
  const large = Math.abs(end - start) > Math.PI ? 1 : 0;
  const sweep = end >= start ? 1 : 0;
  return [`M ${num(outerStart.x)} ${num(outerStart.y)}`, `A ${num(outer)} ${num(outer)} 0 ${large} ${sweep} ${num(outerEnd.x)} ${num(outerEnd.y)}`, `L ${num(innerEnd.x)} ${num(innerEnd.y)}`, `A ${num(inner)} ${num(inner)} 0 ${large} ${1 - sweep} ${num(innerStart.x)} ${num(innerStart.y)}`, "Z"].join(" ");
}

function branchPath(geometry: CircularFigureGeometry, branch: CircularFigureBranch) {
  const { cx, cy } = geometry;
  const radialEnd = polarPoint(cx, cy, branch.childRadius, branch.childAngle);
  if (branch.parentRadius <= 0.1) {
    const forkRadius = Math.min(geometry.rootForkRadius, Math.max(0, branch.childRadius - 1));
    if (forkRadius <= 0.1) return `M ${num(cx)} ${num(cy)} L ${num(radialEnd.x)} ${num(radialEnd.y)}`;
    return [`M ${num(cx)} ${num(cy)}`, arcPath(cx, cy, forkRadius, branch.parentAngle, branch.childAngle), `L ${num(radialEnd.x)} ${num(radialEnd.y)}`].join(" ");
  }
  return [arcPath(cx, cy, branch.parentRadius, branch.parentAngle, branch.childAngle), `L ${num(radialEnd.x)} ${num(radialEnd.y)}`].join(" ");
}

function legendMarkup(frame: ExportFrame) {
  if (!frame.legend) return "";
  const viewport = { width: frame.bounds.right - frame.bounds.left, height: frame.bounds.bottom - frame.bounds.top };
  const camera = { zoom: 1, offset: { x: 0, y: 0 } };
  const parts: string[] = [];
  const append = (data: LegendFigureData["heatmap"] | LegendFigureData["taxon"], id: string) => {
    if (!data || !data.state.open) return;
    const layout = floatingLegendExportLayout(data.state, viewport, "world", { targetCamera: camera });
    parts.push(floatingLegendSvgMarkup({ id, state: layout.state, title: data.title, items: data.items, viewport, fontFamily: TREE_FONT_FAMILY, itemFontSize: data.itemFontSize, presentationScale: layout.presentationScale, x: layout.x, y: layout.y }));
  };
  append(frame.legend.heatmap, "heatmap");
  append(frame.legend.taxon, "taxon");
  return parts.join("");
}

function rectangularSvg(geometry: RectangularFigureGeometry, frame: ExportFrame) {
  const { renderSnapshot, treeLayoutNodes, visibleRows, visibleStripGroups, layout, columns, moduleQuery } = geometry;
  const width = Math.ceil(frame.bounds.right - frame.bounds.left);
  const height = Math.ceil(frame.bounds.bottom - frame.bounds.top);
  const treeOffsetX = -frame.bounds.left;
  const treeOffsetY = geometry.headerHeight - frame.bounds.top;
  const heatOffsetX = layout.treeWidth + 24 - frame.bounds.left;
  const heatOffsetY = -frame.bounds.top;
  const moduleHeaderLayout = rectangularModuleHeaderLayout(geometry.moduleLabelFontSize);
  const rootLayoutNode = treeLayoutNodes.find((node) => node.parent === null) ?? treeLayoutNodes[0];
  const rootRenderX = rootLayoutNode?.x ?? 0;
  const scaledTreeX = (x: number) => rootRenderX + (x - rootRenderX) * geometry.branchScale;
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${frame.targetWidth}" height="${frame.targetHeight}" viewBox="0 0 ${width} ${height}">`, `<rect width="100%" height="100%" fill="#fff"/>`, `<g font-family="${escapeXml(TREE_FONT_FAMILY)}">`];
  renderSnapshot.treeStyles.backgroundRuns.forEach(({ style, startIndex, endIndex }) => {
    const band = rectangularTreeStyleRowBand(renderSnapshot.rows, startIndex, endIndex, geometry.rowHeight);
    if (!band) return;
    const rootX = treeOffsetX + scaledTreeX(rootRenderX);
    parts.push(`<rect x="${num(rootX)}" y="${num(treeOffsetY + band.top)}" width="${num(treeOffsetX + layout.treeWidth - rootX)}" height="${num(band.height)}" fill="${taxonStyleColorCss(style.color, "background")}"/>`);
  });
  if (rootLayoutNode) {
    const rootX = treeOffsetX + scaledTreeX(rootLayoutNode.x);
    parts.push(`<line x1="${num(rootX - 18)}" y1="${num(treeOffsetY + rootLayoutNode.y)}" x2="${num(rootX)}" y2="${num(treeOffsetY + rootLayoutNode.y)}" stroke="#000" stroke-width="${geometry.branchStrokeWidth}"/>`);
  }
  treeLayoutNodes.forEach((node) => {
    if (node.parent === null) return;
    const parent = treeLayoutNodes[node.parent];
    if (!parent) return;
    const branchStyle = renderSnapshot.treeStyles.branchByNodeId.get(node.nodeId);
    parts.push(`<path d="M ${num(treeOffsetX + scaledTreeX(parent.x))} ${num(treeOffsetY + parent.y)} L ${num(treeOffsetX + scaledTreeX(parent.x))} ${num(treeOffsetY + node.y)} L ${num(treeOffsetX + scaledTreeX(node.x))} ${num(treeOffsetY + node.y)}" fill="none" stroke="${escapeXml(branchStyle?.color ?? "#000")}" stroke-width="${geometry.branchStrokeWidth}"/>`);
  });
  if (geometry.showBranchLengths) treeLayoutNodes.forEach((node) => {
    if (node.parent === null || node.branchLength <= 0) return;
    const parent = treeLayoutNodes[node.parent];
    if (!parent) return;
    const startX = treeOffsetX + scaledTreeX(parent.x);
    const endX = treeOffsetX + scaledTreeX(node.x);
    const text = formatBranchLength(node.branchLength, Math.abs(endX - startX) < 52 ? 4 : 6);
    parts.push(`<text x="${num((startX + endX) / 2)}" y="${num(treeOffsetY + node.y - geometry.rowHeight * 0.36)}" ${svgTextAttributes("branchLength", geometry.branchMetricFontSize)} text-anchor="middle" dominant-baseline="middle" fill="#000" stroke="#fff" stroke-width="2.4" paint-order="stroke">${escapeXml(text)}</text>`);
  });
  treeLayoutNodes.forEach((node) => {
    const x = treeOffsetX + scaledTreeX(node.x);
    const y = treeOffsetY + node.y;
    if (node.kind === "internal") {
      if (geometry.showInternalNodes) parts.push(`<rect x="${num(x - 3.4)}" y="${num(y - 3.4)}" width="6.8" height="6.8" transform="rotate(45 ${num(x)} ${num(y)})" fill="#000" stroke="#fff" stroke-width="1.4"/>`);
      return;
    }
    if (geometry.showBranchGuides) parts.push(`<line x1="${num(x)}" y1="${num(y)}" x2="${num(treeOffsetX + layout.labelX - 8)}" y2="${num(y)}" stroke="#808080" stroke-width="${branchGuideStrokeWidth(geometry.branchStrokeWidth)}" stroke-dasharray="${branchGuideDashArray(geometry.branchStrokeWidth)}"/>`);
    if (geometry.showBranchLabels) {
      const text = node.label.length > 54 ? `${node.label.slice(0, 53)}...` : node.label;
      const labelStyle = renderSnapshot.treeStyles.labelByNodeId.get(node.nodeId);
      parts.push(`<text x="${num(treeOffsetX + layout.labelX)}" y="${num(y)}" ${svgTextAttributes("branchLabel", geometry.branchLabelFontSize)} dominant-baseline="middle" fill="${escapeXml(labelStyle?.color ?? "#000")}" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(text)}</text>`);
    }
    if (geometry.showSpeciesCount) parts.push(`<text x="${num(treeOffsetX + layout.speciesCountX + 16)}" y="${num(y + 1)}" ${svgTextAttributes("speciesCount", geometry.speciesCountFontSize)} text-anchor="middle" dominant-baseline="middle" fill="#000">${node.aliveLeafCount}</text>`);
  });
  renderSnapshot.treeStyles.stripRuns.forEach(({ style, startIndex, endIndex }) => {
    const band = rectangularTreeStyleRowBand(renderSnapshot.rows, startIndex, endIndex, geometry.rowHeight);
    if (!band) return;
    parts.push(`<rect x="${num(treeOffsetX + layout.stripX)}" y="${num(treeOffsetY + band.top)}" width="${num(layout.stripWidth)}" height="${num(band.height)}" fill="${taxonStyleColorCss(style.color, "strip")}"/>`);
  });
  if (geometry.activeStripRank !== "none") visibleStripGroups.forEach((group) => {
    const band = rectangularTreeStyleRowBand(visibleRows, group.startIndex, group.endIndex, geometry.rowHeight);
    if (!band || geometry.taxonNameDisplayMode !== "embedded" || !geometry.showStripLabels) return;
    const labelX = treeOffsetX + layout.stripX + (geometry.taxonDisplayStyle === "strip" ? layout.stripWidth : 0) + 6;
    parts.push(`<text x="${num(labelX)}" y="${num(treeOffsetY + band.top + band.height / 2)}" ${svgTextAttributes("taxonLabel", geometry.stripNameFontSize)} dominant-baseline="middle" fill="#000">${escapeXml(group.label)}</text>`);
  });
  const moduleRanges = moduleColumnRanges(moduleQuery, [...columns]);
  if (moduleQuery && geometry.showModuleNames) moduleRanges.forEach((module) => {
    const x = heatOffsetX + 20 + module.start * geometry.heatmapColumnWidth;
    const bandWidth = (module.end - module.start + 1) * geometry.heatmapColumnWidth;
    const label = moduleBraceLabel(module.moduleId, module.moduleName, geometry.showModuleNames, geometry.showModuleFullName);
    parts.push(`<text x="${num(x + bandWidth / 2)}" y="${num(heatOffsetY + moduleHeaderLayout.labelBaseline)}" ${svgTextAttributes("moduleLabel", geometry.moduleLabelFontSize)} text-anchor="middle" fill="#000">${escapeXml(label)}</text>`);
    parts.push(`<path d="M ${num(x)} ${num(heatOffsetY + moduleHeaderLayout.braceTop)} H ${num(x + bandWidth)} V ${num(heatOffsetY + moduleHeaderLayout.braceBottom)}" fill="none" stroke="#000" stroke-width="1.35"/>`);
  });
  columns.forEach((column) => {
    if (!column.displayLabel) return;
    const x = heatOffsetX + 20 + column.slotIndex * geometry.heatmapColumnWidth + geometry.heatmapColumnWidth / 2;
    parts.push(`<g transform="translate(${num(x)}, ${num(heatOffsetY + geometry.headerHeight - 12)}) rotate(${RECT_COLUMN_LABEL_ROTATION})"><text x="5" y="-4" ${svgTextAttributes("columnLabel", geometry.columnLabelFontSize)} fill="#000" stroke="#fff" stroke-width="2.5" paint-order="stroke">${escapeXml(column.displayLabel)}</text></g>`);
  });
  renderSnapshot.cells.forEach((cell) => {
    const x = heatOffsetX + 20 + cell.column.slotIndex * geometry.heatmapColumnWidth;
    const y = heatOffsetY + geometry.headerHeight + cell.row.y;
    parts.push(exportShapeMarkup(cell.shape, x, y, geometry.heatmapColumnWidth, geometry.rowHeight, cell.fill, geometry.heatmapShapeSize));
    if (geometry.showNumbers) {
      const textColor = luminanceText(cell.fill);
      const stroke = textColor === "#FFFFFF" ? "rgba(17,17,17,0.58)" : "rgba(255,255,255,0.68)";
      parts.push(`<text x="${num(x + geometry.heatmapColumnWidth / 2)}" y="${num(y + geometry.rowHeight / 2 + 4)}" ${svgTextAttributes("heatmapValue", geometry.heatmapValueFontSize)} text-anchor="middle" fill="${textColor}" stroke="${stroke}" stroke-width="2" paint-order="stroke">${escapeXml(cell.label)}</text>`);
    }
  });
  parts.push(...heatmapBorderMarkup(renderSnapshot.rectangularHeatmapBorderEdgesByBoundary, {
    x: (slot) => heatOffsetX + 20 + slot * geometry.heatmapColumnWidth,
    y: (row) => heatOffsetY + geometry.headerHeight + (visibleRows[row]?.y ?? ((visibleRows.at(-1)?.y ?? 0) + geometry.rowHeight)),
    width: geometry.heatmapColumnWidth,
    rowHeight: geometry.rowHeight,
  }));
  parts.push(legendMarkup(frame), "</g></svg>");
  return parts.join("");
}

function luminanceText(fill: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!match) return "#000000";
  const value = Number.parseInt(match[1], 16);
  const red = value >> 16;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? "#111111" : "#FFFFFF";
}

function heatmapBorderMarkup(boundaries: HeatmapBorderEdgesByBoundary, geometry: { x: (slot: number) => number; y: (row: number) => number; width: number; rowHeight: number }) {
  const parts: string[] = [];
  (["interior", "perimeter"] as const).forEach((boundary) => {
    const path = boundaries[boundary].map((edge: HeatmapBorderEdge) => {
      if (edge.axis === "row") {
        const y = geometry.y(edge.rowBoundary);
        const x = geometry.x(edge.slotIndex);
        return `M ${num(x)} ${num(y)} H ${num(x + geometry.width)}`;
      }
      const x = geometry.x(edge.slotBoundary);
      const y = geometry.y(edge.rowIndex);
      return `M ${num(x)} ${num(y)} V ${num(y + geometry.rowHeight)}`;
    }).filter(Boolean).join(" ");
    if (path) parts.push(`<path d="${path}" fill="none" stroke="${HEATMAP_BORDER_COLOR}" stroke-width="${boundary === "perimeter" ? HEATMAP_PERIMETER_BORDER_WIDTH : HEATMAP_INTERIOR_BORDER_WIDTH}"/>`);
  });
  return parts;
}

function circularText(x: number, y: number, value: string, role: Parameters<typeof svgTextAttributes>[0], size: number, rotation: number, anchor: "start" | "middle" | "end", fill = "#000") {
  return `<text transform="translate(${num(x)} ${num(y)}) rotate(${num(rotation * 180 / Math.PI)})" ${svgTextAttributes(role, size)} text-anchor="${anchor}" dominant-baseline="middle" fill="${escapeXml(fill)}" stroke="rgba(255,255,255,0.92)" stroke-width="2.4" paint-order="stroke">${escapeXml(value)}</text>`;
}

function circularSvg(geometry: CircularFigureGeometry, frame: ExportFrame) {
  const width = Math.ceil(frame.bounds.right - frame.bounds.left);
  const height = Math.ceil(frame.bounds.bottom - frame.bounds.top);
  const offsetX = -frame.bounds.left;
  const offsetY = -frame.bounds.top;
  const { cx, cy, renderSnapshot, angleByTreeNodeId, ringLayouts, stripGroups, startAngle, leafStep, treeOuterRadius, labelRadius, stripInnerRadius, stripOuterRadius } = geometry;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${frame.targetWidth}" height="${frame.targetHeight}" viewBox="0 0 ${width} ${height}">`, `<rect width="100%" height="100%" fill="#fff"/>`, `<g font-family="${escapeXml(TREE_FONT_FAMILY)}" transform="translate(${num(offsetX)} ${num(offsetY)})">`];
  renderSnapshot.treeStyles.backgroundRuns.forEach(({ style, startIndex, endIndex }) => {
    const taxonomyBackground = resolveCircularTaxonomyBackgroundRange(geometry.radialLayout);
    const startNode = geometry.treeLayoutNodes.find((node) => node.id === style.nodeId);
    const startX = startNode?.x ?? style.anchorX;
    const inner = style.source === "taxon" ? taxonomyBackground.innerRadius : Math.max(1, Math.max(0, startX - geometry.rootX) * geometry.branchScale);
    const outer = style.source === "taxon" ? taxonomyBackground.outerRadius : labelRadius;
    if (outer <= inner) return;
    parts.push(`<path d="${annularSectorPath(cx, cy, inner, outer, startAngle + startIndex * leafStep, startAngle + (endIndex + 1) * leafStep)}" fill="${taxonStyleColorCss(style.color, "background")}"/>`);
  });
  geometry.visibleBranches.forEach((branch) => {
    const style = geometry.treeStyles.branchByNodeId.get(branch.node.nodeId);
    parts.push(`<path d="${branchPath(geometry, branch)}" fill="none" stroke="${escapeXml(style?.color ?? "#000")}" stroke-width="${geometry.branchStrokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
  });
  if (geometry.showBranchLengths) geometry.visibleBranches.forEach((branch) => {
    if (branch.node.branchLength <= 0) return;
    const radius = branch.parentRadius + (branch.childRadius - branch.parentRadius) * 0.58;
    const point = polarPoint(geometry.cx, geometry.cy, radius, branch.childAngle);
    const degrees = branch.childAngle * 180 / Math.PI;
    const flip = degrees > 90 || degrees < -90;
    parts.push(circularText(point.x, point.y, formatBranchLength(branch.node.branchLength, 6), "branchLength", geometry.branchMetricFontSize, flip ? branch.childAngle + Math.PI : branch.childAngle, flip ? "end" : "start"));
  });
  if (geometry.showBranchLabels) geometry.visibleLabels.forEach((label) => {
    if (geometry.showBranchGuides) {
      const guideStartRadius = geometry.radiusByNodeId.get(label.node.id) ?? treeOuterRadius;
      const start = polarPoint(geometry.cx, geometry.cy, guideStartRadius, label.angle);
      const end = polarPoint(geometry.cx, geometry.cy, Math.max(guideStartRadius, labelRadius - 8), label.angle);
      parts.push(`<line x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(end.x)}" y2="${num(end.y)}" stroke="#808080" stroke-width="${branchGuideStrokeWidth(geometry.branchStrokeWidth)}" stroke-dasharray="${branchGuideDashArray(geometry.branchStrokeWidth)}"/>`);
    }
    const degrees = label.angle * 180 / Math.PI;
    const flip = degrees > 90 || degrees < -90;
    const style = geometry.treeStyles.labelByNodeId.get(label.node.nodeId);
    parts.push(circularText(label.point.x, label.point.y, label.row.label, "branchLabel", geometry.branchLabelFontSize, flip ? label.angle + Math.PI : label.angle, flip ? "end" : "start", style?.color ?? "#000"));
  });
  if (geometry.showSpeciesLayer && geometry.showSpeciesCount) geometry.visibleRows.forEach((row) => {
    const angle = angleByTreeNodeId.get(row.nodeId);
    if (angle === undefined) return;
    const point = polarPoint(geometry.cx, geometry.cy, (geometry.speciesInnerRadius + geometry.speciesOuterRadius) / 2, angle);
    parts.push(circularText(point.x, point.y, String(row.leafCount), "speciesCount", geometry.speciesCountFontSize, 0, "middle"));
  });
  renderSnapshot.treeStyles.stripRuns.forEach(({ style, startIndex, endIndex }) => {
    const start = startAngle + startIndex * leafStep;
    const end = startAngle + (endIndex + 1) * leafStep - 0.002;
    parts.push(`<path d="${annularSectorPath(cx, cy, stripInnerRadius, stripOuterRadius, start, end)}" fill="${taxonStyleColorCss(style.color, "strip")}" stroke="rgba(255,255,255,0.76)" stroke-width="0.55"/>`);
  });
  if (geometry.showStrip && geometry.showStripLabels && geometry.taxonNameDisplayMode === "embedded" && geometry.activeStripRank !== "none") stripGroups.forEach((group) => {
    const midAngle = startAngle + (group.startIndex + group.endIndex + 1) * leafStep / 2;
    const point = polarPoint(cx, cy, geometry.stripLabelRadius, midAngle);
    parts.push(circularText(point.x, point.y, group.label, "taxonLabel", geometry.stripNameFontSize, 0, "middle"));
  });
  if (geometry.showInternalNodes) geometry.visibleBranches.forEach(({ node }) => {
    if (node.kind !== "internal") return;
    const angle = geometry.angleByLayoutNodeId.get(node.id);
    const radius = geometry.radiusByNodeId.get(node.id);
    if (angle === undefined || radius === undefined) return;
    const point = polarPoint(cx, cy, radius, angle);
    parts.push(`<rect x="${num(point.x - 3.4)}" y="${num(point.y - 3.4)}" width="6.8" height="6.8" transform="rotate(45 ${num(point.x)} ${num(point.y)})" fill="#000" stroke="#fff" stroke-width="1.4"/>`);
  });
  renderSnapshot.cells.forEach((cell) => {
    const angle = angleByTreeNodeId.get(cell.row.nodeId);
    const ring = ringLayouts.find((layout) => layout.column === cell.column || layout.index === cell.column.slotIndex);
    if (angle === undefined || !ring) return;
    const halfStep = cell.shape === "fill" ? geometry.heatmapCellHalfStep : geometry.heatmapSectorHalfStep;
    if (cell.shape === "fill") {
      parts.push(`<path d="${annularSectorPath(cx, cy, ring.inner, ring.outer, angle - halfStep, angle + halfStep)}" fill="${escapeXml(cell.fill)}"/>`);
    } else {
      const point = polarPoint(cx, cy, ring.center, angle);
      const arcLength = Math.max(1, ring.center * halfStep * 2);
      const size = clamp(Math.min(ring.outer - ring.inner, arcLength) * geometry.heatmapMarkerSize, 4, Math.max(ring.outer - ring.inner, arcLength));
      const rotation = cell.shape === "triangle" ? angle + Math.PI / 2 : 0;
      parts.push(`<g transform="translate(${num(point.x)} ${num(point.y)}) rotate(${num(rotation * 180 / Math.PI)})">${exportShapeMarkup(cell.shape, -size / 2, -size / 2, size, size, cell.fill, 1)}</g>`);
    }
    if (geometry.showHeatmapNumbers) {
      const point = polarPoint(cx, cy, ring.center, angle);
      parts.push(circularText(point.x, point.y, cell.label, "heatmapValue", geometry.heatmapValueFontSize, 0, "middle", luminanceText(cell.fill)));
    }
  });
  parts.push(...circularBorderMarkup(geometry));
  ringLayouts.forEach((ring) => {
    if (!ring.column.displayLabel) return;
    const point = polarPoint(cx, cy, ring.outer, geometry.columnLabelAngle);
    parts.push(circularText(point.x, point.y, ring.column.displayLabel, "columnLabel", geometry.columnLabelFontSize, geometry.columnLabelRotation * Math.PI / 180, "start"));
  });
  if (geometry.showModuleNames) moduleColumnRanges(geometry.moduleQuery, [...geometry.columns]).forEach((module) => {
    const rings = ringLayouts.filter((ring) => ring.index >= module.start && ring.index <= module.end);
    if (!rings.length) return;
    const outer = Math.max(...rings.map((ring) => ring.outer));
    const point = polarPoint(cx, cy, outer, geometry.moduleBraceAngle);
    parts.push(circularText(point.x, point.y, moduleBraceLabel(module.moduleId, module.moduleName, geometry.showModuleNames, geometry.showModuleFullName), "moduleLabel", geometry.moduleLabelFontSize, geometry.columnLabelRotation * Math.PI / 180 + Math.PI / 2, "middle"));
  });
  parts.push(legendMarkup(frame), "</g></svg>");
  return parts.join("");
}

function circularBorderMarkup(geometry: CircularFigureGeometry) {
  const ringGap = Math.max(0, geometry.heatmapRingStride - geometry.heatmapRingWidth);
  const radiusAtSlotBoundary = (slot: number) => geometry.heatmapInnerRadius + slot * geometry.heatmapRingStride - (slot > 0 ? ringGap / 2 : 0);
  const angleAtRowBoundary = (rowBoundary: number) => {
    const row = geometry.renderSnapshot.rows[rowBoundary] ?? geometry.renderSnapshot.rows[0];
    const angle = row ? geometry.angleByTreeNodeId.get(row.nodeId) : undefined;
    return angle === undefined ? 0 : angle - geometry.heatmapCellHalfStep;
  };
  const parts: string[] = [];
  (["interior", "perimeter"] as const).forEach((boundary) => {
    const path = geometry.renderSnapshot.circularHeatmapBorderEdgesByBoundary[boundary].map((edge) => {
      if (edge.axis === "row") {
        const angle = angleAtRowBoundary(edge.rowBoundary);
        const start = polarPoint(geometry.cx, geometry.cy, radiusAtSlotBoundary(edge.slotIndex), angle);
        const end = polarPoint(geometry.cx, geometry.cy, radiusAtSlotBoundary(edge.slotIndex + 1), angle);
        return `M ${num(start.x)} ${num(start.y)} L ${num(end.x)} ${num(end.y)}`;
      }
      const row = geometry.renderSnapshot.rows[edge.rowIndex];
      const angle = row ? geometry.angleByTreeNodeId.get(row.nodeId) : undefined;
      if (angle === undefined) return "";
      return arcPath(geometry.cx, geometry.cy, radiusAtSlotBoundary(edge.slotBoundary), angle - geometry.heatmapCellHalfStep, angle + geometry.heatmapCellHalfStep);
    }).filter(Boolean).join(" ");
    if (path) parts.push(`<path d="${path}" fill="none" stroke="${HEATMAP_BORDER_COLOR}" stroke-width="${boundary === "perimeter" ? HEATMAP_PERIMETER_BORDER_WIDTH : HEATMAP_INTERIOR_BORDER_WIDTH}"/>`);
  });
  return parts;
}

export function renderExportSvg(frame: ExportFrame): string {
  return frame.scene.mode === "rectangular" ? rectangularSvg(frame.scene.geometry as RectangularFigureGeometry, frame) : circularSvg(frame.scene.geometry as CircularFigureGeometry, frame);
}

export async function exportScene(frame: ExportFrame, request: ExportRequest, encoder: FigureEncoder): Promise<Blob> {
  const svg = renderExportSvg(frame);
  if (request.format === "svg") return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  if (request.format === "png") return encoder.png(svg, frame.targetWidth, frame.targetHeight);
  return encoder.pdf(svg, frame.targetWidth, frame.targetHeight);
}
