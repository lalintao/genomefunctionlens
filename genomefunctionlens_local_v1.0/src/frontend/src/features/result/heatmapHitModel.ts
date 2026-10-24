import type { SearchColumn } from "../../types";
import type { DisplayColumn, ScreenRect, TerminalBand, VisibleRow } from "./resultTypes";
import { normalizeColumnKey, rowCellKey } from "./resultVisualUtils";

interface HeatmapGeometry {
  heatmapColumnWidth: number;
  rowHeight: number;
  terminalBands: TerminalBand[];
  heatmapLeftOffset?: number;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function localSelectionRect(selectionRect: ScreenRect, heatmapBodyRect: ScreenRect, viewZoom: number): ScreenRect {
  return {
    left: Math.max(0, (selectionRect.left - heatmapBodyRect.left) / viewZoom),
    right: Math.max(0, (selectionRect.right - heatmapBodyRect.left) / viewZoom),
    top: Math.max(0, (selectionRect.top - heatmapBodyRect.top) / viewZoom),
    bottom: Math.max(0, (selectionRect.bottom - heatmapBodyRect.top) / viewZoom),
  };
}

function bandByRowId(terminalBands: TerminalBand[]) {
  return new Map(terminalBands.map((band) => [band.rowId, band]));
}

export function hitHeatmapCellKeysInRect(input: {
  selectionRect: ScreenRect;
  heatmapBodyRect: ScreenRect;
  viewZoom: number;
  visibleRows: VisibleRow[];
  columns: DisplayColumn[];
  rowCounts: Map<string, number>;
  geometry: HeatmapGeometry;
}) {
  const heatmapLeftOffset = input.geometry.heatmapLeftOffset ?? 0;
  const localRect = localSelectionRect(input.selectionRect, input.heatmapBodyRect, input.viewZoom);
  localRect.left = Math.max(0, localRect.left - heatmapLeftOffset);
  localRect.right = Math.max(0, localRect.right - heatmapLeftOffset);
  const bands = bandByRowId(input.geometry.terminalBands);
  const hitKeys: string[] = [];
  const firstSlot = Math.max(0, Math.floor(localRect.left / input.geometry.heatmapColumnWidth));
  const lastSlot = Math.max(firstSlot, Math.ceil(localRect.right / input.geometry.heatmapColumnWidth) - 1);
  const candidateColumns = input.columns.filter((column) => column.slotIndex >= firstSlot && column.slotIndex <= lastSlot);
  if (!candidateColumns.length) return hitKeys;

  input.visibleRows.forEach((row) => {
    const band = bands.get(row.id);
    const rowTop = band?.top ?? row.y;
    const rowBottom = rowTop + (band?.height ?? input.geometry.rowHeight);
    if (!rangesOverlap(rowTop, rowBottom, localRect.top, localRect.bottom)) return;

    candidateColumns.forEach((column) => {
      const columnLeft = column.slotIndex * input.geometry.heatmapColumnWidth;
      const columnRight = columnLeft + input.geometry.heatmapColumnWidth;
      if (!rangesOverlap(columnLeft, columnRight, localRect.left, localRect.right)) return;

      const key = rowCellKey(row, column);
      hitKeys.push(key);
    });
  });

  return hitKeys;
}

export function hitHeatmapCellKeyAtPoint(input: {
  clientX: number;
  clientY: number;
  heatmapBodyRect: ScreenRect;
  viewZoom: number;
  visibleRows: VisibleRow[];
  columns: DisplayColumn[];
  rowCounts: Map<string, number>;
  geometry: HeatmapGeometry;
}) {
  const localX = (input.clientX - input.heatmapBodyRect.left) / input.viewZoom;
  const heatmapLeftOffset = input.geometry.heatmapLeftOffset ?? 0;
  const localY = (input.clientY - input.heatmapBodyRect.top) / input.viewZoom;
  const heatmapX = localX - heatmapLeftOffset;
  if (heatmapX < 0 || localY < 0) return null;

  const bands = bandByRowId(input.geometry.terminalBands);
  const row = input.visibleRows.find((item) => {
    const band = bands.get(item.id);
    const rowTop = band?.top ?? item.y;
    const rowBottom = rowTop + (band?.height ?? input.geometry.rowHeight);
    return localY >= rowTop && localY <= rowBottom;
  });
  if (!row) return null;

  const slotIndex = Math.floor(heatmapX / input.geometry.heatmapColumnWidth);
  const column = input.columns.find((item) => item.slotIndex === slotIndex);
  if (!column) return null;

  const key = rowCellKey(row, column);
  return key;
}

/**
 * Expands row and column range gestures into cells. A cell remains selectable
 * even when its aggregate count is zero: selection defines style coverage,
 * not just currently visible values.
 */
export function heatmapCellKeysForRows(rows: readonly VisibleRow[], columns: readonly SearchColumn[]) {
  return rows.flatMap((row) => columns.map((column) => rowCellKey(row, column)));
}

export function columnByKey(columns: SearchColumn[]) {
  return new Map(columns.map((column) => [normalizeColumnKey(column), column]));
}
