import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ModuleQueryInfo, SearchColumn } from "../../types";
import { RECT_COLUMN_LABEL_ROTATION } from "./resultVisualConstants";
import { branchGuideDashArray, branchGuideStrokeWidth, canvasFont, circularLabelWidth, clamp, columnLabelWidth, formatBranchLength, heatmapSlotSpan, isHeatmapDisplayColumn, moduleBraceLabel, moduleBracePath, moduleColumnRanges, normalizeColumnKey, rectangularColumnLabelProjection, rectangularModuleHeaderLayout, rectangularTreeStyleRowBand, rowCellKey } from "./resultVisualUtils";
import type { ColumnDragDraft, DisplayColumn, HeatmapStyleRecord, PartitionShape, TreeLayoutNode, TerminalBand } from "./resultTypes";
import type { ResolvedTreeStyleProjection } from "./render-compiler/treeStyleProjection";
import type { CircularSceneGeometry } from "./canvasPresentation";
import { createScenePlan } from "./rendering/scenePlan";
import type { FigureSceneGeometry, FigureScenePlan, RectangularTreeLayout } from "./rendering/figureExport";
import { angleFallsOnArc, buildTreeRenderPlan, circularBranchBounds, distanceToSegment, hitCircularCell, normalizeAngleFrom, polarPoint, progressAlongSegment, rectangularBackgroundRange, rectangularNodeX, rectangularRootStem, resolveBranchHitOwner, resolveCanvasBackingSize, resolveCircularHoverInnerRadius, resolveCircularHoverOuterRadius, resolveCounterProjectedCanvas, resolveTreeHighlightScope, shouldCaptureCircularPointer, type ScenePoint, type TreeHighlightScope } from "./tree-renderer/canvasScene";
import { resolveCircularTaxonomyBackgroundRange } from "./circularRadialLayout";
import { heatmapValueTextColor } from "./heatmapStyleModel";
import { HEATMAP_BORDER_COLOR, HEATMAP_INTERIOR_BORDER_WIDTH, HEATMAP_PERIMETER_BORDER_WIDTH, type HeatmapBorderEdgesByBoundary } from "./heatmapBorderModel";
import { shouldHandleHeatmapCellClick } from "./heatmapSelectionInteraction";
import { RESULT_FONT_WEIGHTS } from "./resultTypography";
import type { TaxonDisplayStyle, TaxonNameDisplayMode } from "../workbench/workbenchAppearance";
import { resolveHeatmapInteractionCells, type RenderRow, type RenderTreeNode, type ResolvedHeatmapCell, type ResultRenderSnapshot } from "./render-compiler/renderSnapshot";
import { taxonStyleColorCss, visibleTaxonColorGroups } from "./taxonColorSystem";

export function collectVisibleSpatialItems<T extends { point: ScenePoint }>(
  items: readonly T[],
  buckets: ReadonlyMap<string, readonly T[]>,
  bucketSize: number,
  bounds: { left: number; top: number; right: number; bottom: number },
) {
  if (!items.length) return [];
  const minBucketX = Math.floor(bounds.left / bucketSize);
  const maxBucketX = Math.floor(bounds.right / bucketSize);
  const minBucketY = Math.floor(bounds.top / bucketSize);
  const maxBucketY = Math.floor(bounds.bottom / bucketSize);
  const bucketCount = (maxBucketX - minBucketX + 1) * (maxBucketY - minBucketY + 1);
  if (bucketCount >= items.length) {
    return items.filter(({ point }) => (
      point.x >= bounds.left && point.x <= bounds.right
      && point.y >= bounds.top && point.y <= bounds.bottom
    ));
  }
  const visible = new Set<T>();
  for (let x = minBucketX; x <= maxBucketX; x += 1) {
    for (let y = minBucketY; y <= maxBucketY; y += 1) {
      buckets.get(`${x}:${y}`)?.forEach((item) => visible.add(item));
    }
  }
  return Array.from(visible);
}

function drawCanvasAnnularPath(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  start: number,
  end: number,
) {
  context.beginPath();
  context.arc(cx, cy, outer, start, end, end < start);
  context.arc(cx, cy, inner, end, start, start < end);
  context.closePath();
}

function drawOutlinedCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    fontSize: number;
    weight?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    rotation?: number;
  },
) {
  context.save();
  context.translate(x, y);
  if (options.rotation) context.rotate(options.rotation);
  context.font = canvasFont(options.fontSize, options.weight ?? 500);
  context.textAlign = options.align ?? "center";
  context.textBaseline = options.baseline ?? "middle";
  if (options.strokeWidth && options.strokeWidth > 0) {
    context.lineWidth = options.strokeWidth;
    context.lineJoin = "round";
    context.strokeStyle = options.stroke ?? "rgba(255,255,255,0.9)";
    context.strokeText(text, 0, 0);
  }
  context.fillStyle = options.fill ?? "#000";
  context.fillText(text, 0, 0);
  context.restore();
}

function drawCanvasDiamond(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke = "#fff",
  strokeWidth = 1.4,
) {
  context.save();
  context.translate(x, y);
  context.rotate(Math.PI / 4);
  context.fillStyle = fill;
  context.fillRect(-size / 2, -size / 2, size, size);
  if (strokeWidth > 0) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.strokeRect(-size / 2, -size / 2, size, size);
  }
  context.restore();
}

type CircularTreeHitTarget =
  | { kind: "node"; nodeId: number; treeNode: TreeLayoutNode }
  | { kind: "branch"; nodeId: number; treeNode: TreeLayoutNode }
  | { kind: "label"; nodeId: number; treeNode: TreeLayoutNode }
  | { kind: "species"; nodeId: number; row: RenderRow }
  | { kind: "strip"; nodeId: number; label: string }
  | { kind: "column"; column: DisplayColumn; index: number; key: string }
  | { kind: "cell"; row: RenderRow; column: DisplayColumn; count: number; key: string }
  | null;

type CanvasTooltip = { label: string; x: number; y: number } | null;

export function nodeTooltipLabel(node: RenderTreeNode): string {
  return node.tooltipLabel;
}

function namedNodeTooltip(node: RenderTreeNode | undefined, x: number, y: number): CanvasTooltip {
  const label = node ? nodeTooltipLabel(node) : "";
  return label ? { label, x, y } : null;
}

export function nearestCircularNode<T>(
  candidates: readonly { value: T; point: ScenePoint; hitRadius: number }[],
  point: ScenePoint,
): T | null {
  let nearestValue: T | null = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y);
    if (distance <= candidate.hitRadius && distance < nearestDistance) {
      nearestValue = candidate.value;
      nearestDistance = distance;
    }
  }
  return nearestValue;
}

export function circularNodeHitRadius(node: TreeLayoutNode, viewZoom: number, terminalRadius: number): number {
  const safeZoom = Math.max(0.1, viewZoom);
  return node.kind === "internal"
    ? Math.max(10, 16 / safeZoom)
    : Math.max(7, terminalRadius * 0.65);
}


export interface HeatmapSvgProps {
  renderSnapshot: ResultRenderSnapshot;
  columns: DisplayColumn[];
  moduleQuery: ModuleQueryInfo | null;
  activeModuleId: string | null;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  selectedCellKeys: Set<string>;
  hoveredCellKey: string | null;
  hoveredColumnKey: string | null;
  searchColumns: SearchColumn[];
  height: number;
  headerHeight: number;
  rowHeight: number;
  terminalBands: TerminalBand[];
  heatmapColumnWidth: number;
  cellSize: number;
  columnLabelFontSize: number;
  moduleLabelFontSize: number;
  valueFontSize: number;
  showNumbers: boolean;
  columnDragDraft: ColumnDragDraft | null;
  viewZoom: number;
  viewOffset: { x: number; y: number };
  worldLeft: number;
  onColumnMenu: (event: ReactMouseEvent<SVGGraphicsElement>, column: DisplayColumn, index: number) => void;
  onColumnPrimaryAction: (column: DisplayColumn) => void;
  onColumnDrag: (event: ReactMouseEvent<SVGGraphicsElement>, column: DisplayColumn) => void;
  onHeatmapBodyClick: (event: ReactMouseEvent<SVGGraphicsElement>) => void;
  onHeatmapBodyMenu: (event: ReactMouseEvent<SVGGraphicsElement>) => void;
  onHeatmapBodyMove: (event: ReactMouseEvent<SVGGraphicsElement>) => void;
  onHeatmapBodyLeave: () => void;
}

type HeatmapRenderCell = ResolvedHeatmapCell;

interface CircularRingLayout {
  column: DisplayColumn;
  inner: number;
  outer: number;
  center: number;
}

interface RectangularCanvasDrawInput {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  headerHeight: number;
  heatmapColumnWidth: number;
  rowHeight: number;
  cellSize: number;
  valueFontSize: number;
  showNumbers: boolean;
  terminalBands: TerminalBand[];
  heatmapCells: readonly HeatmapRenderCell[];
  heatmapCellsByRowId: ReadonlyMap<string, readonly HeatmapRenderCell[]>;
  heatmapRows: readonly RenderRow[];
  borderEdgesByBoundary: HeatmapBorderEdgesByBoundary;
  viewZoom: number;
  renderRevision: string;
  backingWidth?: number;
  backingHeight?: number;
  projectionScale?: number;
}

interface CanvasTile {
  left: number;
  top: number;
  width: number;
  height: number;
}

function tileKey(tile: CanvasTile) {
  return `${tile.left}:${tile.top}`;
}

function drawCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  cellFill: string,
) {
  const textColor = heatmapValueTextColor(cellFill);
  context.save();
  context.font = canvasFont(fontSize, RESULT_FONT_WEIGHTS.heatmapValue);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 2;
  context.strokeStyle = textColor === "#FFFFFF" ? "rgba(17,17,17,0.58)" : "rgba(255,255,255,0.68)";
  context.fillStyle = textColor;
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
  context.restore();
}

function drawCanvasShape(
  context: CanvasRenderingContext2D,
  shape: PartitionShape,
  x: number,
  y: number,
  width: number,
  height: number,
  markerSize: number,
  fill: string,
  selected: boolean,
) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  context.save();
  context.fillStyle = fill;
  context.strokeStyle = selected ? "#000" : "rgba(31,37,34,0.09)";
  context.lineWidth = selected ? 7 : 1;

  if (shape === "fill") {
    context.fillRect(x, y, width, height);
    if (selected) {
      context.strokeRect(x + 2, y + 2, Math.max(0, width - 4), Math.max(0, height - 4));
      context.strokeStyle = "rgba(255,255,255,0.9)";
      context.lineWidth = 1;
      context.strokeRect(x + 4, y + 4, Math.max(0, width - 8), Math.max(0, height - 8));
    }
    context.restore();
    return;
  }

  context.beginPath();
  if (shape === "circle") {
    context.arc(centerX, centerY, markerSize / 2, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    const triangleHeight = markerSize * Math.sqrt(3) / 2;
    context.moveTo(centerX, centerY - triangleHeight * 2 / 3);
    context.lineTo(centerX + markerSize / 2, centerY + triangleHeight / 3);
    context.lineTo(centerX - markerSize / 2, centerY + triangleHeight / 3);
    context.closePath();
  } else {
    const squareX = x + (width - markerSize) / 2;
    const squareY = y + (height - markerSize) / 2;
    context.rect(squareX, squareY, markerSize, markerSize);
  }
  context.fill();
  context.stroke();
  if (selected) {
    context.strokeStyle = "rgba(255,255,255,0.62)";
    context.lineWidth = 1;
    context.stroke();
  }
  context.restore();
}

function rectangularMarkerSize(width: number, height: number, markerScale: number) {
  const baseSize = Math.min(width, height);
  return clamp(baseSize * markerScale, 4, Math.max(4, baseSize));
}

function visibleRowRange(
  rows: readonly RenderRow[],
  top: number,
  bottom: number,
  rowHeight: number,
) {
  let start = 0;
  let end = rows.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (rows[middle].y + rowHeight <= top) start = middle + 1;
    else end = middle;
  }
  const first = start;
  start = first;
  end = rows.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (rows[middle].y < bottom) start = middle + 1;
    else end = middle;
  }
  return { start: first, end: start };
}

function drawRectangularHeatmapCanvas(input: RectangularCanvasDrawInput) {
  const context = input.canvas.getContext("2d");
  if (!context) return;
  const backing = resolveCanvasBackingSize({ width: input.backingWidth ?? input.width, height: input.backingHeight ?? input.height }, window.devicePixelRatio || 1);
  const pixelRatio = backing.pixelRatio;
  if (input.canvas.width !== backing.width) input.canvas.width = backing.width;
  if (input.canvas.height !== backing.height) input.canvas.height = backing.height;
  input.canvas.style.width = `${input.width}px`;
  input.canvas.style.height = `${input.height}px`;

  const projectionScale = input.projectionScale ?? 1;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, input.backingWidth ?? input.width, input.backingHeight ?? input.height);
  const bandByRowIdMap = new Map(input.terminalBands.map((band) => [band.rowId, band]));
  const tileRight = input.offsetX + input.width;
  const tileBottom = input.offsetY + input.height;
  const rowRange = visibleRowRange(
    input.heatmapRows,
    input.offsetY - input.headerHeight,
    tileBottom - input.headerHeight,
    input.rowHeight,
  );

  context.setTransform(pixelRatio * projectionScale, 0, 0, pixelRatio * projectionScale, 0, 0);
  context.save();
  context.translate(-input.offsetX, -input.offsetY);
  {

  for (let rowIndex = rowRange.start; rowIndex < rowRange.end; rowIndex += 1) {
    const row = input.heatmapRows[rowIndex];
    if (!row) continue;
    const band = bandByRowIdMap.get(row.id);
    const rowCells = input.heatmapCellsByRowId.get(row.id) ?? [];
    rowCells.forEach((cell) => {
      const cellTop = input.headerHeight + (band?.top ?? cell.row.y);
      if (cellTop + input.rowHeight <= input.offsetY || cellTop >= tileBottom) return;
      const x = 20 + cell.column.slotIndex * input.heatmapColumnWidth;
      if (x + input.heatmapColumnWidth <= input.offsetX || x >= tileRight) return;
      const markerSize = rectangularMarkerSize(input.heatmapColumnWidth, input.rowHeight, input.cellSize);
      drawCanvasShape(context, cell.shape, x, cellTop, input.heatmapColumnWidth, input.rowHeight, markerSize, cell.fill, false);
    });
  }

  {
    const rowByIndex = input.heatmapRows;
    (["interior", "perimeter"] as const).forEach((boundary) => {
      context.beginPath();
      input.borderEdgesByBoundary[boundary].forEach((edge) => {
        if (edge.axis === "row") {
          const row = rowByIndex[Math.min(edge.rowBoundary, Math.max(0, rowByIndex.length - 1))];
          const band = row ? bandByRowIdMap.get(row.id) : undefined;
          const boundaryY = edge.rowBoundary >= rowByIndex.length
            ? input.headerHeight + (band?.bottom ?? ((row?.y ?? 0) + input.rowHeight))
            : input.headerHeight + (band?.top ?? row?.y ?? 0);
          const left = 20 + edge.slotIndex * input.heatmapColumnWidth;
          context.moveTo(left, boundaryY);
          context.lineTo(left + input.heatmapColumnWidth, boundaryY);
          return;
        }
        const row = rowByIndex[edge.rowIndex];
        if (!row) return;
        const band = bandByRowIdMap.get(row.id);
        const top = input.headerHeight + (band?.top ?? row.y);
        const x = 20 + edge.slotBoundary * input.heatmapColumnWidth;
        context.moveTo(x, top);
        context.lineTo(x, top + (band?.height ?? input.rowHeight));
      });
      context.strokeStyle = HEATMAP_BORDER_COLOR;
      context.lineWidth = boundary === "perimeter" ? HEATMAP_PERIMETER_BORDER_WIDTH : HEATMAP_INTERIOR_BORDER_WIDTH;
      context.stroke();
    });
  }

  if (input.showNumbers) {
    for (let rowIndex = rowRange.start; rowIndex < rowRange.end; rowIndex += 1) {
      const row = input.heatmapRows[rowIndex];
      if (!row) continue;
      const band = bandByRowIdMap.get(row.id);
      const rowCells = input.heatmapCellsByRowId.get(row.id) ?? [];
      rowCells.forEach((cell) => {
        const cellTop = input.headerHeight + (band?.top ?? cell.row.y);
        if (cellTop + input.rowHeight <= input.offsetY || cellTop >= tileBottom) return;
        const x = 20 + cell.column.slotIndex * input.heatmapColumnWidth;
        if (x + input.heatmapColumnWidth <= input.offsetX || x >= tileRight) return;
        drawCanvasText(context, cell.label, x + input.heatmapColumnWidth / 2, cellTop + input.rowHeight / 2 + 1, input.valueFontSize, cell.fill);
      });
    }
  }

    };

  context.restore();
}

