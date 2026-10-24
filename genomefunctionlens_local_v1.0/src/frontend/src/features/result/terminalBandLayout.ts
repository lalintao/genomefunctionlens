import type { TerminalBand, VisibleRow } from "./resultTypes";

export function buildTerminalBands(rows: VisibleRow[], rowHeight: number): TerminalBand[] {
  return rows.map((row, index) => ({
    rowId: row.id,
    nodeId: row.nodeId,
    index,
    top: row.y,
    center: row.y + rowHeight / 2,
    bottom: row.y + rowHeight,
    height: rowHeight,
  }));
}
