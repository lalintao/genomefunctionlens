import type { HeatmapBorderMode } from "./resultTypes";

export const HEATMAP_BORDER_COLOR = "#000000";
export const HEATMAP_INTERIOR_BORDER_WIDTH = 4;
export const HEATMAP_PERIMETER_BORDER_WIDTH = 8;

export interface HeatmapBorderCell {
  rowIndex: number;
  slotIndex: number;
  styleId: string;
  borderMode: HeatmapBorderMode;
}

type HeatmapBorderSegment =
  | { axis: "row"; rowBoundary: number; slotIndex: number }
  | { axis: "column"; slotBoundary: number; rowIndex: number };

export type HeatmapBorderEdge = HeatmapBorderSegment & {
  boundary: "interior" | "perimeter";
};

export interface HeatmapBorderEdgesByBoundary {
  interior: readonly HeatmapBorderEdge[];
  perimeter: readonly HeatmapBorderEdge[];
}

interface HeatmapBorderOptions {
  rowCount: number;
  wrapRows?: boolean;
}

function cellKey(rowIndex: number, slotIndex: number) {
  return `${rowIndex}:${slotIndex}`;
}

function edgeKey(edge: HeatmapBorderSegment) {
  return edge.axis === "row"
    ? `r:${edge.rowBoundary}:${edge.slotIndex}`
    : `c:${edge.slotBoundary}:${edge.rowIndex}`;
}

/** Returns each visible grid edge once, including separate contours for disconnected regions. */
export function heatmapBorderEdges(
  cells: readonly HeatmapBorderCell[],
  options: HeatmapBorderOptions,
): HeatmapBorderEdge[] {
  // Most heatmaps use no per-cell border. Avoid building a full string-keyed
  // index three times (rectangular, circular and wrapped circular) in that case.
  if (!cells.some((cell) => cell.borderMode !== "none")) return [];
  const byPosition = new Map(cells.map((cell) => [cellKey(cell.rowIndex, cell.slotIndex), cell]));
  const edges = new Map<string, HeatmapBorderEdge>();
  const rowCount = Math.max(0, options.rowCount);

  const rowNeighbor = (rowIndex: number, delta: -1 | 1) => {
    const next = rowIndex + delta;
    if (!options.wrapRows || rowCount < 2) return next;
    if (next < 0) return rowCount - 1;
    if (next >= rowCount) return 0;
    return next;
  };
  const rowBoundary = (boundary: number) => options.wrapRows && boundary === rowCount ? 0 : boundary;

  cells.forEach((cell) => {
    if (cell.borderMode === "none") return;
    const candidates: Array<{ neighbor: HeatmapBorderCell | undefined; edge: HeatmapBorderSegment }> = [
      {
        neighbor: byPosition.get(cellKey(rowNeighbor(cell.rowIndex, -1), cell.slotIndex)),
        edge: { axis: "row", rowBoundary: cell.rowIndex, slotIndex: cell.slotIndex },
      },
      {
        neighbor: byPosition.get(cellKey(rowNeighbor(cell.rowIndex, 1), cell.slotIndex)),
        edge: { axis: "row", rowBoundary: rowBoundary(cell.rowIndex + 1), slotIndex: cell.slotIndex },
      },
      {
        neighbor: byPosition.get(cellKey(cell.rowIndex, cell.slotIndex - 1)),
        edge: { axis: "column", slotBoundary: cell.slotIndex, rowIndex: cell.rowIndex },
      },
      {
        neighbor: byPosition.get(cellKey(cell.rowIndex, cell.slotIndex + 1)),
        edge: { axis: "column", slotBoundary: cell.slotIndex + 1, rowIndex: cell.rowIndex },
      },
    ];

    candidates.forEach(({ neighbor, edge }) => {
      const insideSameStyle = neighbor?.styleId === cell.styleId;
      if (cell.borderMode === "outer" && insideSameStyle) return;
      const boundary = insideSameStyle ? "interior" : "perimeter";
      const key = edgeKey(edge);
      if (edges.get(key)?.boundary === "perimeter" && boundary === "interior") return;
      edges.set(key, { ...edge, boundary } as HeatmapBorderEdge);
    });
  });

  return [...edges.values()];
}

/** Groups stable border geometry once so canvas paints do not filter it twice. */
export function groupHeatmapBorderEdges(edges: readonly HeatmapBorderEdge[]): HeatmapBorderEdgesByBoundary {
  const interior: HeatmapBorderEdge[] = [];
  const perimeter: HeatmapBorderEdge[] = [];
  edges.forEach((edge) => {
    (edge.boundary === "perimeter" ? perimeter : interior).push(edge);
  });
  return { interior, perimeter };
}