type RectangularCanvasTileInput = Omit<RectangularCanvasDrawInput, "canvas" | "width" | "height" | "offsetX" | "offsetY">;

interface RectangularOverlayInput {
  renderSnapshot: ResultRenderSnapshot;
  selectedCellKeys: ReadonlySet<string>;
  columnDragDraft: ColumnDragDraft | null;
}

function drawRectangularHeatmapOverlay(
  canvas: HTMLCanvasElement,
  tile: CanvasTile,
  input: RectangularCanvasTileInput,
  interaction: RectangularOverlayInput,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const backing = resolveCanvasBackingSize({ width: input.backingWidth ?? tile.width, height: input.backingHeight ?? tile.height }, window.devicePixelRatio || 1);
  if (canvas.width !== backing.width) canvas.width = backing.width;
  if (canvas.height !== backing.height) canvas.height = backing.height;
  canvas.style.width = `${tile.width}px`;
  canvas.style.height = `${tile.height}px`;
  context.setTransform(backing.pixelRatio, 0, 0, backing.pixelRatio, 0, 0);
  context.clearRect(0, 0, input.backingWidth ?? tile.width, input.backingHeight ?? tile.height);
  const projectionScale = input.projectionScale ?? 1;
  context.setTransform(backing.pixelRatio * projectionScale, 0, 0, backing.pixelRatio * projectionScale, 0, 0);
  context.save();
  context.translate(-tile.left, -tile.top);
  {
  const bandByRowId = new Map(input.terminalBands.map((band) => [band.rowId, band]));
  const interactionCells = resolveHeatmapInteractionCells(
    interaction.renderSnapshot,
    interaction.selectedCellKeys,
    interaction.columnDragDraft?.value ?? null,
  );
  const cells = new Map<string, { cell: ResolvedHeatmapCell; dragOffset: number }>();
  interactionCells.selected.forEach((cell) => cells.set(cell.key, { cell, dragOffset: 0 }));
  const dragOffset = interaction.columnDragDraft
    ? (interaction.columnDragDraft.currentX - interaction.columnDragDraft.startX) / input.viewZoom
    : 0;
  interactionCells.draggedColumn.forEach((cell) => cells.set(cell.key, { cell, dragOffset }));
  if (interaction.columnDragDraft && dragOffset !== 0) {
    context.fillStyle = "#fff";
    interactionCells.draggedColumn.forEach((cell) => {
      const band = bandByRowId.get(cell.row.id);
      const y = input.headerHeight + (band?.top ?? cell.row.y);
      const x = 20 + cell.column.slotIndex * input.heatmapColumnWidth;
      context.fillRect(x, y, input.heatmapColumnWidth, input.rowHeight);
    });
  }
  cells.forEach(({ cell, dragOffset: cellDragOffset }) => {
    const band = bandByRowId.get(cell.row.id);
    const y = input.headerHeight + (band?.top ?? cell.row.y);
    const x = 20 + cell.column.slotIndex * input.heatmapColumnWidth + cellDragOffset;
    const markerSize = rectangularMarkerSize(input.heatmapColumnWidth, input.rowHeight, input.cellSize);
    drawCanvasShape(context, cell.shape, x, y, input.heatmapColumnWidth, input.rowHeight, markerSize, cell.fill, interaction.selectedCellKeys.has(cell.key));
    if (input.showNumbers && cellDragOffset !== 0) {
      drawCanvasText(context, cell.label, x + input.heatmapColumnWidth / 2, y + input.rowHeight / 2 + 1, input.valueFontSize, cell.fill);
    }
  });
    };
  context.restore();
}

function RectangularHeatmapCanvasTile(props: { tile: CanvasTile; input: RectangularCanvasTileInput; interaction: RectangularOverlayInput }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawRectangularHeatmapCanvas({ ...props.input, canvas, width: props.tile.width, height: props.tile.height, offsetX: props.tile.left, offsetY: props.tile.top });
  }, [
    props.input.backingHeight,
    props.input.backingWidth,
    props.input.cellSize,
    props.input.headerHeight,
    props.input.heatmapColumnWidth,
    props.input.projectionScale,
    props.input.renderRevision,
    props.input.rowHeight,
    props.input.showNumbers,
    props.input.terminalBands,
    props.input.valueFontSize,
    props.input.viewZoom,
    props.tile,
  ]);
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    drawRectangularHeatmapOverlay(canvas, props.tile, props.input, props.interaction);
  }, [
    props.input.backingHeight,
    props.input.backingWidth,
    props.input.cellSize,
    props.input.headerHeight,
    props.input.heatmapColumnWidth,
    props.input.projectionScale,
    props.input.rowHeight,
    props.input.showNumbers,
    props.input.terminalBands,
    props.input.valueFontSize,
    props.input.viewZoom,
    props.interaction.columnDragDraft,
    props.interaction.renderSnapshot,
    props.interaction.selectedCellKeys,
    props.tile,
  ]);
  const style = { left: props.tile.left, top: props.tile.top, width: props.tile.width, height: props.tile.height };
  return <>
    <canvas ref={canvasRef} className="heatmap-canvas" style={style} aria-hidden="true" />
    <canvas ref={overlayRef} className="heatmap-interaction-canvas" style={style} aria-hidden="true" />
  </>;
}

interface CircularCanvasDrawInput {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  viewZoom: number;
  viewOffsetX: number;
  viewOffsetY: number;
  cx: number;
  cy: number;
  angles: Map<number, number>;
  ringLayouts: Map<string, CircularRingLayout>;
  heatmapCells: readonly HeatmapRenderCell[];
  heatmapRows: readonly RenderRow[];
  borderEdgesByBoundary: HeatmapBorderEdgesByBoundary;
  heatmapSectorHalfStep: number;
  heatmapCellHalfStep: number;
  heatmapInnerRadius: number;
  heatmapRingStride: number;
  heatmapRingWidth: number;
  markerScale: number;
  showNumbers: boolean;
  valueFontSize: number;
  renderKey: string;
}

function drawCanvasAnnularSector(context: CanvasRenderingContext2D, cx: number, cy: number, inner: number, outer: number, start: number, end: number, fill: string) {
  context.beginPath();
  context.arc(cx, cy, outer, start, end);
  context.arc(cx, cy, inner, end, start, true);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
}

export function strokeCanvasAnnularSector(context: CanvasRenderingContext2D, cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  context.beginPath();
  context.arc(cx, cy, outer, start, end);
  context.arc(cx, cy, inner, end, start, true);
  context.closePath();
  context.strokeStyle = "#000";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = "rgba(255,255,255,0.9)";
  context.lineWidth = 1;
  context.stroke();
}

function drawCircularHeatmapCanvas(input: CircularCanvasDrawInput) {
  const context = input.canvas.getContext("2d");
  if (!context) return;
  const backing = resolveCanvasBackingSize({ width: input.width, height: input.height }, window.devicePixelRatio || 1);
  const pixelRatio = backing.pixelRatio;
  if (input.canvas.width !== backing.width) input.canvas.width = backing.width;
  if (input.canvas.height !== backing.height) input.canvas.height = backing.height;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, input.width, input.height);
  context.setTransform(
    pixelRatio * input.viewZoom,
    0,
    0,
    pixelRatio * input.viewZoom,
    pixelRatio * input.viewOffsetX,
    pixelRatio * input.viewOffsetY,
  );
  {
  input.heatmapCells.forEach((cell) => {
    const angle = input.angles.get(cell.row.nodeId);
    const layout = input.ringLayouts.get(cell.columnKey);
    if (angle === undefined || !layout) return;
    const inner = layout.inner;
    const outer = layout.outer;
    const center = (inner + outer) / 2;
    const shape = cell.shape;
    const angularHalfStep = shape === "fill" ? input.heatmapCellHalfStep : input.heatmapSectorHalfStep;
    const start = angle - angularHalfStep;
    const end = angle + angularHalfStep;
    const centerPoint = polarPoint(input.cx, input.cy, center, angle);
    const screenX = centerPoint.x * input.viewZoom + input.viewOffsetX;
    const screenY = centerPoint.y * input.viewZoom + input.viewOffsetY;
    const screenMargin = Math.max(
      (outer - inner) * input.viewZoom,
      layout.center * angularHalfStep * input.viewZoom,
      8,
    );
    if (screenX < -screenMargin || screenX > input.width + screenMargin || screenY < -screenMargin || screenY > input.height + screenMargin) return;
    if (shape === "fill") {
      drawCanvasAnnularSector(context, input.cx, input.cy, inner, outer, start, end, cell.fill);
    } else {
      const point = centerPoint;
      const arcLength = Math.max(1, layout.center * angularHalfStep * 2);
      const markerSize = clamp(Math.min(outer - inner, arcLength) * input.markerScale, 4, Math.max(outer - inner, arcLength));
      if (shape === "triangle") {
        context.save();
        context.translate(point.x, point.y);
        context.rotate(angle + Math.PI / 2);
        drawCanvasShape(context, shape, -markerSize / 2, -markerSize / 2, markerSize, markerSize, markerSize, cell.fill, false);
        context.restore();
      } else {
        drawCanvasShape(context, shape, point.x - markerSize / 2, point.y - markerSize / 2, markerSize, markerSize, markerSize, cell.fill, false);
      }
    }
  });

  {
    const rowByIndex = input.heatmapRows;
    const ringGap = Math.max(0, input.heatmapRingStride - input.heatmapRingWidth);
    const radiusAtSlotBoundary = (slotBoundary: number) => input.heatmapInnerRadius
      + slotBoundary * input.heatmapRingStride
      - (slotBoundary > 0 ? ringGap / 2 : 0);
    const angleAtRowBoundary = (rowBoundary: number) => {
      const row = rowByIndex[rowBoundary] ?? rowByIndex[0];
      const center = row ? input.angles.get(row.nodeId) : undefined;
      return center === undefined ? 0 : center - input.heatmapCellHalfStep;
    };
    (["interior", "perimeter"] as const).forEach((boundary) => {
      context.beginPath();
      input.borderEdgesByBoundary[boundary].forEach((edge) => {
        if (edge.axis === "row") {
          const angle = angleAtRowBoundary(edge.rowBoundary);
          const start = polarPoint(input.cx, input.cy, radiusAtSlotBoundary(edge.slotIndex), angle);
          const end = polarPoint(input.cx, input.cy, radiusAtSlotBoundary(edge.slotIndex + 1), angle);
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          return;
        }
        const row = rowByIndex[edge.rowIndex];
        const angle = row ? input.angles.get(row.nodeId) : undefined;
        if (angle === undefined) return;
        const radius = radiusAtSlotBoundary(edge.slotBoundary);
        const start = polarPoint(input.cx, input.cy, radius, angle - input.heatmapCellHalfStep);
        context.moveTo(start.x, start.y);
        context.arc(input.cx, input.cy, radius, angle - input.heatmapCellHalfStep, angle + input.heatmapCellHalfStep);
      });
      context.strokeStyle = HEATMAP_BORDER_COLOR;
      context.lineWidth = boundary === "perimeter" ? HEATMAP_PERIMETER_BORDER_WIDTH : HEATMAP_INTERIOR_BORDER_WIDTH;
      context.stroke();
    });
  }

  if (input.showNumbers) input.heatmapCells.forEach((cell) => {
    const angle = input.angles.get(cell.row.nodeId);
    const layout = input.ringLayouts.get(cell.columnKey);
    if (angle === undefined || !layout) return;
    const centerPoint = polarPoint(input.cx, input.cy, layout.center, angle);
    drawCanvasText(context, cell.label, centerPoint.x, centerPoint.y, input.valueFontSize, cell.fill);
  });
    };
}

type CircularCanvasTileInput = Omit<CircularCanvasDrawInput, "canvas" | "width" | "height" | "offsetX" | "offsetY">;

function CircularHeatmapCanvasTile(props: { tile: CanvasTile; input: CircularCanvasTileInput }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawCircularHeatmapCanvas({ ...props.input, canvas, width: props.tile.width, height: props.tile.height, offsetX: props.tile.left, offsetY: props.tile.top });
  }, [
    props.tile,
    props.input.renderKey,
    props.input.heatmapCells,
  ]);
  return <canvas ref={canvasRef} className="circular-heatmap-canvas" style={{ left: props.tile.left, top: props.tile.top, width: props.tile.width, height: props.tile.height }} aria-hidden="true" />;
}

function CircularHeatmapCanvas(props: { viewport: { width: number; height: number }; input: CircularCanvasTileInput }) {
  const tile = useMemo(() => ({ left: 0, top: 0, width: props.viewport.width, height: props.viewport.height }), [props.viewport.height, props.viewport.width]);
  return <CircularHeatmapCanvasTile tile={tile} input={props.input} />;
}

function truncateTreeLabel(label: string) {
  return label.length > 54 ? `${label.slice(0, 53)}...` : label;
}

export interface RectangularTreeViewProps {
  renderSnapshot: ResultRenderSnapshot;
  treeLayoutNodes: readonly RenderTreeNode[];
  visibleRows: readonly RenderRow[];
  activeStripRank: string;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  stripMinimumLeafCount: number;
  showStripLabels: boolean;
  showBranchLabels: boolean;
  showSpeciesLayer: boolean;
  showSpeciesCount: boolean;
  branchStrokeWidth: number;
  showInternalNodes: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  branchScale: number;
  branchLabelFontSize: number;
  branchMetricFontSize: number;
  speciesCountFontSize: number;
  stripNameFontSize: number;
  rowHeight: number;
  width: number;
  height: number;
  worldTop: number;
  viewZoom: number;
  viewOffset: { x: number; y: number };
  layout: RectangularTreeLayout;
  columns: DisplayColumn[];
  moduleQuery: ModuleQueryInfo | null;
  fallbackHeatmapStyle: HeatmapStyleRecord;
  showNumbers: boolean;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  heatmapColumnWidth: number;
  headerHeight: number;
  contentHeight: number;
  heatmapShapeSize: number;
  heatmapValueFontSize: number;
  columnLabelFontSize: number;
  moduleLabelFontSize: number;
  exportBounds: { left: number; top: number; right: number; bottom: number };
  onScenePlan?: (plan: FigureScenePlan) => void;
  hoveredNodeId: number | null;
  selectedNodeId: number | null;
  deletionPreviewNodeIds: Set<number>;
  treeStyles: ResolvedTreeStyleProjection;
  renderRevision: string;
  selectionMode?: boolean;
  onHoverSource: (nodeId: number | null) => void;
  onOpenNode: (nodeId: number, kind: TreeLayoutNode["kind"], event: ReactMouseEvent<SVGElement>) => void;
  onSelectSource: (nodeId: number) => void;
}

