import type { AnnotationType, SearchColumn, Selection, SuggestItem } from "../../types";

export type DrawerPanel = "tree" | "heatmap";
export type TreeViewMode = "rectangular" | "circular";
export type PartitionShape = "fill" | "circle" | "triangle" | "square";
export type HeatmapBorderMode = "none" | "outer" | "inner";
export type HeatmapMetric = "count" | "ratio";
export type RatioDisplayMode = "fraction" | "percent";
export type ColumnLabelPart = "value" | "short_name" | "full_name";
export type BranchCartSourceType = "manual" | "heatmap";
export type BranchCartScopeSource = "current_view" | "database";
export type DisplayColumn = SearchColumn & { kind: "column"; displayLabel: string; slotId: string; slotIndex: number; reserveTrailingGap?: boolean };
export type HeatmapDisplayColumn = DisplayColumn;

export interface HeatmapColumnSlot {
  slotId: string;
  columnKey: string;
  slotIndex: number;
  reserveTrailingGap?: boolean;
}

export interface TreeLayoutNode {
  id: number;
  nodeId: number;
  kind: "internal" | "terminal";
  rank: string | null;
  label: string;
  parent: number | null;
  children: readonly number[];
  x: number;
  y: number;
  branchLength: number;
  cumulativeLength: number;
  nodePath: readonly number[];
  speciesCount: number;
  genomeCount: number;
  /** Only terminal nodes own an explicit leaf set. */
  ownedLeafNodeIds?: number[];
  /** Internal nodes retain only this count, never a materialized subtree leaf array. */
  aliveLeafCount: number;
}

export interface VisibleRow {
  id: string;
  kind: "terminal";
  nodeId: number;
  rank: string | null;
  label: string;
  collapseCeilingRank: string;
  ownedLeafNodeIds: number[];
  y: number;
}

export interface TerminalBand {
  rowId: string;
  nodeId: number;
  index: number;
  top: number;
  center: number;
  bottom: number;
  height: number;
}

export interface TreeHitbox {
  nodeId: number;
  renderId: number;
  kind: TreeLayoutNode["kind"] | "strip";
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface ColumnMenuState {
  open: boolean;
  x: number;
  y: number;
  targetValue: string | null;
}

export interface CellMenuState {
  open: boolean;
  x: number;
  y: number;
}

export interface InsertDialogState {
  open: boolean;
  side: "left" | "right";
  targetValue: string | null;
  type: AnnotationType;
  value: string;
  selected: SuggestItem | null;
}

export interface HeatmapStyleRecord {
  id: string;
  role: "default" | "selection";
  treeViewMode: TreeViewMode;
  /** Retained to migrate saved workspaces created before editable scales. */
  paletteId: string;
  colorScales?: HeatmapColorScales;
  shape: PartitionShape;
  borderMode: HeatmapBorderMode;
  name: string;
  leafCellKeys: string[];
}

export interface HeatmapColorStop {
  /** Inclusive upper bound by default; null is the final unbounded interval. */
  upperBound: number | null;
  /** Lets the next stop reserve an exact endpoint, such as 100%. */
  upperBoundExclusive?: boolean;
  color: string;
}

export interface HeatmapColorScale {
  stops: HeatmapColorStop[];
}

export interface HeatmapColorScales {
  count: HeatmapColorScale;
  ratio: HeatmapColorScale;
}

export interface SelectionDraft {
  active: boolean;
  mode: "heatmap" | "strip";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface ScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ColumnDragDraft {
  value: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

export interface PanDraft {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
  canPan: boolean;
}

export interface HeatmapLegendState {
  open: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeMenuState {
  open: boolean;
  x: number;
  y: number;
  nodeId: number | null;
  kind: TreeHitbox["kind"] | null;
}

export interface BranchCartRecord {
  id: string;
  nodeId: number;
  label: string;
  taxonLabel: string;
  rank: string | null;
  expandRank: string;
  ancestorNodeId: number | null;
  ancestorLabel: string;
  ancestorRank: string;
  path: string;
  leafCount: number;
  fullTreeLeafCount: number;
  leafNodeIds: number[];
  isExactNodeScope: boolean;
  batchId: number;
  sourceType: BranchCartSourceType;
  scopeSource: BranchCartScopeSource;
}

export interface BranchCartBatch {
  id: number;
  sourceType: BranchCartSourceType;
  ancestorNodeId: number | null;
  ancestorLabel: string;
  ancestorRank: string;
  expandRank: string;
  recordCount: number;
}

export interface LocalRankRuleRow {
  nodeId: number;
  taxonRank: string;
  taxonName: string;
  path: string;
  rank: string;
  enabled: boolean;
}

export interface PaletteScheme {
  id: string;
  name: string;
  colors: string[];
}

export interface CartTab {
  key: string;
  label: string;
  primaryKey: string;
  primaryLabel: string;
}

export type SelectionLike = Pick<Selection, "annotationType" | "annotationValue" | "moduleId">;
