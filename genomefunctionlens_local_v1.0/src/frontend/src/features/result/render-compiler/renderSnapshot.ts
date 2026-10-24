import type { DisplayColumn, HeatmapBorderMode, PartitionShape, TreeLayoutNode } from "../resultTypes";
import type { ResolvedTreeStyleProjection } from "./treeStyleProjection";
import type { TaxonColorPlan } from "../taxonColorSystem";
import type { HeatmapBorderCell, HeatmapBorderEdge, HeatmapBorderEdgesByBoundary } from "../heatmapBorderModel";

export interface RenderRow {
  readonly id: string;
  readonly kind: "terminal";
  readonly nodeId: number;
  readonly rank: string | null;
  readonly label: string;
  readonly collapseCeilingRank: string;
  readonly y: number;
  readonly leafCount: number;
}

export interface RenderTreeNode extends Omit<TreeLayoutNode, "children" | "nodePath" | "ownedLeafNodeIds"> {
  readonly children: readonly number[];
  readonly nodePath: readonly number[];
  readonly tooltipLabel: string;
  readonly ownedLeafNodeIds?: never;
}

export interface ResolvedHeatmapCell {
  readonly key: string;
  readonly row: RenderRow;
  readonly column: Readonly<DisplayColumn>;
  readonly columnKey: string;
  readonly count: number;
  readonly speciesHits: number;
  readonly value: number;
  readonly styleId: string;
  readonly shape: PartitionShape;
  readonly borderMode: HeatmapBorderMode;
  readonly fill: string;
  readonly label: string;
}

export interface RenderRowRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface RenderTaxonomyGroup {
  readonly label: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly nodeIds: readonly number[];
  readonly rootNodeId: number;
  readonly rootX: number;
}

export interface ResultRenderSnapshot {
  readonly revision: string;
  readonly rows: readonly RenderRow[];
  readonly treeNodes: readonly RenderTreeNode[];
  readonly cells: readonly ResolvedHeatmapCell[];
  readonly cellByKey: ReadonlyMap<string, ResolvedHeatmapCell>;
  readonly cellsByColumnKey: ReadonlyMap<string, readonly ResolvedHeatmapCell[]>;
  readonly cellsByRowId: ReadonlyMap<string, readonly ResolvedHeatmapCell[]>;
  readonly heatmapBorderCells: readonly HeatmapBorderCell[];
  readonly rectangularHeatmapBorderEdges: readonly HeatmapBorderEdge[];
  readonly rectangularHeatmapBorderEdgesByBoundary: HeatmapBorderEdgesByBoundary;
  readonly circularHeatmapBorderEdges: readonly HeatmapBorderEdge[];
  readonly circularHeatmapBorderEdgesByBoundary: HeatmapBorderEdgesByBoundary;
  readonly circularWrappedHeatmapBorderEdges: readonly HeatmapBorderEdge[];
  readonly circularWrappedHeatmapBorderEdgesByBoundary: HeatmapBorderEdgesByBoundary;
  readonly treeNodeById: ReadonlyMap<number, RenderTreeNode>;
  readonly treeNodeByNodeId: ReadonlyMap<number, RenderTreeNode>;
  readonly rowRangeByNodeId: ReadonlyMap<number, RenderRowRange>;
  readonly taxonColorPlan: TaxonColorPlan<RenderTaxonomyGroup>;
  readonly treeStyles: ResolvedTreeStyleProjection;
}

export interface HeatmapInteractionCells {
  selected: readonly ResolvedHeatmapCell[];
  draggedColumn: readonly ResolvedHeatmapCell[];
}

export function resolveHeatmapInteractionCells(
  snapshot: ResultRenderSnapshot,
  selectedCellKeys: ReadonlySet<string>,
  draggedColumnKey: string | null,
): HeatmapInteractionCells {
  return {
    selected: Array.from(selectedCellKeys, (key) => snapshot.cellByKey.get(key))
      .filter((cell): cell is ResolvedHeatmapCell => Boolean(cell)),
    draggedColumn: draggedColumnKey ? snapshot.cellsByColumnKey.get(draggedColumnKey) ?? [] : [],
  };
}

export function heatmapCellKeysForRenderNode(snapshot: ResultRenderSnapshot, nodeId: number): readonly string[] {
  const range = snapshot.rowRangeByNodeId.get(nodeId);
  if (!range) return [];
  const keys: string[] = [];
  for (let rowIndex = range.startIndex; rowIndex <= range.endIndex; rowIndex += 1) {
    snapshot.cellsByRowId.get(snapshot.rows[rowIndex]?.id ?? "")?.forEach((cell) => keys.push(cell.key));
  }
  return keys;
}

export function resolveVisibleRenderNodeId(
  snapshot: ResultRenderSnapshot,
  sourceNodeId: number | null,
  isAncestorOf: (ancestorNodeId: number, nodeId: number) => boolean,
): number | null {
  if (sourceNodeId === null) return null;
  if (snapshot.treeNodeByNodeId.has(sourceNodeId)) return sourceNodeId;
  const visibleDescendant = snapshot.treeNodes.find((node) => node.nodePath.includes(sourceNodeId));
  if (visibleDescendant) return visibleDescendant.nodeId;
  const containingTerminal = snapshot.rows.find((row) => isAncestorOf(row.nodeId, sourceNodeId));
  return containingTerminal?.nodeId ?? null;
}