export function RectangularTreeView(props: RectangularTreeViewProps) {
  return <RectangularTreeCanvasView {...props} />;
}

function RectangularTreeCanvasView(props: RectangularTreeViewProps) {
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const interactionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastHoverKeyRef = useRef("");
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [tooltip, setTooltip] = useState<CanvasTooltip>(null);
  useEffect(() => {
    const viewer = stageRef.current?.closest(".viewer-scroll");
    if (!(viewer instanceof HTMLElement)) return;
    const update = () => {
      const rect = viewer.getBoundingClientRect();
      setViewport({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);
  const renderPlan = useMemo(
    () => props.treeLayoutNodes.length && props.visibleRows.length
      ? buildTreeRenderPlan(props.treeLayoutNodes)
      : null,
    [props.treeLayoutNodes, props.visibleRows],
  );
  const stripGroups = useMemo(
    () => props.activeStripRank !== "none"
      ? visibleTaxonColorGroups(props.renderSnapshot.taxonColorPlan, props.stripMinimumLeafCount)
      : [],
    [props.activeStripRank, props.renderSnapshot.taxonColorPlan, props.stripMinimumLeafCount],
  );
  const rectangularScenePlan = useMemo<FigureScenePlan>(() => createScenePlan<FigureSceneGeometry>({
    mode: "rectangular",
    rootAnchor: { x: 0, y: 0 },
    bounds: {
      focus: { left: 0, top: 0, right: props.width, bottom: props.height },
      content: { left: 0, top: 0, right: props.width, bottom: props.height },
      export: props.exportBounds,
    },
    partitions: { root: 0, treeContent: props.width, stripContent: 0, heatmapContent: 0, treeToStripGap: 0, stripToHeatmapGap: 0 },
    fonts: {
      branchLabel: { family: "inherit", size: props.branchLabelFontSize, weight: 500 },
      branchLength: { family: "inherit", size: props.branchMetricFontSize, weight: 500 },
      speciesCount: { family: "inherit", size: props.speciesCountFontSize, weight: 500 },
      stripLabel: { family: "inherit", size: props.stripNameFontSize, weight: 500 },
    },
    layers: {
      background: [],
      tree: props.treeLayoutNodes.map((node) => ({ id: `tree:${node.id}`, kind: node.kind, layer: "tree" as const, bounds: { left: node.x - 12, top: node.y - 12, right: node.x + 12, bottom: node.y + 12 }, payload: node })),
      taxonomy: [], heatmap: [], labels: [], overlayBase: [],
    },
    hitIndex: {
      resolve: (point) => {
        const target = resolveRectangularTarget(point);
        if (!target) return null;
        const kind = target.kind === "strip" ? "strip" : target.kind === "branch" ? "branch" : "node";
        return { kind, key: `${target.kind}:${target.nodeId}`, bounds: { left: point.x, top: point.y, right: point.x, bottom: point.y }, payload: target };
      },
    },
    semantic: [props.renderRevision, props.treeLayoutNodes.length, props.visibleRows.length],
    layout: [props.layout, props.branchScale, props.rowHeight, props.width, props.height],
    frame: [props.viewZoom, props.viewOffset.x, props.viewOffset.y],
    revision: { semantic: props.treeLayoutNodes.length, layout: Math.round(props.rowHeight), frame: Math.round(props.viewZoom * 1000) },
    geometry: {
      mode: "rectangular",
      layout: props.layout,
      treeLayoutNodes: props.treeLayoutNodes,
      visibleRows: props.visibleRows,
      visibleStripGroups: stripGroups,
      renderSnapshot: props.renderSnapshot,
      columns: props.columns,
      moduleQuery: props.moduleQuery,
      fallbackHeatmapStyle: props.fallbackHeatmapStyle,
      activeStripRank: props.activeStripRank,
      taxonDisplayStyle: props.taxonDisplayStyle,
      taxonNameDisplayMode: props.taxonNameDisplayMode,
      showStripLabels: props.showStripLabels,
      showBranchLabels: props.showBranchLabels,
      showSpeciesCount: props.showSpeciesCount,
      showInternalNodes: props.showInternalNodes,
      showBranchGuides: props.showBranchGuides,
      showBranchLengths: props.showBranchLengths,
      showNumbers: props.showNumbers,
      showModuleNames: props.showModuleNames,
      showModuleFullName: props.showModuleFullName,
      branchScale: props.branchScale,
      branchStrokeWidth: props.branchStrokeWidth,
      rowHeight: props.rowHeight,
      headerHeight: props.headerHeight,
      contentHeight: props.contentHeight,
      heatmapColumnWidth: props.heatmapColumnWidth,
      heatmapShapeSize: props.heatmapShapeSize,
      branchLabelFontSize: props.branchLabelFontSize,
      branchMetricFontSize: props.branchMetricFontSize,
      speciesCountFontSize: props.speciesCountFontSize,
      stripNameFontSize: props.stripNameFontSize,
      columnLabelFontSize: props.columnLabelFontSize,
      moduleLabelFontSize: props.moduleLabelFontSize,
      heatmapValueFontSize: props.heatmapValueFontSize,
    },
  }), [props.branchLabelFontSize, props.branchMetricFontSize, props.branchScale, props.branchStrokeWidth, props.columnLabelFontSize, props.columns, props.contentHeight, props.exportBounds, props.fallbackHeatmapStyle, props.headerHeight, props.heatmapColumnWidth, props.heatmapShapeSize, props.heatmapValueFontSize, props.height, props.layout, props.moduleLabelFontSize, props.moduleQuery, props.renderRevision, props.renderSnapshot, props.rowHeight, props.showBranchGuides, props.showBranchLabels, props.showBranchLengths, props.showInternalNodes, props.showModuleFullName, props.showModuleNames, props.showNumbers, props.showSpeciesCount, props.showStripLabels, props.speciesCountFontSize, props.stripNameFontSize, props.taxonDisplayStyle, props.taxonNameDisplayMode, props.treeLayoutNodes, props.viewOffset.x, props.viewOffset.y, props.viewZoom, props.visibleRows, props.width, renderPlan, stripGroups]);
  useEffect(() => {
    props.onScenePlan?.(rectangularScenePlan);
  }, [props.onScenePlan, rectangularScenePlan]);

  const backgroundStyleRuns = props.treeStyles.backgroundRuns;
  const stripStyleRuns = props.treeStyles.stripRuns;
  const selectedScope = useMemo(
    () => resolveTreeHighlightScope(props.treeLayoutNodes, props.selectedNodeId),
    [props.selectedNodeId, props.treeLayoutNodes],
  );
  const deletionScopes = useMemo(
    () => Array.from(props.deletionPreviewNodeIds, (nodeId) => resolveTreeHighlightScope(props.treeLayoutNodes, nodeId)),
    [props.deletionPreviewNodeIds, props.treeLayoutNodes],
  );
  const hoveredScope = useMemo(
    () => resolveTreeHighlightScope(props.treeLayoutNodes, props.hoveredNodeId),
    [props.hoveredNodeId, props.treeLayoutNodes],
  );
  const internalNodeBuckets = useMemo(() => {
    const buckets = new Map<number, TreeLayoutNode[]>();
    props.treeLayoutNodes.forEach((node) => {
      if (node.kind !== "internal") return;
      const key = Math.floor(node.y / 64);
      const bucket = buckets.get(key) ?? [];
      bucket.push(node);
      buckets.set(key, bucket);
    });
    return buckets;
  }, [props.treeLayoutNodes]);
  const rectangularDrawBuckets = useMemo(() => {
    const bucketSize = 256;
    const buckets = new Map<number, TreeLayoutNode[]>();
    props.treeLayoutNodes.forEach((node) => {
      const parent = node.parent === null ? null : props.treeLayoutNodes[node.parent];
      const top = Math.min(node.y, parent?.y ?? node.y) - props.rowHeight;
      const bottom = Math.max(node.y, parent?.y ?? node.y) + props.rowHeight;
      for (let key = Math.floor(top / bucketSize); key <= Math.floor(bottom / bucketSize); key += 1) {
        const bucket = buckets.get(key) ?? [];
        bucket.push(node);
        buckets.set(key, bucket);
      }
    });
    return { bucketSize, buckets };
  }, [props.rowHeight, props.treeLayoutNodes]);
  // The parent keeps the vector/event world transform. Dividing CSS size by zoom
  // makes the zoomed backing land at exactly viewport DPR, without double scaling.
  const tiles = useMemo(() => [resolveCounterProjectedCanvas(
    viewport,
    { zoom: props.viewZoom, offsetX: props.viewOffset.x, offsetY: props.viewOffset.y },
    { x: 0, y: props.worldTop },
  )], [props.viewOffset.x, props.viewOffset.y, props.viewZoom, props.worldTop, viewport]);
  const visibleDrawNodes = useMemo(() => {
    const tile = tiles[0];
    if (!tile) return [];
    const nodes = new Set<TreeLayoutNode>();
    for (let key = Math.floor(tile.top / rectangularDrawBuckets.bucketSize); key <= Math.floor((tile.top + tile.height) / rectangularDrawBuckets.bucketSize); key += 1) {
      rectangularDrawBuckets.buckets.get(key)?.forEach((node) => nodes.add(node));
    }
    return Array.from(nodes);
  }, [rectangularDrawBuckets, tiles]);
  const dataRenderKey = useMemo(() => [
    props.width,
    props.height,
    props.branchScale,
    props.branchStrokeWidth,
    props.branchLabelFontSize,
    props.branchMetricFontSize,
    props.speciesCountFontSize,
    props.stripNameFontSize,
    props.taxonDisplayStyle,
    props.taxonNameDisplayMode,
    props.showBranchLabels,
    props.showBranchGuides,
    props.showBranchLengths,
    props.showInternalNodes,
    props.showSpeciesLayer,
    props.showSpeciesCount,
    props.showStripLabels,
    props.renderRevision,
    props.renderRevision,
  ].join("::"), [
    props.branchLabelFontSize,
    props.branchMetricFontSize,
    props.branchScale,
    props.branchStrokeWidth,
    props.height,
    props.showBranchGuides,
    props.showBranchLabels,
    props.showBranchLengths,
    props.showInternalNodes,
    props.showSpeciesCount,
    props.showSpeciesLayer,
    props.showStripLabels,
    props.speciesCountFontSize,
    props.stripNameFontSize,
    props.taxonDisplayStyle,
    props.taxonNameDisplayMode,
    props.treeLayoutNodes,
    props.renderRevision,
    props.width,
  ]);
  const renderKey = `${dataRenderKey}:${props.viewZoom}:${props.viewOffset.x}:${props.viewOffset.y}:${viewport.width}:${viewport.height}`;
  useEffect(() => {
    if (!renderPlan) return;
    tiles.forEach((tile) => {
      const canvas = canvasRefs.current.get("viewport");
      if (!canvas) return;
      const backing = resolveCanvasBackingSize(viewport, window.devicePixelRatio || 1);
      const pixelRatio = backing.pixelRatio;
      if (canvas.width !== backing.width) canvas.width = backing.width;
      if (canvas.height !== backing.height) canvas.height = backing.height;
      canvas.style.width = `${tile.width}px`;
      canvas.style.height = `${tile.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(
        pixelRatio * props.viewZoom,
        0,
        0,
        pixelRatio * props.viewZoom,
        -tile.left * pixelRatio * props.viewZoom,
        -tile.top * pixelRatio * props.viewZoom,
      );
      context.fillStyle = "#fff";
      context.fillRect(tile.left, tile.top, tile.width, tile.height);
      const tileBottom = tile.top + tile.height;
      {

      backgroundStyleRuns.forEach(({ style, startIndex, endIndex }) => {
        const band = rectangularTreeStyleRowBand(props.visibleRows, startIndex, endIndex, props.rowHeight);
        if (!band) return;
        const { top, height } = band;
        if (top + height < tile.top || top > tileBottom) return;
        const background = rectangularBackgroundRange(renderPlan.rootNode.x, props.width);
        context.fillStyle = taxonStyleColorCss(style.color, "background");
        context.fillRect(background.startX, top, background.width, height);
      });

      if (renderPlan.rootNode.y >= tile.top && renderPlan.rootNode.y <= tileBottom) {
        const rootStem = rectangularRootStem(renderPlan.rootNode.x, renderPlan.rootNode.y);
        context.beginPath();
        context.moveTo(rootStem.startX, rootStem.y);
        context.lineTo(rootStem.endX, rootStem.y);
        context.strokeStyle = "#000";
        context.lineWidth = props.branchStrokeWidth;
        context.stroke();
      }

      visibleDrawNodes.forEach((node) => {
        if (node.parent === null) return;
        const parent = props.treeLayoutNodes[node.parent];
        if (!parent || Math.max(parent.y, node.y) < tile.top || Math.min(parent.y, node.y) > tileBottom) return;
        const style = props.treeStyles.branchByNodeId.get(node.nodeId);
        const parentX = rectangularNodeX(parent, renderPlan.rootNode, props.branchScale);
        const nodeX = rectangularNodeX(node, renderPlan.rootNode, props.branchScale);
        context.beginPath();
        context.moveTo(parentX, parent.y);
        context.lineTo(parentX, node.y);
        context.lineTo(nodeX, node.y);
        context.strokeStyle = style?.color ?? "#000";
        context.lineWidth = props.branchStrokeWidth;
        context.stroke();
        context.globalAlpha = 1;
        if (props.showBranchLengths && node.branchLength > 0) {
          drawOutlinedCanvasText(context, formatBranchLength(node.branchLength, 6), (parentX + nodeX) / 2, node.y - props.rowHeight * 0.36, {
            fontSize: props.branchMetricFontSize,
            weight: RESULT_FONT_WEIGHTS.branchLength,
            strokeWidth: 2.4,
            stroke: "rgba(255,255,255,0.94)",
          });
        }
      });

      stripStyleRuns.forEach(({ style, startIndex, endIndex }) => {
        const band = rectangularTreeStyleRowBand(props.visibleRows, startIndex, endIndex, props.rowHeight);
        if (!band) return;
        const { top, height } = band;
        if (top + height < tile.top || top > tileBottom) return;
        context.fillStyle = taxonStyleColorCss(style.color, "strip");
        context.fillRect(props.layout.stripX, top, props.layout.stripWidth, height);
      });
      if (props.showStripLabels && props.taxonNameDisplayMode === "embedded") {
        stripGroups.forEach((group) => {
          const band = rectangularTreeStyleRowBand(props.visibleRows, group.startIndex, group.endIndex, props.rowHeight);
          if (!band) return;
          const { top, height } = band;
          if (top + height < tile.top || top > tileBottom) return;
          context.font = canvasFont(props.stripNameFontSize, RESULT_FONT_WEIGHTS.taxonLabel);
          context.textAlign = "left";
          context.textBaseline = "middle";
          context.fillStyle = "#000";
          const labelX = props.layout.stripX + (props.taxonDisplayStyle === "strip" ? props.layout.stripWidth : 0) + 6;
          context.fillText(group.label, labelX, top + height / 2);
        });
      }

      visibleDrawNodes.forEach((node) => {
        if (node.y + props.rowHeight < tile.top || node.y - props.rowHeight > tileBottom) return;
        const x = rectangularNodeX(node, renderPlan.rootNode, props.branchScale);
        if (node.kind === "internal") {
          if (props.showInternalNodes) drawCanvasDiamond(context, x, node.y, 10, "#000");
          return;
        }
        if (props.showBranchGuides) {
          context.save();
          context.beginPath();
          context.moveTo(x, node.y);
          context.lineTo(props.layout.labelX - 8, node.y);
          context.strokeStyle = "#808080";
          context.lineWidth = branchGuideStrokeWidth(props.branchStrokeWidth, false);
          context.setLineDash(branchGuideDashArray(props.branchStrokeWidth, false).split(" ").map(Number));
          context.stroke();
          context.restore();
        }
        if (props.showBranchLabels) {
          const style = props.treeStyles.labelByNodeId.get(node.nodeId);
          context.font = canvasFont(props.branchLabelFontSize, RESULT_FONT_WEIGHTS.branchLabel);
          context.textAlign = "left";
          context.textBaseline = "middle";
          context.fillStyle = style?.color ?? "#000";
          context.fillText(truncateTreeLabel(node.label), props.layout.labelX, node.y);
        }
        if (props.showSpeciesLayer && props.showSpeciesCount) {
          drawOutlinedCanvasText(context, String(node.aliveLeafCount), props.layout.speciesCountX + 16, node.y + 1, {
            fontSize: props.speciesCountFontSize,
            weight: RESULT_FONT_WEIGHTS.speciesCount,
            fill: "#000",
          });
        }
      });
        };
    });
  }, [renderKey, renderPlan, stripGroups, tiles, viewport, visibleDrawNodes]);

  useEffect(() => {
    const canvas = interactionCanvasRef.current;
    const tile = tiles[0];
    if (!canvas || !tile || !renderPlan) return;
    const backing = resolveCanvasBackingSize(viewport, window.devicePixelRatio || 1);
    const pixelRatio = backing.pixelRatio;
    if (canvas.width !== backing.width) canvas.width = backing.width;
    if (canvas.height !== backing.height) canvas.height = backing.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.setTransform(pixelRatio * props.viewZoom, 0, 0, pixelRatio * props.viewZoom, -tile.left * pixelRatio * props.viewZoom, -tile.top * pixelRatio * props.viewZoom);
    {
    const drawScopeBranches = (scope: TreeHighlightScope, color: string, alpha: number) => {
      context.save();
      context.strokeStyle = color;
      context.fillStyle = color;
      context.globalAlpha = alpha;
      context.lineWidth = props.branchStrokeWidth + 1;
      scope.nodeIds.forEach((nodeId) => {
        const node = renderPlan.nodeByNodeId.get(nodeId);
        if (!node) return;
        if (node.parent !== null) {
          const parent = renderPlan.nodeById.get(node.parent);
          if (parent) {
            context.beginPath();
            const parentX = rectangularNodeX(parent, renderPlan.rootNode, props.branchScale);
            const nodeX = rectangularNodeX(node, renderPlan.rootNode, props.branchScale);
            context.moveTo(parentX, parent.y);
            context.lineTo(parentX, node.y);
            context.lineTo(nodeX, node.y);
            context.stroke();
          }
        }
      });
      if (scope.directNode?.kind === "internal" && props.showInternalNodes) {
        drawCanvasDiamond(
          context,
          rectangularNodeX(scope.directNode, renderPlan.rootNode, props.branchScale),
          scope.directNode.y,
          12.4,
          color,
          "#000",
          2,
        );
      }
      context.restore();
    };
    if (hoveredScope) drawScopeBranches(hoveredScope, "#000", 1);
    if (props.selectedNodeId !== null && selectedScope) drawScopeBranches(selectedScope, "#d06a00", 0.86);
    deletionScopes.forEach((scope) => drawScopeBranches(scope, "#b23a48", 0.72));
      };
  }, [deletionScopes, hoveredScope, props.branchScale, props.branchStrokeWidth, props.selectedNodeId, props.showInternalNodes, renderPlan, selectedScope, tiles, viewport]);

  if (!renderPlan) {
    return <div ref={stageRef} className="rectangular-tree-canvas-stage" style={{ width: props.width, height: props.height }} />;
  }

  const hoveredTerminals = hoveredScope?.terminalNodes ?? [];
  const hoverAnchorNode = hoveredScope?.directNode ?? null;
  const syntheticHoverX = hoveredScope?.syntheticNodeId === null || hoveredScope?.syntheticNodeId === undefined
    ? null
    : hoveredScope.terminalNodes[0]?.x ?? renderPlan.rootNode.x;
  const hoverAnchorX = hoverAnchorNode
    ? rectangularNodeX(hoverAnchorNode, renderPlan.rootNode, props.branchScale)
    : syntheticHoverX === null
      ? null
      : renderPlan.rootNode.x + (syntheticHoverX - renderPlan.rootNode.x) * props.branchScale;
  const hoverBand = hoverAnchorX !== null && hoveredTerminals.length ? {
    left: hoverAnchorX,
    top: Math.min(...hoveredTerminals.map((node) => node.y)) - props.rowHeight * 0.44,
    width: Math.max(16, props.width - hoverAnchorX),
    height: Math.max(...hoveredTerminals.map((node) => node.y)) - Math.min(...hoveredTerminals.map((node) => node.y)) + props.rowHeight * 0.88,
  } : null;
  const scopeBand = (scope: TreeHighlightScope | null) => {
    const terminals = scope?.terminalNodes ?? [];
    return terminals.length ? {
      top: Math.min(...terminals.map((node) => node.y)) - props.rowHeight / 2,
      height: Math.max(...terminals.map((node) => node.y)) - Math.min(...terminals.map((node) => node.y)) + props.rowHeight,
    } : null;
  };
  const selectedBand = scopeBand(selectedScope);
  const stripTargets = props.treeStyles.stripRuns.map((run) => ({
    startIndex: run.startIndex,
    endIndex: run.endIndex,
    nodeId: run.style.nodeId,
    label: run.style.name,
  }));

  function localPoint(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * props.width / Math.max(1, rect.width), y: (event.clientY - rect.top) * props.height / Math.max(1, rect.height) };
  }

  function resolveRectangularTarget(point: ScenePoint) {
    const strip = [...stripTargets].reverse().find((target) => {
      const band = rectangularTreeStyleRowBand(props.visibleRows, target.startIndex, target.endIndex, props.rowHeight);
      return band
        && point.x >= props.layout.stripX
        && point.x <= props.layout.stripX + props.layout.stripWidth + props.layout.stripLabelWidth
        && point.y >= band.top
        && point.y <= band.top + band.height;
    });
    if (strip?.nodeId !== null && strip?.nodeId !== undefined) return { nodeId: strip.nodeId, kind: "strip" as const, label: strip.label };
    const rowIndex = Math.floor(point.y / props.rowHeight);
    const row = props.visibleRows[rowIndex];
    const terminal = row ? renderPlan!.terminalNodeByNodeId.get(row.nodeId) : null;
    let closest: TreeLayoutNode | null = null;
    let distance = 10;
    const internalBucket = Math.floor(point.y / 64);
    [internalBucket - 1, internalBucket, internalBucket + 1].flatMap((key) => internalNodeBuckets.get(key) ?? []).forEach((node) => {
      const current = Math.hypot(rectangularNodeX(node, renderPlan!.rootNode, props.branchScale) - point.x, node.y - point.y);
      if (current < distance) { closest = node; distance = current; }
    });
    if (closest) return { nodeId: (closest as TreeLayoutNode).nodeId, kind: "internal" as const };
    const terminalX = terminal ? rectangularNodeX(terminal, renderPlan!.rootNode, props.branchScale) : 0;
    if (terminal && point.x >= terminalX - 10 && point.x <= props.width) return { nodeId: terminal.nodeId, kind: terminal.kind };
    const branchTolerance = Math.max(4, 7 / Math.max(0.7, props.viewZoom));
    let branchNode = terminal ?? null;
    while (branchNode?.parent !== null && branchNode?.parent !== undefined) {
      const parent = renderPlan!.nodeById.get(branchNode.parent);
      if (!parent) break;
      const parentX = rectangularNodeX(parent, renderPlan!.rootNode, props.branchScale);
      const childX = rectangularNodeX(branchNode, renderPlan!.rootNode, props.branchScale);
      const parentPoint = { x: parentX, y: parent.y };
      const elbow = { x: parentX, y: branchNode.y };
      const childPoint = { x: childX, y: branchNode.y };
      const owner = resolveBranchHitOwner(parent, branchNode, {
        parentDistance: distanceToSegment(point, parentPoint, elbow),
        childDistance: distanceToSegment(point, elbow, childPoint),
        childProgress: progressAlongSegment(point, elbow, childPoint),
        tolerance: branchTolerance,
      });
      if (owner) {
        return { nodeId: owner.nodeId, kind: "branch" as const, nodeKind: owner.kind };
      }
      branchNode = parent;
    }
    return null;
  }

  function hitTarget(event: ReactMouseEvent<HTMLDivElement>) {
    return rectangularScenePlan.hitIndex.resolve(localPoint(event))?.payload as ReturnType<typeof resolveRectangularTarget>;
  }

  const tooltipLayer = tooltip && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={tooltipRef}
        className="canvas-node-tooltip canvas-node-tooltip-fixed"
        role="tooltip"
        style={{
          left: Math.max(20, Math.min((typeof window === "undefined" ? 450 : window.innerWidth) - 450, tooltip.x)),
          top: Math.max(20, Math.min((typeof window === "undefined" ? 85 : window.innerHeight) - 85, tooltip.y)),
        }}
      >
        {tooltip.label}
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={stageRef} className="rectangular-tree-canvas-stage" style={{ width: props.width, height: props.height }} onMouseLeave={() => { props.onHoverSource(null); setTooltip(null); }}>
      {tiles.map((tile) => <canvas key="rectangular-tree-viewport" ref={(canvas) => { if (canvas) canvasRefs.current.set("viewport", canvas); else canvasRefs.current.delete("viewport"); }} className="rectangular-tree-canvas" style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }} aria-hidden="true" />)}
      {tiles.map((tile) => <canvas key="rectangular-tree-interaction-viewport" ref={interactionCanvasRef} className="rectangular-tree-interaction-canvas" style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }} aria-hidden="true" />)}
      {selectedBand ? <div className="rectangular-tree-selection-overlay" style={{ left: 0, top: selectedBand.top, width: props.width, height: selectedBand.height }} /> : null}
      {deletionScopes.map((scope, index) => { const band = scopeBand(scope); return band ? <div key={index} className="rectangular-tree-deletion-overlay" style={{ left: 0, top: band.top, width: props.width, height: band.height }} /> : null; })}
      {hoverBand ? <div className="rectangular-tree-hover-overlay" style={{ left: hoverBand.left, top: hoverBand.top, width: hoverBand.width, height: hoverBand.height }} /> : null}
      <div
        className="rectangular-tree-event-surface"
        onMouseMove={(event) => {
          const target = hitTarget(event);
          const tooltipPoint = { x: event.clientX, y: event.clientY };
          const hoverKey = target
            ? `${target.kind}:${target.nodeId}:${target.kind === "strip" ? target.label : ""}`
            : "";
          const hoverChanged = hoverKey !== lastHoverKeyRef.current;
          if (hoverChanged) {
            lastHoverKeyRef.current = hoverKey;
            props.onHoverSource(target?.nodeId ?? null);
            setTooltip(target?.kind === "strip"
              ? { label: target.label, ...tooltipPoint }
              : target?.kind === "branch"
                ? null
                : namedNodeTooltip(target ? renderPlan?.nodeByNodeId.get(target.nodeId) as RenderTreeNode | undefined : undefined, tooltipPoint.x, tooltipPoint.y));
          } else if (tooltipRef.current) {
            tooltipRef.current.style.left = `${Math.max(20, Math.min((typeof window === "undefined" ? 450 : window.innerWidth) - 450, tooltipPoint.x))}px`;
            tooltipRef.current.style.top = `${Math.max(20, Math.min((typeof window === "undefined" ? 85 : window.innerHeight) - 85, tooltipPoint.y))}px`;
          }
        }}
        onMouseLeave={() => { lastHoverKeyRef.current = ""; props.onHoverSource(null); setTooltip(null); }}
        onClick={(event) => { const target = hitTarget(event); if (!target) return; event.stopPropagation(); if (target.kind === "strip") props.onSelectSource(target.nodeId); else props.onOpenNode(target.nodeId, target.kind === "branch" ? target.nodeKind : target.kind, event as unknown as ReactMouseEvent<SVGElement>); }}
        onContextMenu={(event) => { if (props.selectionMode) { event.preventDefault(); event.stopPropagation(); return; } const target = hitTarget(event); if (!target || target.kind === "strip") return; event.preventDefault(); event.stopPropagation(); props.onOpenNode(target.nodeId, target.kind === "branch" ? target.nodeKind : target.kind, event as unknown as ReactMouseEvent<SVGElement>); }}
      />
      {tooltipLayer}
    </div>
  );
}

export interface CircularTreeViewProps {
  renderSnapshot: ResultRenderSnapshot;
  treeLayoutNodes: readonly RenderTreeNode[];
  visibleRows: readonly RenderRow[];
  presentationGeometry: CircularSceneGeometry;
  columns: DisplayColumn[];
  moduleQuery: ModuleQueryInfo | null;
  activeModuleId: string | null;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  selectedCellKeys: Set<string>;
  columnDragDraft: ColumnDragDraft | null;
  hoveredCellKey: string | null;
  hoveredColumnKey: string | null;
  activeStripRank: string;
  showStrip: boolean;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  showStripLabels: boolean;
  stripMinimumLeafCount: number;
  stripColumnWidth: number;
  showSpeciesLayer: boolean;
  showSpeciesCount: boolean;
  showBranchLabels: boolean;
  branchStrokeWidth: number;
  showInternalNodes: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  branchScale: number;
  spacingScale: number;
  circularArcDegrees: number;
  circularRotationDegrees: number;
  branchLabelFontSize: number;
  branchMetricFontSize: number;
  columnLabelFontSize: number;
  moduleLabelFontSize: number;
  speciesCountFontSize: number;
  stripNameFontSize: number;
  heatmapRingWidth: number;
  heatmapMarkerSize: number;
  heatmapValueFontSize: number;
  showHeatmapNumbers: boolean;
  size: number;
  minimumTreePartitionRadius: number;
  viewZoom: number;
  viewOffset: { x: number; y: number };
  hoveredNodeId: number | null;
  selectedNodeId: number | null;
  deletionPreviewNodeIds: Set<number>;
  treeStyles: ResolvedTreeStyleProjection;
  selectionMode?: boolean;
  onScenePlan?: (plan: FigureScenePlan) => void;
  onColumnMenu: (event: ReactMouseEvent<SVGGraphicsElement>, column: DisplayColumn, index: number) => void;
  onColumnPrimaryAction: (column: DisplayColumn) => void;
  onColumnDrag: (event: ReactMouseEvent<SVGGraphicsElement>, column: DisplayColumn) => void;
  onToggleCell: (row: RenderRow, column: SearchColumn, count: number) => void;
  onCellMenu: (event: ReactMouseEvent<SVGGraphicsElement>, key: string) => void;
  onHoverSource: (nodeId: number | null) => void;
  onHoverCellKey: (key: string | null) => void;
  onHoverColumnKey: (key: string | null) => void;
  onOpenNode: (nodeId: number, kind: TreeLayoutNode["kind"], event: ReactMouseEvent<SVGElement>) => void;
}

export function CircularTreeView(props: CircularTreeViewProps) {
  if (!props.visibleRows.length || !props.treeLayoutNodes.length) {
    return <svg className="circular-tree-svg" width={props.size} height={props.size} />;
  }
  return <CircularTreeCanvasViewContent {...props} />;
}

function CircularTreeCanvasViewContent(props: CircularTreeViewProps) {
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverTargetRef = useRef<CircularTreeHitTarget>(null);
  const lastHoverKeyRef = useRef("");
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [tooltip, setTooltip] = useState<CanvasTooltip>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      setViewport((current) => current.width === width && current.height === height ? current : { width, height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const { angular: circularAngularLayout, radiusByNodeId } = props.presentationGeometry;
  const circularScene = useMemo(() => {
    const cx = props.size / 2;
    const cy = props.size / 2;
    const renderPlan = buildTreeRenderPlan(props.treeLayoutNodes);
    const nodeById = renderPlan.nodeById;
    const terminalNodeByNodeId = renderPlan.terminalNodeByNodeId;
    const layoutNodeByNodeId = renderPlan.nodeByNodeId;
    const rootNode = renderPlan.rootNode;
    const rootX = rootNode.x;
    const { angleByLayoutNodeId } = circularAngularLayout;
    const hitBucketSize = 64;
    const nodeHitBuckets = new Map<string, Array<{ node: TreeLayoutNode; point: ScenePoint }>>();
    props.treeLayoutNodes.forEach((node) => {
      const angle = angleByLayoutNodeId.get(node.id);
      const radius = radiusByNodeId.get(node.id);
      if (angle === undefined || radius === undefined) return;
      const point = polarPoint(cx, cy, radius, angle);
      const key = `${Math.floor(point.x / hitBucketSize)}:${Math.floor(point.y / hitBucketSize)}`;
      const bucket = nodeHitBuckets.get(key) ?? [];
      bucket.push({ node, point });
      nodeHitBuckets.set(key, bucket);
    });
    const branchDrawBucketSize = 256;
    const branchDrawBuckets = new Map<string, Array<{ node: TreeLayoutNode; parent: TreeLayoutNode; parentAngle: number; childAngle: number; parentRadius: number; childRadius: number }>>();
    props.treeLayoutNodes.forEach((node) => {
      if (node.parent === null) return;
      const parent = nodeById.get(node.parent);
      const parentAngle = parent ? angleByLayoutNodeId.get(parent.id) : undefined;
      const childAngle = angleByLayoutNodeId.get(node.id);
      const parentRadius = parent ? radiusByNodeId.get(parent.id) : undefined;
      const childRadius = radiusByNodeId.get(node.id);
      if (!parent || parentAngle === undefined || childAngle === undefined || parentRadius === undefined || childRadius === undefined) return;
      const primitive = { node, parent, parentAngle, childAngle, parentRadius, childRadius };
      const bounds = circularBranchBounds(cx, cy, parentRadius, parentAngle, childRadius, childAngle);
      for (let x = Math.floor(bounds.left / branchDrawBucketSize); x <= Math.floor(bounds.right / branchDrawBucketSize); x += 1) {
        for (let y = Math.floor(bounds.top / branchDrawBucketSize); y <= Math.floor(bounds.bottom / branchDrawBucketSize); y += 1) {
          const key = `${x}:${y}`;
          const bucket = branchDrawBuckets.get(key) ?? [];
          bucket.push(primitive);
          branchDrawBuckets.set(key, bucket);
        }
      }
    });
    return { renderPlan, cx, cy, nodeById, terminalNodeByNodeId, layoutNodeByNodeId, rootNode, rootX, hitBucketSize, nodeHitBuckets, branchDrawBucketSize, branchDrawBuckets };
  }, [circularAngularLayout, props.size, props.treeLayoutNodes, props.visibleRows, radiusByNodeId]);
  const { cx, cy, nodeById, terminalNodeByNodeId, layoutNodeByNodeId, rootNode, rootX, hitBucketSize, nodeHitBuckets, branchDrawBucketSize, branchDrawBuckets } = circularScene;
  const { availableArc, leafStep, startAngle, endAngle, sectorHalfStep, angleByTreeNodeId, angleByLayoutNodeId, spanByNodeId } = circularAngularLayout;
  const visibleCircularBranches = useMemo(() => {
    const left = -props.viewOffset.x / props.viewZoom;
    const top = -props.viewOffset.y / props.viewZoom;
    const right = (viewport.width - props.viewOffset.x) / props.viewZoom;
    const bottom = (viewport.height - props.viewOffset.y) / props.viewZoom;
    const primitives = new Set<(typeof branchDrawBuckets extends Map<string, Array<infer T>> ? T : never)>();
    for (let x = Math.floor(left / branchDrawBucketSize); x <= Math.floor(right / branchDrawBucketSize); x += 1) {
      for (let y = Math.floor(top / branchDrawBucketSize); y <= Math.floor(bottom / branchDrawBucketSize); y += 1) {
        branchDrawBuckets.get(`${x}:${y}`)?.forEach((primitive) => primitives.add(primitive));
      }
    }
    return Array.from(primitives);
  }, [branchDrawBucketSize, branchDrawBuckets, props.viewOffset.x, props.viewOffset.y, props.viewZoom, viewport.height, viewport.width]);
  const heatmapSectorHalfStep = sectorHalfStep * clamp(props.heatmapMarkerSize, 0.05, 1);
  const treeOuterRadius = props.presentationGeometry.treeOuterRadius;
  const labelTextBudget = useMemo(
    () => props.showBranchLabels ? props.visibleRows.reduce((max, row) => Math.max(max, circularLabelWidth(row.label, props.branchLabelFontSize)), 120) : 0,
    [props.branchLabelFontSize, props.showBranchLabels, props.visibleRows],
  );
  const stripGroups = useMemo(
    () => props.showStrip && props.activeStripRank !== "none" ? visibleTaxonColorGroups(props.renderSnapshot.taxonColorPlan, props.stripMinimumLeafCount) : [],
    [props.activeStripRank, props.renderSnapshot.taxonColorPlan, props.showStrip, props.stripMinimumLeafCount],
  );
  const showEmbeddedTaxonNames = props.showStrip && props.showStripLabels && props.taxonNameDisplayMode === "embedded" && props.activeStripRank !== "none";
  const radialLayout = props.presentationGeometry.radialLayout;
  const {
    ringGap,
    labelRadius,
    labelOuterRadius,
    speciesInnerRadius,
    speciesOuterRadius,
    stripInnerRadius,
    stripOuterRadius,
    stripLabelRingInnerRadius,
    stripLabelRingOuterRadius,
    stripLabelRadius,
    heatmapInnerRadius,
  } = radialLayout;
  const heatmapRingGap = Math.max(1.2, props.heatmapRingWidth * 0.08);
  const heatmapRingStride = props.heatmapRingWidth + heatmapRingGap;
  const ringLayouts = useMemo(() => props.columns.map((column) => {
    const inner = heatmapInnerRadius + column.slotIndex * heatmapRingStride;
    const outer = inner + props.heatmapRingWidth;
    return { column, index: column.slotIndex, inner, outer, center: (inner + outer) / 2, width: props.heatmapRingWidth };
  }), [heatmapInnerRadius, heatmapRingStride, props.columns, props.heatmapRingWidth]);
  const ringLayoutByColumnKey = useMemo(() => new Map(ringLayouts.map((layout) => [normalizeColumnKey(layout.column), layout])), [ringLayouts]);
  const columnBySlotIndex = useMemo(() => new Map(props.columns.map((column) => [column.slotIndex, column])), [props.columns]);
  const heatmapOuterRadius = Math.max(ringLayouts.length ? Math.max(...ringLayouts.map((layout) => layout.outer)) : heatmapInnerRadius);
  const maxColumnLabelWidth = useMemo(() => props.columns.reduce((max, column) => column.displayLabel ? Math.max(max, columnLabelWidth(column.displayLabel, props.columnLabelFontSize)) : max, 42), [props.columnLabelFontSize, props.columns]);
  const circularLabelDrawIndex = useMemo(() => {
    const bucketSize = 256;
    const items: Array<{ row: RenderRow; node: TreeLayoutNode; angle: number; point: ScenePoint }> = [];
    const buckets = new Map<string, typeof items>();
    if (!props.showBranchLabels) return { bucketSize, buckets, items };
    props.visibleRows.forEach((row) => {
      const angle = angleByTreeNodeId.get(row.nodeId);
      const node = terminalNodeByNodeId.get(row.nodeId);
      if (angle === undefined || !node) return;
      const point = polarPoint(cx, cy, labelRadius, angle);
      const key = `${Math.floor(point.x / bucketSize)}:${Math.floor(point.y / bucketSize)}`;
      const item = { row, node, angle, point };
      items.push(item);
      const bucket = buckets.get(key) ?? [];
      bucket.push(item);
      buckets.set(key, bucket);
    });
    return { bucketSize, buckets, items };
  }, [angleByTreeNodeId, cx, cy, labelRadius, props.showBranchLabels, props.visibleRows, terminalNodeByNodeId]);
  const visibleCircularLabels = useMemo(() => {
    const margin = Math.max(24, labelTextBudget);
    const left = (-props.viewOffset.x / props.viewZoom) - margin;
    const top = (-props.viewOffset.y / props.viewZoom) - margin;
    const right = ((viewport.width - props.viewOffset.x) / props.viewZoom) + margin;
    const bottom = ((viewport.height - props.viewOffset.y) / props.viewZoom) + margin;
    return collectVisibleSpatialItems(
      circularLabelDrawIndex.items,
      circularLabelDrawIndex.buckets,
      circularLabelDrawIndex.bucketSize,
      { left, top, right, bottom },
    );
  }, [circularLabelDrawIndex, labelTextBudget, props.viewOffset.x, props.viewOffset.y, props.viewZoom, viewport.height, viewport.width]);
  const visibleCircularNodes = useMemo(() => {
    const nodes = new Set<TreeLayoutNode>();
    visibleCircularBranches.forEach(({ node, parent }) => { nodes.add(node); nodes.add(parent); });
    return Array.from(nodes);
  }, [visibleCircularBranches]);
  const columnLabelAngle = endAngle;
  const columnLabelRotation = columnLabelAngle * 180 / Math.PI + 90;
  const moduleBraceAngle = columnLabelAngle;
  const nodeHitRadius = props.size * 0.0062;
  const backgroundStyleRuns = props.treeStyles.backgroundRuns;
  const stripStyleRuns = props.treeStyles.stripRuns;
  const selectedHighlightScope = useMemo(
    () => resolveTreeHighlightScope(props.treeLayoutNodes, props.selectedNodeId),
    [props.selectedNodeId, props.treeLayoutNodes],
  );
  const deletionHighlightScopes = useMemo(
    () => Array.from(props.deletionPreviewNodeIds, (nodeId) => resolveTreeHighlightScope(props.treeLayoutNodes, nodeId)),
    [props.deletionPreviewNodeIds, props.treeLayoutNodes],
  );
  const heatmapCells = props.renderSnapshot.cells;
  const rootChildRadii = props.treeLayoutNodes
    .filter((node) => node.parent === rootNode.id)
    .map((node) => radiusByNodeId.get(node.id) ?? 0)
    .filter((radius) => radius > 0);
  const rootForkRadius = rootChildRadii.length
    ? clamp(Math.min(...rootChildRadii) * 0.22, 4, Math.min(18, Math.min(...rootChildRadii) * 0.45))
    : 8;
  const circularScenePlan = useMemo<FigureScenePlan>(() => createScenePlan<FigureSceneGeometry>({
    mode: "circular",
    rootAnchor: { x: cx, y: cy },
    bounds: { focus: props.presentationGeometry.displayBounds, content: props.presentationGeometry.displayBounds, export: props.presentationGeometry.exportBounds },
    partitions: { root: 0, treeContent: props.presentationGeometry.treeOuterRadius, stripContent: Math.max(0, stripOuterRadius - stripInnerRadius), heatmapContent: Math.max(0, heatmapOuterRadius - heatmapInnerRadius), treeToStripGap: ringGap, stripToHeatmapGap: ringGap },
    fonts: {
      branchLabel: { family: "inherit", size: props.branchLabelFontSize, weight: 500 },
      branchLength: { family: "inherit", size: props.branchMetricFontSize, weight: 500 },
      speciesCount: { family: "inherit", size: props.speciesCountFontSize, weight: 500 },
      stripLabel: { family: "inherit", size: props.stripNameFontSize, weight: 500 },
      columnLabel: { family: "inherit", size: props.columnLabelFontSize, weight: 500 },
      moduleLabel: { family: "inherit", size: props.moduleLabelFontSize, weight: 500 },
    },
    layers: {
      background: [],
      tree: props.treeLayoutNodes.map((node) => ({ id: `tree:${node.id}`, kind: node.kind, layer: "tree" as const, bounds: { left: 0, top: 0, right: props.size, bottom: props.size }, payload: node })),
      taxonomy: stripGroups.map((group, index) => ({ id: `taxonomy:${index}`, kind: "taxonomy-group", layer: "taxonomy" as const, bounds: { left: 0, top: 0, right: props.size, bottom: props.size }, payload: group })),
      heatmap: props.renderSnapshot.cells.map((cell) => ({ id: cell.key, kind: "heatmap-cell", layer: "heatmap" as const, bounds: { left: 0, top: 0, right: props.size, bottom: props.size }, payload: cell })),
      labels: [], overlayBase: [],
    },
    hitIndex: {
      resolve: (point) => {
        const target = resolveTarget(point.x, point.y);
        if (!target) return null;
        const key = target.kind === "cell" || target.kind === "column" ? target.key : `${target.kind}:${target.nodeId}`;
        return { kind: target.kind, key, bounds: { left: point.x, top: point.y, right: point.x, bottom: point.y }, payload: target };
      },
    },
    semantic: [props.renderSnapshot.revision, props.visibleRows.length, props.columns.map(normalizeColumnKey)],
    layout: [cx, cy, props.presentationGeometry.radialLayout, props.columns, props.branchScale, props.circularArcDegrees, props.circularRotationDegrees],
    frame: [props.viewZoom, props.viewOffset.x, props.viewOffset.y],
    revision: { semantic: props.visibleRows.length, layout: Math.round(heatmapOuterRadius), frame: Math.round(props.viewZoom * 1000) },
    geometry: {
      mode: "circular",
      size: props.presentationGeometry.size,
      fitOuterRadius: props.presentationGeometry.fitOuterRadius,
      exportOuterRadius: props.presentationGeometry.exportOuterRadius,
      displayBounds: props.presentationGeometry.displayBounds,
      exportBounds: props.presentationGeometry.exportBounds,
      cx,
      cy,
      rootX,
      angleByTreeNodeId,
      angleByLayoutNodeId,
      spanByNodeId,
      radiusByNodeId,
      angular: circularAngularLayout,
      ringLayouts,
      radialLayout,
      stripGroups,
      visibleBranches: Array.from(new Set(Array.from(branchDrawBuckets.values()).flat())),
      visibleLabels: circularLabelDrawIndex.items,
      startAngle,
      endAngle,
      leafStep,
      treeOuterRadius,
      labelRadius,
      labelOuterRadius,
      stripInnerRadius,
      stripOuterRadius,
      stripLabelRingInnerRadius,
      stripLabelRingOuterRadius,
      stripLabelRadius,
      speciesInnerRadius,
      speciesOuterRadius,
      heatmapInnerRadius,
      heatmapOuterRadius,
      heatmapRingWidth: props.heatmapRingWidth,
      heatmapRingStride,
      rootForkRadius,
      columnLabelAngle,
      columnLabelRotation,
      moduleBraceAngle,
      maxColumnLabelWidth,
      activeStripRank: props.activeStripRank,
      showStrip: props.showStrip,
      showStripLabels: props.showStripLabels,
      taxonDisplayStyle: props.taxonDisplayStyle,
      taxonNameDisplayMode: props.taxonNameDisplayMode,
      showSpeciesLayer: props.showSpeciesLayer,
      showSpeciesCount: props.showSpeciesCount,
      showBranchLabels: props.showBranchLabels,
      showBranchGuides: props.showBranchGuides,
      showBranchLengths: props.showBranchLengths,
      showInternalNodes: props.showInternalNodes,
      showHeatmapNumbers: props.showHeatmapNumbers,
      showModuleNames: props.showModuleNames,
      showModuleFullName: props.showModuleFullName,
      branchScale: props.branchScale,
      branchStrokeWidth: props.branchStrokeWidth,
      branchLabelFontSize: props.branchLabelFontSize,
      branchMetricFontSize: props.branchMetricFontSize,
      columnLabelFontSize: props.columnLabelFontSize,
      moduleLabelFontSize: props.moduleLabelFontSize,
      speciesCountFontSize: props.speciesCountFontSize,
      stripNameFontSize: props.stripNameFontSize,
      heatmapValueFontSize: props.heatmapValueFontSize,
      heatmapMarkerSize: props.heatmapMarkerSize,
      heatmapCellHalfStep: leafStep * 0.5,
      heatmapSectorHalfStep,
      treeStyles: props.treeStyles,
      renderSnapshot: props.renderSnapshot,
      treeLayoutNodes: props.treeLayoutNodes,
      visibleRows: props.visibleRows,
      columns: props.columns,
      moduleQuery: props.moduleQuery,
    },
  }), [angleByLayoutNodeId, angleByTreeNodeId, circularAngularLayout, columnLabelAngle, columnLabelRotation, cx, cy, endAngle, heatmapInnerRadius, heatmapOuterRadius, heatmapRingStride, heatmapSectorHalfStep, labelOuterRadius, labelRadius, leafStep, maxColumnLabelWidth, moduleBraceAngle, nodeHitRadius, props.activeStripRank, props.branchLabelFontSize, props.branchMetricFontSize, props.branchScale, props.branchStrokeWidth, props.circularArcDegrees, props.circularRotationDegrees, props.columnLabelFontSize, props.columns, props.heatmapMarkerSize, props.heatmapRingWidth, props.heatmapValueFontSize, props.moduleLabelFontSize, props.moduleQuery, props.presentationGeometry, props.renderSnapshot, props.showBranchGuides, props.showBranchLabels, props.showBranchLengths, props.showHeatmapNumbers, props.showInternalNodes, props.showModuleFullName, props.showModuleNames, props.showSpeciesCount, props.showSpeciesLayer, props.showStrip, props.showStripLabels, props.size, props.speciesCountFontSize, props.stripNameFontSize, props.taxonDisplayStyle, props.taxonNameDisplayMode, props.treeLayoutNodes, props.treeStyles, props.viewOffset.x, props.viewOffset.y, props.viewZoom, props.visibleRows, radiusByNodeId, radialLayout, ringGap, ringLayouts, rootForkRadius, speciesInnerRadius, speciesOuterRadius, spanByNodeId, startAngle, stripGroups, stripInnerRadius, stripLabelRingInnerRadius, stripLabelRingOuterRadius, stripLabelRadius, stripOuterRadius, treeOuterRadius, branchDrawBuckets, circularLabelDrawIndex.items, rootX, visibleCircularBranches, visibleCircularLabels]);
  useEffect(() => {
    props.onScenePlan?.(circularScenePlan);
  }, [circularScenePlan, props.onScenePlan]);

  const circularCanvasRenderKey = useMemo(() => [
    props.renderSnapshot.revision,
    props.size,
    props.heatmapRingWidth,
    props.heatmapMarkerSize,
    props.showHeatmapNumbers,
    props.heatmapValueFontSize,
    ringLayouts.map((layout) => `${normalizeColumnKey(layout.column)}:${layout.inner}:${layout.outer}`).join("|"),
    heatmapSectorHalfStep,
    props.circularArcDegrees,
    props.circularRotationDegrees,
    props.branchScale,
    props.columns.map((column) => `${normalizeColumnKey(column)}:${column.slotIndex}`).join("|"),
    props.visibleRows.map((row) => row.nodeId).join(","),
  ].join("::"), [
    heatmapSectorHalfStep,
    props.columns,
    props.branchScale,
    props.circularArcDegrees,
    props.circularRotationDegrees,
    props.heatmapMarkerSize,
    props.heatmapRingWidth,
    props.heatmapValueFontSize,
    ringLayouts,
    props.showHeatmapNumbers,
    props.size,
    props.renderSnapshot.revision,
    props.visibleRows,
  ]);
  const circularCanvasInput: CircularCanvasTileInput = {
    cx,
    cy,
    angles: angleByTreeNodeId,
    ringLayouts: ringLayoutByColumnKey,
    heatmapCells,
    heatmapRows: props.renderSnapshot.rows,
    borderEdgesByBoundary: props.circularArcDegrees >= 360
      ? props.renderSnapshot.circularWrappedHeatmapBorderEdgesByBoundary
      : props.renderSnapshot.circularHeatmapBorderEdgesByBoundary,
    heatmapSectorHalfStep,
    heatmapCellHalfStep: leafStep * 0.5,
    heatmapInnerRadius,
    heatmapRingStride,
    heatmapRingWidth: props.heatmapRingWidth,
    markerScale: props.heatmapMarkerSize,
    showNumbers: props.showHeatmapNumbers,
    valueFontSize: props.heatmapValueFontSize,
    viewZoom: props.viewZoom,
    viewOffsetX: props.viewOffset.x,
    viewOffsetY: props.viewOffset.y,
    renderKey: `${circularCanvasRenderKey}:${props.viewZoom}:${props.viewOffset.x}:${props.viewOffset.y}:${viewport.width}:${viewport.height}`,
  };
  const canvasTiles = useMemo(
    () => [{ left: 0, top: 0, width: viewport.width, height: viewport.height }],
    [viewport.height, viewport.width],
  );
  const treeDataRenderKey = useMemo(() => [
    props.size,
    props.circularArcDegrees,
    props.circularRotationDegrees,
    props.branchScale,
    props.branchStrokeWidth,
    props.branchLabelFontSize,
    props.branchMetricFontSize,
    props.speciesCountFontSize,
    props.stripNameFontSize,
    props.columnLabelFontSize,
    props.moduleLabelFontSize,
    props.showBranchLabels,
    props.showBranchGuides,
    props.showBranchLengths,
    props.showInternalNodes,
    props.showSpeciesLayer,
    props.showSpeciesCount,
    props.showStrip,
    props.showStripLabels,
    props.taxonDisplayStyle,
    props.activeStripRank,
    props.renderSnapshot.revision,
    props.columns.map((column) => `${normalizeColumnKey(column)}:${column.slotIndex}:${column.displayLabel}`).join("|"),
    props.moduleQuery?.modules.map((module) => `${module.module_id}:${module.module_name}:${module.column_ids.join(",")}`).join("|") ?? "",
    props.showModuleNames,
    props.showModuleFullName,
    props.activeModuleId,
    props.renderSnapshot.revision,
  ].join("::"), [
    props.activeStripRank,
    props.activeModuleId,
    props.branchLabelFontSize,
    props.branchMetricFontSize,
    props.branchScale,
    props.branchStrokeWidth,
    props.circularArcDegrees,
    props.circularRotationDegrees,
    props.columnLabelFontSize,
    props.moduleLabelFontSize,
    props.columns,
    props.showBranchGuides,
    props.showBranchLabels,
    props.showBranchLengths,
    props.showInternalNodes,
    props.showModuleFullName,
    props.showModuleNames,
    props.showSpeciesCount,
    props.showSpeciesLayer,
    props.showStrip,
    props.showStripLabels,
    props.taxonDisplayStyle,
    props.size,
    props.speciesCountFontSize,
    props.stripNameFontSize,
    props.treeLayoutNodes,
    props.moduleQuery,
    props.renderSnapshot.revision,
    props.visibleRows,
  ]);
  const canvasRenderKey = `${treeDataRenderKey}:${props.viewZoom}:${props.viewOffset.x}:${props.viewOffset.y}:${viewport.width}:${viewport.height}`;
  function drawBranch(context: CanvasRenderingContext2D, parentRadius: number, parentAngle: number, childRadius: number, childAngle: number) {
    const radialEnd = polarPoint(cx, cy, childRadius, childAngle);
    context.beginPath();
    if (parentRadius <= 0.1) {
      const currentRootForkRadius = Math.min(rootForkRadius, Math.max(0, childRadius - 1));
      if (currentRootForkRadius <= 0.1) {
        context.moveTo(cx, cy);
        context.lineTo(radialEnd.x, radialEnd.y);
        return;
      }
      const arcStart = polarPoint(cx, cy, currentRootForkRadius, parentAngle);
      context.moveTo(cx, cy);
      context.lineTo(arcStart.x, arcStart.y);
      context.arc(cx, cy, currentRootForkRadius, parentAngle, childAngle, childAngle < parentAngle);
      context.lineTo(radialEnd.x, radialEnd.y);
      return;
    }
    const arcStart = polarPoint(cx, cy, parentRadius, parentAngle);
    context.moveTo(arcStart.x, arcStart.y);
    context.arc(cx, cy, parentRadius, parentAngle, childAngle, childAngle < parentAngle);
    context.lineTo(radialEnd.x, radialEnd.y);
  }

  function prepareTileCanvas(canvas: HTMLCanvasElement, tile: CanvasTile) {
    const context = canvas.getContext("2d");
    if (!context) return null;
    const backing = resolveCanvasBackingSize({ width: tile.width, height: tile.height }, window.devicePixelRatio || 1);
    const pixelRatio = backing.pixelRatio;
    if (canvas.width !== backing.width) canvas.width = backing.width;
    if (canvas.height !== backing.height) canvas.height = backing.height;
    canvas.style.left = `${tile.left}px`;
    canvas.style.top = `${tile.top}px`;
    canvas.style.width = `${tile.width}px`;
    canvas.style.height = `${tile.height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, tile.width, tile.height);
    context.setTransform(
      pixelRatio * props.viewZoom,
      0,
      0,
      pixelRatio * props.viewZoom,
      pixelRatio * props.viewOffset.x,
      pixelRatio * props.viewOffset.y,
    );
    context.save();
    return context;
  }

  function drawCircularTreeTile(canvas: HTMLCanvasElement, tile: CanvasTile) {
    const context = prepareTileCanvas(canvas, tile);
    if (!context) return;
    {

    backgroundStyleRuns.forEach(({ style, startIndex, endIndex }) => {
      const taxonomyBackground = resolveCircularTaxonomyBackgroundRange(radialLayout);
      const startNode = layoutNodeByNodeId.get(style.nodeId);
      const startX = startNode?.x ?? style.anchorX;
      const inner = style.source === "taxon"
        ? taxonomyBackground.innerRadius
        : Math.max(1, Math.max(0, startX - rootX) * props.branchScale);
      const outer = style.source === "taxon" ? taxonomyBackground.outerRadius : labelOuterRadius;
      if (outer <= inner) return;
      drawCanvasAnnularPath(context, cx, cy, inner, outer, startAngle + startIndex * leafStep, startAngle + (endIndex + 1) * leafStep);
      context.fillStyle = taxonStyleColorCss(style.color, "background");
      context.fill();
    });

    visibleCircularBranches.forEach(({ node, parentAngle, childAngle, parentRadius, childRadius }) => {
      const childPoint = polarPoint(cx, cy, childRadius, childAngle);
      const parentPoint = polarPoint(cx, cy, parentRadius, parentAngle);
      const childScreenX = childPoint.x * props.viewZoom + props.viewOffset.x;
      const childScreenY = childPoint.y * props.viewZoom + props.viewOffset.y;
      const parentScreenX = parentPoint.x * props.viewZoom + props.viewOffset.x;
      const parentScreenY = parentPoint.y * props.viewZoom + props.viewOffset.y;
      const margin = Math.max(12, parentRadius * Math.abs(childAngle - parentAngle) * props.viewZoom);
      if ((childScreenX < -margin && parentScreenX < -margin) || (childScreenX > viewport.width + margin && parentScreenX > viewport.width + margin) || (childScreenY < -margin && parentScreenY < -margin) || (childScreenY > viewport.height + margin && parentScreenY > viewport.height + margin)) return;
      const style = props.treeStyles.branchByNodeId.get(node.nodeId);
      context.save();
      context.strokeStyle = style?.color ?? "#000";
      context.lineWidth = props.branchStrokeWidth;
      context.lineJoin = "round";
      drawBranch(context, parentRadius, parentAngle, childRadius, childAngle);
      context.stroke();
      context.restore();
    });

    if (props.showBranchLengths) {
      visibleCircularBranches.forEach(({ node, childAngle, parentRadius, childRadius }) => {
        if (node.branchLength <= 0) return;
        const radius = parentRadius + (childRadius - parentRadius) * 0.58;
        const basePoint = polarPoint(cx, cy, radius, childAngle);
        const degrees = childAngle * 180 / Math.PI;
        const flip = degrees > 90 || degrees < -90;
        const tangentOffset = flip ? -9 : 9;
        const point = { x: basePoint.x - Math.sin(childAngle) * tangentOffset, y: basePoint.y + Math.cos(childAngle) * tangentOffset };
        drawOutlinedCanvasText(context, formatBranchLength(node.branchLength, 6), point.x, point.y, {
          fontSize: props.branchMetricFontSize,
          weight: RESULT_FONT_WEIGHTS.branchLength,
          align: flip ? "right" : "left",
          rotation: (flip ? degrees + 180 : degrees) * Math.PI / 180,
          strokeWidth: 2.4,
          stroke: "rgba(255,255,255,0.94)",
          fill: "#000",
        });
      });
    }

    if (props.showBranchLabels) {
      visibleCircularLabels.forEach(({ row, node, angle, point: labelPoint }) => {
        const labelStyle = props.treeStyles.labelByNodeId.get(node.nodeId);
        if (props.showBranchGuides) {
          const guideStartRadius = radiusByNodeId.get(node.id) ?? treeOuterRadius;
          const guideStart = polarPoint(cx, cy, guideStartRadius, angle);
          const guideEnd = polarPoint(cx, cy, Math.max(guideStartRadius, labelRadius - 8), angle);
          context.save();
          context.strokeStyle = "#808080";
          context.lineWidth = branchGuideStrokeWidth(props.branchStrokeWidth, false);
          context.setLineDash(branchGuideDashArray(props.branchStrokeWidth, false).split(" ").map(Number));
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(guideStart.x, guideStart.y);
          context.lineTo(guideEnd.x, guideEnd.y);
          context.stroke();
          context.restore();
        }
        const degrees = angle * 180 / Math.PI;
        const flip = degrees > 90 || degrees < -90;
        drawOutlinedCanvasText(context, row.label, labelPoint.x, labelPoint.y, {
          fontSize: props.branchLabelFontSize,
          weight: RESULT_FONT_WEIGHTS.branchLabel,
          align: flip ? "right" : "left",
          rotation: (flip ? degrees + 180 : degrees) * Math.PI / 180,
          strokeWidth: 3,
          stroke: "rgba(255,255,255,0.92)",
          fill: labelStyle?.color ?? "#000",
        });
      });
    }

    if (props.showSpeciesLayer) {
      if (props.showSpeciesCount) {
        props.visibleRows.forEach((row) => {
          const angle = angleByTreeNodeId.get(row.nodeId);
          if (angle === undefined) return;
          const point = polarPoint(cx, cy, (speciesInnerRadius + speciesOuterRadius) / 2, angle);
          drawOutlinedCanvasText(context, String(row.leafCount), point.x, point.y, {
            fontSize: props.speciesCountFontSize,
            weight: RESULT_FONT_WEIGHTS.speciesCount,
            strokeWidth: 2,
            stroke: "rgba(255,255,255,0.88)",
            fill: "#000",
          });
        });
      }
    }

    stripStyleRuns.forEach(({ style, startIndex, endIndex }) => {
      const start = startAngle + startIndex * leafStep;
      const end = startAngle + (endIndex + 1) * leafStep - 0.002;
      drawCanvasAnnularPath(context, cx, cy, stripInnerRadius, stripOuterRadius, start, end);
      context.fillStyle = taxonStyleColorCss(style.color, "strip");
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.76)";
      context.lineWidth = 0.55;
      context.stroke();
    });
    if (showEmbeddedTaxonNames) {
      context.save();
      drawCanvasAnnularPath(context, cx, cy, stripLabelRingInnerRadius, stripLabelRingOuterRadius, startAngle, endAngle);
      context.clip();
      stripGroups.forEach((group) => {
        const midAngle = startAngle + (group.startIndex + group.endIndex + 1) * leafStep / 2;
        const point = polarPoint(cx, cy, stripLabelRadius, midAngle);
        drawOutlinedCanvasText(context, group.label, point.x, point.y, {
          fontSize: props.stripNameFontSize,
          weight: RESULT_FONT_WEIGHTS.taxonLabel,
          strokeWidth: 2.2,
          stroke: "rgba(255,255,255,0.88)",
          fill: "#000",
        });
      });
      context.restore();
    }

    if (props.showInternalNodes) {
      visibleCircularNodes.forEach((node) => {
        if (node.kind !== "internal") return;
        const angle = angleByLayoutNodeId.get(node.id);
        const radius = radiusByNodeId.get(node.id);
        if (angle === undefined || radius === undefined) return;
        const point = polarPoint(cx, cy, radius, angle);
        drawCanvasDiamond(context, point.x, point.y, 10, "#000", "#fff", 1.4);
      });
    }

    ringLayouts.forEach((layout) => {
      if (!layout.column.displayLabel) return;
      const point = polarPoint(cx, cy, layout.outer, columnLabelAngle);
      context.save();
      context.translate(point.x, point.y);
      context.rotate(columnLabelRotation * Math.PI / 180);
      drawOutlinedCanvasText(context, layout.column.displayLabel, 8, layout.width / 2, {
        fontSize: props.columnLabelFontSize,
        weight: RESULT_FONT_WEIGHTS.columnLabel,
        align: "left",
        strokeWidth: 2.5,
        stroke: "rgba(255,255,255,0.88)",
        fill: "#000",
      });
      context.restore();
    });

    if (props.showModuleNames) {
      moduleColumnRanges(props.moduleQuery, props.columns).forEach((module) => {
        const layouts = ringLayouts.filter((layout) => layout.index >= module.start && layout.index <= module.end);
        if (!layouts.length) return;
        const outer = Math.max(...layouts.map((layout) => layout.outer));
        const inner = Math.min(...layouts.map((layout) => layout.inner));
        const anchor = polarPoint(cx, cy, outer, moduleBraceAngle);
        const label = moduleBraceLabel(module.moduleId, module.moduleName, props.showModuleNames, props.showModuleFullName);
        context.save();
        context.translate(anchor.x, anchor.y);
        context.rotate(columnLabelRotation * Math.PI / 180);
        drawOutlinedCanvasText(context, label, maxColumnLabelWidth + 60, Math.max(14, outer - inner) / 2, {
          fontSize: props.moduleLabelFontSize,
          weight: RESULT_FONT_WEIGHTS.moduleLabel,
          rotation: Math.PI / 2,
          strokeWidth: 2.5,
          stroke: "rgba(255,255,255,0.88)",
          fill: "#000",
        });
        context.restore();
      });
    }
      };
    context.restore();
  }

  useEffect(() => {
    canvasTiles.forEach((tile) => {
      const canvas = canvasRefs.current.get(tileKey(tile));
      if (canvas) drawCircularTreeTile(canvas, tile);
    });
  }, [canvasRenderKey, canvasTiles, stripGroups]);

  function drawInteractionOverlay(target: CircularTreeHitTarget) {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const backing = resolveCanvasBackingSize(viewport, window.devicePixelRatio || 1);
    const pixelRatio = backing.pixelRatio;
    if (canvas.width !== backing.width) canvas.width = backing.width;
    if (canvas.height !== backing.height) canvas.height = backing.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.setTransform(
      pixelRatio * props.viewZoom,
      0,
      0,
      pixelRatio * props.viewZoom,
      pixelRatio * props.viewOffset.x,
      pixelRatio * props.viewOffset.y,
    );
    {
    const drawScope = (scope: TreeHighlightScope, fill: string, stroke: string) => {
      const node = scope.directNode ?? scope.terminalNodes[0];
      const span = node ? spanByNodeId.get(node.id) : null;
      if (!node || !span) return;
      const inner = Math.max(1, (radiusByNodeId.get(node.id) ?? 0) - Math.max(4, nodeHitRadius));
      const outer = Math.max(labelOuterRadius, speciesOuterRadius, stripOuterRadius, heatmapOuterRadius) + ringGap;
      drawCanvasAnnularPath(context, cx, cy, inner, outer, startAngle + span.start * leafStep, startAngle + (span.end + 1) * leafStep);
      context.fillStyle = fill;
      context.strokeStyle = stroke;
      context.lineWidth = Math.max(1.4, 2 / Math.max(0.02, props.viewZoom));
      context.fill();
      context.stroke();
      if (node.kind === "internal" && props.showInternalNodes) {
        const angle = angleByLayoutNodeId.get(node.id);
        const radius = radiusByNodeId.get(node.id);
        if (angle !== undefined && radius !== undefined) {
          const point = polarPoint(cx, cy, radius, angle);
          drawCanvasDiamond(context, point.x, point.y, 12.4, stroke, "#000", 2);
        }
      }
    };
    if (props.selectedNodeId !== null) drawScope(selectedHighlightScope, "rgba(208,106,0,0.10)", "rgba(208,106,0,0.70)");
    deletionHighlightScopes.forEach((scope) => drawScope(scope, "rgba(178,58,72,0.10)", "rgba(178,58,72,0.68)"));
    const drawInteractionCell = (cell: ResolvedHeatmapCell, radialOffset: number, selected: boolean) => {
      const angle = angleByTreeNodeId.get(cell.row.nodeId);
      const layout = ringLayoutByColumnKey.get(cell.columnKey);
      if (angle === undefined || !layout) return;
      const inner = layout.inner + radialOffset;
      const outer = layout.outer + radialOffset;
      const halfStep = cell.shape === "fill" ? leafStep * 0.5 : heatmapSectorHalfStep;
      if (cell.shape === "fill") {
        drawCanvasAnnularSector(context, cx, cy, inner, outer, angle - halfStep, angle + halfStep, cell.fill);
        if (selected) strokeCanvasAnnularSector(context, cx, cy, inner, outer, angle - halfStep, angle + halfStep);
      } else {
        const center = (inner + outer) / 2;
        const point = polarPoint(cx, cy, center, angle);
        const arcLength = Math.max(1, center * halfStep * 2);
        const markerSize = clamp(Math.min(outer - inner, arcLength) * props.heatmapMarkerSize, 4, Math.max(outer - inner, arcLength));
        if (cell.shape === "triangle") {
          context.save();
          context.translate(point.x, point.y);
          context.rotate(angle + Math.PI / 2);
          drawCanvasShape(context, cell.shape, -markerSize / 2, -markerSize / 2, markerSize, markerSize, markerSize, cell.fill, selected);
          context.restore();
        } else {
          drawCanvasShape(context, cell.shape, point.x - markerSize / 2, point.y - markerSize / 2, markerSize, markerSize, markerSize, cell.fill, selected);
        }
      }
      if (props.showHeatmapNumbers && radialOffset !== 0) {
        const point = polarPoint(cx, cy, (inner + outer) / 2, angle);
        drawCanvasText(context, cell.label, point.x, point.y, props.heatmapValueFontSize, cell.fill);
      }
    };
    const interactionCells = resolveHeatmapInteractionCells(
      props.renderSnapshot,
      props.selectedCellKeys,
      props.columnDragDraft?.value ?? null,
    );
    interactionCells.selected.forEach((cell) => drawInteractionCell(cell, 0, true));
    if (props.columnDragDraft) {
      const centerScreenX = cx * props.viewZoom + props.viewOffset.x;
      const centerScreenY = cy * props.viewZoom + props.viewOffset.y;
      const radialOffset = (Math.hypot(props.columnDragDraft.currentX - centerScreenX, props.columnDragDraft.currentY - centerScreenY)
        - Math.hypot(props.columnDragDraft.startX - centerScreenX, props.columnDragDraft.startY - centerScreenY)) / props.viewZoom;
      interactionCells.draggedColumn.forEach((cell) => {
        const angle = angleByTreeNodeId.get(cell.row.nodeId);
        const layout = ringLayoutByColumnKey.get(cell.columnKey);
        if (angle !== undefined && layout) {
          drawCanvasAnnularSector(context, cx, cy, layout.inner, layout.outer, angle - leafStep * 0.5, angle + leafStep * 0.5, "#fff");
        }
        drawInteractionCell(cell, radialOffset, props.selectedCellKeys.has(cell.key));
      });
    }
    if (!target) return;
    context.fillStyle = "rgba(17,17,17,0.055)";
    context.strokeStyle = "rgba(17,17,17,0.14)";
    context.lineWidth = Math.max(1, 1 / Math.max(0.02, props.viewZoom));

    if (target.kind === "column") {
      const layout = ringLayoutByColumnKey.get(target.key);
      if (!layout) return;
      drawCanvasAnnularPath(context, cx, cy, layout.inner, layout.outer, startAngle, endAngle);
      context.fill();
      context.stroke();
      return;
    }
    if (target.kind === "cell") {
      const angle = angleByTreeNodeId.get(target.row.nodeId);
      const layout = ringLayoutByColumnKey.get(normalizeColumnKey(target.column));
      if (angle === undefined || !layout) return;
      drawCanvasAnnularPath(context, cx, cy, layout.inner, layout.outer, angle - sectorHalfStep, angle + sectorHalfStep);
      context.fill();
      context.stroke();
      return;
    }

    const node = layoutNodeByNodeId.get(target.nodeId);
    const span = node ? spanByNodeId.get(node.id) : null;
    if (!node || !span) return;
    const inner = resolveCircularHoverInnerRadius(radiusByNodeId.get(node.id) ?? 0, nodeHitRadius);
    const outer = resolveCircularHoverOuterRadius({ labelOuterRadius, speciesOuterRadius, stripOuterRadius, heatmapOuterRadius, ringGap });
    const start = startAngle + span.start * leafStep - leafStep * 0.05;
    const end = startAngle + (span.end + 1) * leafStep + leafStep * 0.05;
    drawCanvasAnnularPath(context, cx, cy, inner, outer, start, end);
    context.fill();
    context.stroke();
    if (node.kind === "internal" && props.showInternalNodes) {
      const angle = angleByLayoutNodeId.get(node.id);
      const radius = radiusByNodeId.get(node.id);
      if (angle !== undefined && radius !== undefined) {
        const point = polarPoint(cx, cy, radius, angle);
        drawCanvasDiamond(context, point.x, point.y, 12.4, "#000", "#000", 2);
      }
    }
      };
  }

  useEffect(() => {
    drawInteractionOverlay(null);
  }, [circularScene, deletionHighlightScopes, heatmapSectorHalfStep, props.columnDragDraft, props.heatmapMarkerSize, props.heatmapValueFontSize, props.renderSnapshot, props.selectedCellKeys, props.selectedNodeId, props.showHeatmapNumbers, props.viewOffset.x, props.viewOffset.y, props.viewZoom, ringLayouts, selectedHighlightScope, viewport.height, viewport.width]);

  useEffect(() => () => {
    if (hoverFrameRef.current !== null) window.cancelAnimationFrame(hoverFrameRef.current);
  }, []);

  function pointFromEvent(event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - props.viewOffset.x) / props.viewZoom,
      y: (event.clientY - rect.top - props.viewOffset.y) / props.viewZoom,
    };
  }

  function circularHeatmapCellAtPoint(localX: number, localY: number) {
    const hit = hitCircularCell({
      x: localX,
      y: localY,
      cx,
      cy,
      startAngle,
      availableArc,
      terminalCount: props.visibleRows.length,
      heatmapInnerRadius,
      ringStride: heatmapRingStride,
      ringCount: ringLayouts.length,
    });
    if (!hit) return null;
    const row = props.visibleRows[hit.rowIndex];
    if (!row) return null;
    const column = columnBySlotIndex.get(hit.ringIndex);
    if (!column) return null;
    const key = rowCellKey(row, column);
    const count = props.renderSnapshot.cellByKey.get(key)?.count ?? 0;
    return { key, row, column, count };
  }

  function resolveTarget(localX: number, localY: number): CircularTreeHitTarget {
    const radius = Math.hypot(localX - cx, localY - cy);
    const rawAngle = Math.atan2(localY - cy, localX - cx);
    const angle = normalizeAngleFrom(rawAngle, startAngle);
    const angleOffset = angle - startAngle;
    const rowIndex = Math.floor(angleOffset / leafStep);
    for (const layout of ringLayouts) {
      const point = polarPoint(cx, cy, layout.outer, columnLabelAngle);
      const rotation = -columnLabelRotation * Math.PI / 180;
      const dx = localX - point.x;
      const dy = localY - point.y;
      const localLabelX = dx * Math.cos(rotation) - dy * Math.sin(rotation);
      const localLabelY = dx * Math.sin(rotation) + dy * Math.cos(rotation);
      if (localLabelX >= 0 && localLabelX <= maxColumnLabelWidth && localLabelY >= -4 && localLabelY <= layout.width + 6) {
        return { kind: "column", column: layout.column, index: layout.index, key: normalizeColumnKey(layout.column) };
      }
    }
    const cell = circularHeatmapCellAtPoint(localX, localY);
    if (cell) return { kind: "cell", ...cell };
    if (stripStyleRuns.length && radius >= stripInnerRadius && radius <= stripOuterRadius && angleOffset >= 0 && angleOffset <= availableArc) {
      const run = [...stripStyleRuns].reverse().find((item) => rowIndex >= item.startIndex && rowIndex <= item.endIndex);
      if (run) return { kind: "strip", nodeId: run.style.nodeId, label: run.style.name };
    }
    if (props.showSpeciesLayer && radius >= speciesInnerRadius && radius <= speciesOuterRadius && angleOffset >= 0 && angleOffset <= availableArc) {
      const row = props.visibleRows[rowIndex];
      if (row) return { kind: "species", nodeId: row.nodeId, row };
    }
    const bucketX = Math.floor(localX / hitBucketSize);
    const bucketY = Math.floor(localY / hitBucketSize);
    const nodeCandidates: Array<{ value: TreeLayoutNode; point: ScenePoint; hitRadius: number }> = [];
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const candidates = nodeHitBuckets.get(`${bucketX + xOffset}:${bucketY + yOffset}`) ?? [];
        for (const candidate of candidates) {
          if (candidate.node.kind === "internal" && !props.showInternalNodes) continue;
          const hitRadius = circularNodeHitRadius(candidate.node, props.viewZoom, nodeHitRadius);
          nodeCandidates.push({ value: candidate.node, point: candidate.point, hitRadius });
        }
      }
    }
    const nearestNode = nearestCircularNode(nodeCandidates, { x: localX, y: localY });
    if (nearestNode) return { kind: "node", nodeId: nearestNode.nodeId, treeNode: nearestNode };
    if (props.showBranchLabels && angleOffset >= 0 && angleOffset <= availableArc) {
      const row = props.visibleRows[rowIndex];
      const treeNode = row ? terminalNodeByNodeId.get(row.nodeId) : null;
      const terminalRadius = treeNode ? radiusByNodeId.get(treeNode.id) : undefined;
      if (row && treeNode && terminalRadius !== undefined && radius >= Math.max(0, terminalRadius - 10) && radius <= labelOuterRadius + 14) {
        return { kind: "label", nodeId: row.nodeId, treeNode };
      }
    }
    const branchRow = props.visibleRows[rowIndex];
    let branchNode = branchRow ? terminalNodeByNodeId.get(branchRow.nodeId) ?? null : null;
    const pointer = { x: localX, y: localY };
    const branchTolerance = Math.max(5, 7 / Math.max(0.7, props.viewZoom));
    while (branchNode?.parent !== null && branchNode?.parent !== undefined) {
      const parent = nodeById.get(branchNode.parent);
      if (!parent) break;
      const childAngle = angleByLayoutNodeId.get(branchNode.id);
      const parentAngle = angleByLayoutNodeId.get(parent.id);
      const childRadius = radiusByNodeId.get(branchNode.id);
      const parentRadius = radiusByNodeId.get(parent.id);
      if (childAngle !== undefined && parentAngle !== undefined && childRadius !== undefined && parentRadius !== undefined) {
        const radialStart = polarPoint(cx, cy, parentRadius, childAngle);
        const radialEnd = polarPoint(cx, cy, childRadius, childAngle);
        const pointerAngle = Math.atan2(localY - cy, localX - cx);
        const owner = resolveBranchHitOwner(parent, branchNode, {
          parentDistance: angleFallsOnArc(pointerAngle, parentAngle, childAngle) ? Math.abs(radius - parentRadius) : Number.POSITIVE_INFINITY,
          childDistance: distanceToSegment(pointer, radialStart, radialEnd),
          childProgress: progressAlongSegment(pointer, radialStart, radialEnd),
          tolerance: branchTolerance,
        });
        if (owner) {
          return { kind: "branch", nodeId: owner.nodeId, treeNode: owner };
        }
      }
      branchNode = parent;
    }
    return null;
  }

  function nodeIdForTarget(target: CircularTreeHitTarget) {
    if (!target || target.kind === "cell" || target.kind === "column") return null;
    return target.nodeId;
  }

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const point = pointFromEvent(event);
    const target = circularScenePlan.hitIndex.resolve(point)?.payload as CircularTreeHitTarget;
    event.currentTarget.style.cursor = target ? "pointer" : "default";
    const hoverKey = target
      ? target.kind === "column"
        ? `column:${target.key}`
        : target.kind === "cell"
          ? `cell:${target.key}`
          : `${target.kind}:${target.nodeId}`
      : "";
    const hoverChanged = hoverKey !== lastHoverKeyRef.current;
    if (hoverChanged) {
      lastHoverKeyRef.current = hoverKey;
      pendingHoverTargetRef.current = target;
      props.onHoverSource(nodeIdForTarget(target));
      props.onHoverCellKey(target?.kind === "cell" ? target.key : null);
      props.onHoverColumnKey(target?.kind === "column" ? target.key : null);
      if (hoverFrameRef.current === null) {
        hoverFrameRef.current = window.requestAnimationFrame(() => {
          hoverFrameRef.current = null;
          drawInteractionOverlay(pendingHoverTargetRef.current);
        });
      }
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (hoverChanged) {
      setTooltip(target?.kind === "strip"
        ? { label: target.label, x, y }
        : target?.kind === "node" || target?.kind === "label"
          ? namedNodeTooltip(target.treeNode as RenderTreeNode, x, y)
          : null);
    } else if (tooltipRef.current) {
      tooltipRef.current.style.left = `${Math.max(20, Math.min(viewport.width - 450, x))}px`;
      tooltipRef.current.style.top = `${Math.max(20, Math.min(viewport.height - 85, y))}px`;
    }
  }

  function handleMouseLeave(event: ReactMouseEvent<HTMLDivElement>) {
    event.currentTarget.style.cursor = "default";
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    lastHoverKeyRef.current = "";
    pendingHoverTargetRef.current = null;
    drawInteractionOverlay(null);
    props.onHoverSource(null);
    props.onHoverCellKey(null);
    props.onHoverColumnKey(null);
    setTooltip(null);
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const point = pointFromEvent(event);
    const target = circularScenePlan.hitIndex.resolve(point)?.payload as CircularTreeHitTarget;
    if (!target) return;
    event.stopPropagation();
    if (target.kind === "cell") {
      if (shouldHandleHeatmapCellClick({ isStyleSelecting: Boolean(props.selectionMode), ctrlKey: event.ctrlKey })) {
        props.onToggleCell(target.row, target.column, target.count);
      }
    } else if (target.kind === "column") props.onColumnPrimaryAction(target.column);
    else if (target.kind === "strip") props.onOpenNode(target.nodeId, "internal", event as unknown as ReactMouseEvent<SVGElement>);
    else if (target.kind === "species") {
      const node = terminalNodeByNodeId.get(target.nodeId);
      if (node) props.onOpenNode(node.nodeId, node.kind, event as unknown as ReactMouseEvent<SVGElement>);
    } else props.onOpenNode(target.treeNode.nodeId, target.treeNode.kind, event as unknown as ReactMouseEvent<SVGElement>);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (props.selectionMode) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const point = pointFromEvent(event);
    const target = circularScenePlan.hitIndex.resolve(point)?.payload as CircularTreeHitTarget;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.kind === "cell") props.onCellMenu(event as unknown as ReactMouseEvent<SVGGraphicsElement>, target.key);
    else if (target.kind === "column") props.onColumnMenu(event as unknown as ReactMouseEvent<SVGGraphicsElement>, target.column, target.index);
    else if (target.kind === "node" || target.kind === "branch" || target.kind === "label") props.onOpenNode(target.treeNode.nodeId, target.treeNode.kind, event as unknown as ReactMouseEvent<SVGElement>);
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const point = pointFromEvent(event);
    const target = circularScenePlan.hitIndex.resolve(point)?.payload as CircularTreeHitTarget;
    if (target?.kind === "column") props.onColumnDrag(event as unknown as ReactMouseEvent<SVGGraphicsElement>, target.column);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const point = pointFromEvent(event);
    const target = circularScenePlan.hitIndex.resolve(point)?.payload as CircularTreeHitTarget;
    if (shouldCaptureCircularPointer(target?.kind)) event.stopPropagation();
  }

  return (
    <div ref={stageRef} className="circular-tree-stage circular-tree-viewport-stage">
      <CircularHeatmapCanvas viewport={viewport} input={circularCanvasInput} />
      {canvasTiles.map((tile) => (
        <canvas
          key={`circular-tree-canvas-${tileKey(tile)}`}
          ref={(canvas) => {
            if (canvas) canvasRefs.current.set(tileKey(tile), canvas);
            else canvasRefs.current.delete(tileKey(tile));
          }}
          className="circular-tree-canvas"
          style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }}
          aria-hidden="true"
        />
      ))}
      <canvas ref={overlayCanvasRef} className="circular-tree-overlay-canvas" aria-hidden="true" />
      <div
        className="circular-tree-event-surface"
        style={{ width: viewport.width, height: viewport.height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
      />
      {tooltip ? <div ref={tooltipRef} className="canvas-node-tooltip" role="tooltip" style={{ left: Math.max(20, Math.min(viewport.width - 450, tooltip.x)), top: Math.max(20, Math.min(viewport.height - 85, tooltip.y)) }}>{tooltip.label}</div> : null}
    </div>
  );
}

export function HeatmapSvg(props: HeatmapSvgProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const viewer = containerRef.current?.closest(".viewer-scroll");
    if (!(viewer instanceof HTMLElement)) return;
    const update = () => {
      const rect = viewer.getBoundingClientRect();
      setViewport({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);
  const labelBoxHeight = Math.max(24, props.columnLabelFontSize + 10);
  const labelBoxY = -props.columnLabelFontSize - 8;
  const labelTextY = -6;
  const maxColumnLabelWidth = props.columns.reduce((max, column) => isHeatmapDisplayColumn(column) && column.displayLabel ? Math.max(max, columnLabelWidth(column.displayLabel, props.columnLabelFontSize)) : max, 0);
  const columnLabelProjection = rectangularColumnLabelProjection(maxColumnLabelWidth);
  const moduleLabelWidth = props.moduleQuery && props.showModuleNames
    ? props.moduleQuery.modules.reduce((max, module) => Math.max(max, columnLabelWidth(moduleBraceLabel(module.module_id, module.module_name, props.showModuleNames, props.showModuleFullName), props.moduleLabelFontSize)), 0)
    : 0;
  const moduleHeaderLayout = rectangularModuleHeaderLayout(props.moduleLabelFontSize);
  const columnSlotSpan = heatmapSlotSpan(props.columns);
  const heatmapCells = props.renderSnapshot.cells;
  const terminalBandByRowId = useMemo(() => new Map(props.terminalBands.map((band) => [band.rowId, band])), [props.terminalBands]);
  const columnByKey = useMemo(() => {
    const map = new Map<string, DisplayColumn>();
    props.columns.forEach((column) => {
      const key = normalizeColumnKey(column);
      if (!map.has(key)) map.set(key, column);
    });
    return map;
  }, [props.columns]);
  const hoveredHeatmapCell = useMemo(
    () => heatmapCells.find((cell) => cell.key === props.hoveredCellKey) ?? null,
    [heatmapCells, props.hoveredCellKey],
  );
  const width = Math.max(
    260,
    columnSlotSpan * props.heatmapColumnWidth + 80 + columnLabelProjection.width,
    columnSlotSpan * props.heatmapColumnWidth + 40 + moduleLabelWidth,
  );
  const moduleRanges = moduleColumnRanges(props.moduleQuery, props.columns);
  const bodyHeight = Math.max(1, props.height - props.headerHeight);
  // Counter-project the viewport Canvas inside the transformed world container.
  const canvasTiles = useMemo(() => [resolveCounterProjectedCanvas(
    viewport,
    { zoom: props.viewZoom, offsetX: props.viewOffset.x, offsetY: props.viewOffset.y },
    { x: props.worldLeft, y: 0 },
  )], [props.viewOffset.x, props.viewOffset.y, props.viewZoom, props.worldLeft, viewport]);
  const canvasInput: RectangularCanvasTileInput = {
    headerHeight: props.headerHeight,
    heatmapColumnWidth: props.heatmapColumnWidth,
    rowHeight: props.rowHeight,
    cellSize: props.cellSize,
    valueFontSize: props.valueFontSize,
    showNumbers: props.showNumbers,
    terminalBands: props.terminalBands,
    heatmapCells,
    heatmapCellsByRowId: props.renderSnapshot.cellsByRowId,
    heatmapRows: props.renderSnapshot.rows,
    borderEdgesByBoundary: props.renderSnapshot.rectangularHeatmapBorderEdgesByBoundary,
    viewZoom: props.viewZoom,
    renderRevision: props.renderSnapshot.revision,
    backingWidth: viewport.width,
    backingHeight: viewport.height,
    projectionScale: props.viewZoom,
  };
  return (
    <div ref={containerRef} className="heatmap-svg" style={{ width, height: props.height }}>
      {canvasTiles.map((tile) => <RectangularHeatmapCanvasTile
        key="rectangular-heatmap-viewport"
        tile={tile}
        input={canvasInput}
        interaction={{ renderSnapshot: props.renderSnapshot, selectedCellKeys: props.selectedCellKeys, columnDragDraft: props.columnDragDraft }}
      />)}
      <svg className="heatmap-overlay-svg" width={width} height={props.height}>
        {props.moduleQuery && props.showModuleNames ? (
        <g transform="translate(20, 0)">
          {moduleRanges.map((module) => {
            const x = module.start * props.heatmapColumnWidth;
            const bandWidth = (module.end - module.start + 1) * props.heatmapColumnWidth;
            const active = props.activeModuleId === module.moduleId;
            return (
              <g key={module.moduleId}>
                <text
                  className={active ? "module-brace-label active" : "module-brace-label"}
                  x={x + bandWidth / 2}
                  y={moduleHeaderLayout.labelBaseline}
                  textAnchor="middle"
                  style={{ fontSize: props.moduleLabelFontSize }}
                >
                  {moduleBraceLabel(module.moduleId, module.moduleName, props.showModuleNames, props.showModuleFullName)}
                </text>
                <path
                  className={active ? "module-brace active" : "module-brace"}
                  d={moduleBracePath(x, bandWidth, moduleHeaderLayout.braceTop, moduleHeaderLayout.braceBottom)}
                />
              </g>
            );
          })}
        </g>
      ) : null}
        <g transform={`translate(20, ${props.headerHeight - 12})`}>
        {props.columns.map((column) => {
          const x = column.slotIndex * props.heatmapColumnWidth + props.heatmapColumnWidth / 2;
          const columnKey = normalizeColumnKey(column);
          const dragOffset = props.columnDragDraft?.value === columnKey ? (props.columnDragDraft.currentX - props.columnDragDraft.startX) / props.viewZoom : 0;
          const labelWidth = column.displayLabel ? columnLabelWidth(column.displayLabel, props.columnLabelFontSize) : 0;
          return (
            <g key={normalizeColumnKey(column)} className={["column-header", props.columnDragDraft?.value === columnKey ? "dragging" : "", props.hoveredColumnKey === columnKey ? "hovered" : ""].filter(Boolean).join(" ")} transform={`translate(${x + dragOffset}, 0) rotate(${RECT_COLUMN_LABEL_ROTATION})`}>
              <rect
                className="column-label-box column-label-hit"
                data-column-key={columnKey}
                x={-6}
                y={labelBoxY}
                width={labelWidth}
                height={labelBoxHeight}
                rx={5}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onColumnPrimaryAction(column);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onColumnMenu(event, column, column.slotIndex);
                }}
                onMouseDown={(event) => props.onColumnDrag(event, column)}
              />
              {column.displayLabel ? <text className="column-label" x={5} y={labelTextY} style={{ fontSize: props.columnLabelFontSize }}>{column.displayLabel}</text> : null}
            </g>
          );
        })}
      </g>
        <g transform={`translate(20, ${props.headerHeight})`}>
        {props.hoveredColumnKey ? (() => {
          const column = columnByKey.get(props.hoveredColumnKey);
          return column ? <rect x={column.slotIndex * props.heatmapColumnWidth} y={0} width={props.heatmapColumnWidth} height={bodyHeight} fill="rgba(17,17,17,0.055)" stroke="rgba(17,17,17,0.14)" strokeWidth={1} pointerEvents="none" /> : null;
        })() : null}
        {hoveredHeatmapCell ? (() => {
          const band = terminalBandByRowId.get(hoveredHeatmapCell.row.id);
          return <rect x={hoveredHeatmapCell.column.slotIndex * props.heatmapColumnWidth + 1.5} y={(band?.top ?? hoveredHeatmapCell.row.y) + 1.5} width={Math.max(1, props.heatmapColumnWidth - 3)} height={Math.max(1, props.rowHeight - 3)} fill="rgba(17,17,17,0.055)" stroke="rgba(17,17,17,0.14)" strokeWidth={1} pointerEvents="none" />;
        })() : null}
        <rect
          className="heatmap-body-hit-layer"
          x={0}
          y={0}
          width={Math.max(1, width - 20)}
          height={bodyHeight}
          onClick={props.onHeatmapBodyClick}
          onContextMenu={props.onHeatmapBodyMenu}
          onMouseMove={props.onHeatmapBodyMove}
          onMouseLeave={props.onHeatmapBodyLeave}
        />
      </g>
      </svg>
    </div>
  );
}
