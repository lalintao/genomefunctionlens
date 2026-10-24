import type { AnnotationColumnSearchResult } from "../../types";
import type {
  BranchCartBatch,
  BranchCartRecord,
  ColumnLabelPart,
  HeatmapColumnSlot,
  HeatmapMetric,
  HeatmapStyleRecord,
  RatioDisplayMode,
  TreeViewMode,
} from "../result/resultTypes";
import { ensureDefaultHeatmapStyles } from "../result/heatmapStyleModel";
import type { TreeStyleRecord } from "../result/treeStyleModel";
import type { AliveTreeRuntime, TreeCoreRuntime } from "../tree-core/treeCoreTypes";
import type { LocalRankConstraint, LocalRankRule } from "../tree-core/treeState";
import type { TerminalNodeTableRow } from "../tree-core/terminalNodeTable";
import type { TreeWorkspaceResetBaseline, TreeWorkspaceSnapshot } from "./treeWorkspace";
import { DEFAULT_SHOW_HEATMAP_NUMBERS } from "./heatmapPresentation";
import type { TaxonDisplayStyle, TaxonNameDisplayMode, TreeFontProfile, WorkbenchAppearanceSnapshot } from "./workbenchAppearance";
import { DEFAULT_TAXON_DISPLAY_STYLE } from "./workbenchAppearance";
import {
  WORKBENCH_COMMAND_SCHEMA_VERSION,
  createWorkbenchSnapshot,
  executeWorkbenchCommand,
  executeWorkbenchCommandEnvelope,
  rollbackWorkbenchCommit,
  type WorkbenchCommand,
  type WorkbenchCommitReceipt,
  type WorkbenchCommandResult,
  type WorkbenchSnapshot,
} from "./workbenchCommandFacade";
import {
  CIRCULAR_FONT_PROFILE,
  DEFAULT_STRIP_MINIMUM_LEAF_COUNT,
  DEFAULT_TAXON_NAME_DISPLAY_MODE,
  RECTANGULAR_FONT_PROFILE,
} from "./workbenchAppearance";
import {
  DEFAULT_BRANCH_SCALE,
  DEFAULT_CIRCULAR_ARC_DEGREES,
  DEFAULT_CIRCULAR_HEATMAP_RING_WIDTH,
  DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
  DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE,
  DEFAULT_CIRCULAR_STRIP_RING_WIDTH,
  DEFAULT_CIRCULAR_ROTATION_DEGREES,
  DEFAULT_HEATMAP_COLUMN_WIDTH,
  DEFAULT_HEATMAP_SHAPE_SIZE,
  DEFAULT_RECTANGULAR_STRIP_COLUMN_WIDTH,
  DEFAULT_TREE_BRANCH_STROKE_WIDTH,
  DEFAULT_TREE_SPACING_SCALE,
} from "../result/resultVisualConstants";

export interface WorkbenchReactState {
  revision: number;
  canvasTreeRuntime: AliveTreeRuntime | null;
  resultSession: AnnotationColumnSearchResult | null;
  columnSlots: HeatmapColumnSlot[];
  selectedCells: Set<string>;
  heatmapStyles: HeatmapStyleRecord[];
  treeStyles: TreeStyleRecord[];
  treeViewMode: TreeViewMode;
  displayRank: string;
  stripRank: string;
  showStrip: boolean;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  taxonLegendFontSize: number;
  rectangularTaxonLegendFontSize: number;
  circularTaxonLegendFontSize: number;
  heatmapLegendFontSize: number;
  rectangularHeatmapLegendFontSize: number;
  circularHeatmapLegendFontSize: number;
  branchScale: number;
  spacingScale: number;
  showStripLabels: boolean;
  stripMinimumLeafCount: number;
  showSpeciesCount: boolean;
  showBranchLabels: boolean;
  forceShowBranchLabels: boolean;
  forceShowStripLabels: boolean;
  forceShowSpeciesCount: boolean;
  branchStrokeWidth: number;
  rectangularFontProfile: TreeFontProfile;
  circularFontProfile: TreeFontProfile;
  rectangularStripColumnWidth: number;
  circularStripRingWidth: number;
  rectangularHeatmapColumnWidth: number;
  circularHeatmapRingWidth: number;
  showInternalNodes: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  circularArcDegrees: number;
  circularRotationDegrees: number;
  localRankRules: LocalRankRule[];
  customTerminalLabels: Map<number, string>;
  viewRoot: number | null;
  treeResetBaseline: TreeWorkspaceResetBaseline | null;
  aliveBitset: Uint8Array | null;
  cartAliveBitset: Uint8Array | null;
  localRankConstraints: LocalRankConstraint[];
  terminalNodeTable: TerminalNodeTableRow[];
  showNumbers: boolean;
  ratioDisplayMode: RatioDisplayMode;
  heatmapMetric: HeatmapMetric;
  heatmapShapeSize: number;
  columnLabelParts: ColumnLabelPart[];
  branchCartRecords: BranchCartRecord[];
  branchCartBatches: BranchCartBatch[];
  activeModuleId: string;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  showModuleCompleteness: boolean;
  showModuleDetail: boolean;
  moduleCompletenessThreshold: string;
}

export function createWorkbenchReactState(): WorkbenchReactState {
  return {
    revision: 0,
    canvasTreeRuntime: null,
    resultSession: null,
    columnSlots: [],
    selectedCells: new Set(),
    heatmapStyles: ensureDefaultHeatmapStyles([]),
    treeStyles: [],
    treeViewMode: "circular",
    displayRank: "phylum",
    stripRank: "phylum",
    showStrip: true,
    taxonDisplayStyle: DEFAULT_TAXON_DISPLAY_STYLE,
    taxonNameDisplayMode: DEFAULT_TAXON_NAME_DISPLAY_MODE,
    taxonLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    rectangularTaxonLegendFontSize: DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE,
    circularTaxonLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    heatmapLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    rectangularHeatmapLegendFontSize: DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE,
    circularHeatmapLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    branchScale: DEFAULT_BRANCH_SCALE,
    spacingScale: DEFAULT_TREE_SPACING_SCALE,
    showStripLabels: true,
    stripMinimumLeafCount: DEFAULT_STRIP_MINIMUM_LEAF_COUNT,
    showSpeciesCount: false,
    showBranchLabels: true,
    forceShowBranchLabels: false,
    forceShowStripLabels: false,
    forceShowSpeciesCount: false,
    branchStrokeWidth: DEFAULT_TREE_BRANCH_STROKE_WIDTH,
    rectangularFontProfile: { ...RECTANGULAR_FONT_PROFILE },
    circularFontProfile: { ...CIRCULAR_FONT_PROFILE },
    rectangularStripColumnWidth: DEFAULT_RECTANGULAR_STRIP_COLUMN_WIDTH,
    circularStripRingWidth: DEFAULT_CIRCULAR_STRIP_RING_WIDTH,
    rectangularHeatmapColumnWidth: DEFAULT_HEATMAP_COLUMN_WIDTH,
    circularHeatmapRingWidth: DEFAULT_CIRCULAR_HEATMAP_RING_WIDTH,
    showInternalNodes: true,
    showBranchGuides: true,
    showBranchLengths: false,
    circularArcDegrees: DEFAULT_CIRCULAR_ARC_DEGREES,
    circularRotationDegrees: DEFAULT_CIRCULAR_ROTATION_DEGREES,
    localRankRules: [],
    customTerminalLabels: new Map(),
    viewRoot: null,
    treeResetBaseline: null,
    aliveBitset: null,
    cartAliveBitset: null,
    localRankConstraints: [],
    terminalNodeTable: [],
    showNumbers: DEFAULT_SHOW_HEATMAP_NUMBERS,
    ratioDisplayMode: "percent",
    heatmapMetric: "ratio",
    heatmapShapeSize: DEFAULT_HEATMAP_SHAPE_SIZE,
    columnLabelParts: ["short_name"],
    branchCartRecords: [],
    branchCartBatches: [],
    activeModuleId: "",
    showModuleNames: false,
    showModuleFullName: false,
    showModuleCompleteness: true,
    showModuleDetail: false,
    moduleCompletenessThreshold: "80",
  };
}

export function createDatasetWorkbenchReactState(
  rawTree: TreeCoreRuntime,
  options: { displayRank: string; stripRank: string },
): WorkbenchReactState {
  const initial = createWorkbenchSnapshot(rawTree, options.displayRank, options.stripRank);
  const defaultScope = executeWorkbenchCommand(rawTree, initial, {
    type: "tree",
    command: {
      type: "reset-default-tree",
      displayRank: options.displayRank,
      stripRank: options.stripRank,
    },
  });
  if (!defaultScope.accepted) {
    throw new Error(defaultScope.rejection);
  }
  return projectWorkbenchSnapshot(createWorkbenchReactState(), {
    ...defaultScope.snapshot,
    revision: 0,
  });
}

export interface WorkbenchReactCommandOptions {
  effectiveAliveBitset?: Uint8Array | null;
  expectedRevision?: number;
}

export interface WorkbenchReactCommandOutcome {
  result: WorkbenchCommandResult;
  state: WorkbenchReactState;
}

export function projectWorkbenchSnapshot(
  current: WorkbenchReactState,
  snapshot: WorkbenchSnapshot,
  invalidation?: Extract<WorkbenchCommandResult, { accepted: true }>["invalidation"],
  command?: WorkbenchCommand,
): WorkbenchReactState {
  const nextTree = snapshot.tree;
  const nextHeatmap = snapshot.heatmap;
  const nextAppearance = snapshot.appearance;
  const nextAliveBitset = sameAliveBitset(current.aliveBitset, nextTree.aliveBitset)
    ? current.aliveBitset
    : nextTree.aliveBitset;
  const nextLocalRankConstraints = sameLocalRankConstraints(current.localRankConstraints, nextTree.localRankConstraints)
    ? current.localRankConstraints
    : nextTree.localRankConstraints;
  const nextTerminalNodeTable = sameTerminalNodeTable(current.terminalNodeTable, nextTree.terminalNodeTable)
    ? current.terminalNodeTable
    : nextTree.terminalNodeTable;
  const next: WorkbenchReactState = {
    ...current,
    canvasTreeRuntime: nextTree.runtime,
    resultSession: snapshot.query.resultSession,
    columnSlots: snapshot.query.columnSlots,
    heatmapStyles: nextHeatmap.styles,
    selectedCells: nextHeatmap.selectedCellKeys,
    treeViewMode: nextAppearance.treeViewMode,
    displayRank: nextTree.displayRank,
    stripRank: nextTree.stripRank,
    showStrip: nextAppearance.showStrip,
    taxonDisplayStyle: nextAppearance.taxonDisplayStyle,
    taxonNameDisplayMode: nextAppearance.taxonNameDisplayMode,
    taxonLegendFontSize: nextAppearance.taxonLegendFontSize,
    rectangularTaxonLegendFontSize: nextAppearance.rectangularTaxonLegendFontSize,
    circularTaxonLegendFontSize: nextAppearance.circularTaxonLegendFontSize,
    heatmapLegendFontSize: nextAppearance.heatmapLegendFontSize,
    rectangularHeatmapLegendFontSize: nextAppearance.rectangularHeatmapLegendFontSize,
    circularHeatmapLegendFontSize: nextAppearance.circularHeatmapLegendFontSize,
    branchScale: nextAppearance.branchScale,
    spacingScale: nextAppearance.spacingScale,
    showStripLabels: nextAppearance.showStripLabels,
    stripMinimumLeafCount: nextAppearance.stripMinimumLeafCount,
    showSpeciesCount: nextAppearance.showSpeciesCount,
    showBranchLabels: nextAppearance.showBranchLabels,
    forceShowBranchLabels: nextAppearance.forceShowBranchLabels,
    forceShowStripLabels: nextAppearance.forceShowStripLabels,
    forceShowSpeciesCount: nextAppearance.forceShowSpeciesCount,
    branchStrokeWidth: nextAppearance.branchStrokeWidth,
    rectangularFontProfile: nextAppearance.rectangularFontProfile,
    circularFontProfile: nextAppearance.circularFontProfile,
    rectangularStripColumnWidth: nextAppearance.rectangularStripColumnWidth,
    circularStripRingWidth: nextAppearance.circularStripRingWidth,
    rectangularHeatmapColumnWidth: nextAppearance.rectangularHeatmapColumnWidth,
    circularHeatmapRingWidth: nextAppearance.circularHeatmapRingWidth,
    showInternalNodes: nextAppearance.showInternalNodes,
    showBranchGuides: nextAppearance.showBranchGuides,
    showBranchLengths: nextAppearance.showBranchLengths,
    circularArcDegrees: nextAppearance.circularArcDegrees,
    circularRotationDegrees: nextAppearance.circularRotationDegrees,
    localRankRules: nextTree.localRankRules,
    customTerminalLabels: nextTree.customTerminalLabels,
    viewRoot: nextTree.viewRootNodeId,
    treeResetBaseline: nextTree.resetBaseline,
    aliveBitset: nextAliveBitset,
    cartAliveBitset: snapshot.cart.aliveBitset,
    localRankConstraints: nextLocalRankConstraints,
    terminalNodeTable: nextTerminalNodeTable,
    showNumbers: nextHeatmap.showNumbers,
    ratioDisplayMode: nextHeatmap.ratioDisplayMode,
    heatmapMetric: nextHeatmap.metric,
    heatmapShapeSize: nextHeatmap.shapeSize,
    columnLabelParts: nextHeatmap.columnLabelParts,
    branchCartRecords: snapshot.cart.records,
    branchCartBatches: snapshot.cart.batches,
    activeModuleId: nextHeatmap.activeModuleId,
    showModuleNames: nextHeatmap.showModuleNames,
    showModuleFullName: nextHeatmap.showModuleFullName,
    showModuleCompleteness: nextHeatmap.showModuleCompleteness,
    showModuleDetail: nextHeatmap.showModuleDetail,
    moduleCompletenessThreshold: nextHeatmap.moduleCompletenessThreshold,
    revision: snapshot.revision,
  };
  if (command && invalidation?.treeStyles) next.treeStyles = [];
  if (command && invalidation?.selection) next.selectedCells = new Set();
  if (command?.type === "apply-cart" || (command?.type === "tree" && command.command.type === "apply-cart-scope")) {
    next.heatmapStyles = [];
  }
  return next;
}

function projectWorkbenchResult(
  current: WorkbenchReactState,
  result: Extract<WorkbenchCommandResult, { accepted: true }>,
  command?: WorkbenchCommand,
): WorkbenchReactState {
  return projectWorkbenchSnapshot(current, result.snapshot, result.invalidation, command);
}

function sameAliveBitset(left: Uint8Array | null, right: Uint8Array) {
  return left !== null
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameLocalRankConstraints(
  left: readonly LocalRankConstraint[],
  right: readonly LocalRankConstraint[],
) {
  return left.length === right.length && left.every((constraint, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && constraint.nodeId === candidate.nodeId
      && constraint.expandRank === candidate.expandRank
      && constraint.taxonRank === candidate.taxonRank
      && constraint.taxonName === candidate.taxonName;
  });
}

function sameTerminalNodeTable(
  left: readonly TerminalNodeTableRow[],
  right: readonly TerminalNodeTableRow[],
) {
  return left.length === right.length && left.every((row, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && row.nodeId === candidate.nodeId
      && row.rank === candidate.rank
      && row.label === candidate.label
      && row.collapseCeilingRank === candidate.collapseCeilingRank
      && row.ownedLeafNodeIds.length === candidate.ownedLeafNodeIds.length
      && row.ownedLeafNodeIds.every((leafNodeId, leafIndex) => leafNodeId === candidate.ownedLeafNodeIds[leafIndex]);
  });
}

function projectTreeSnapshot(state: WorkbenchReactState): TreeWorkspaceSnapshot | null {
  if (!state.canvasTreeRuntime) return null;
  return {
    runtime: state.canvasTreeRuntime,
    // React state is updated only with immutable domain branches. Keep those
    // references so every command does not scan/copy the complete tree scope.
    aliveBitset: state.aliveBitset ?? new Uint8Array(),
    displayRank: state.displayRank,
    stripRank: state.stripRank,
    localRankRules: state.localRankRules,
    localRankConstraints: state.localRankConstraints,
    terminalNodeTable: state.terminalNodeTable,
    customTerminalLabels: state.customTerminalLabels,
    viewRootNodeId: state.viewRoot,
    resetBaseline: state.treeResetBaseline,
  };
}

function captureAppearance(state: WorkbenchReactState): WorkbenchAppearanceSnapshot {
  return {
    treeViewMode: state.treeViewMode,
    showStrip: state.showStrip,
    taxonDisplayStyle: state.taxonDisplayStyle,
    taxonNameDisplayMode: state.taxonNameDisplayMode,
    taxonLegendFontSize: state.taxonLegendFontSize,
    rectangularTaxonLegendFontSize: state.rectangularTaxonLegendFontSize,
    circularTaxonLegendFontSize: state.circularTaxonLegendFontSize,
    heatmapLegendFontSize: state.heatmapLegendFontSize,
    rectangularHeatmapLegendFontSize: state.rectangularHeatmapLegendFontSize,
    circularHeatmapLegendFontSize: state.circularHeatmapLegendFontSize,
    branchScale: state.branchScale,
    spacingScale: state.spacingScale,
    showStripLabels: state.showStripLabels,
    stripMinimumLeafCount: state.stripMinimumLeafCount,
    showSpeciesCount: state.showSpeciesCount,
    showBranchLabels: state.showBranchLabels,
    forceShowBranchLabels: state.forceShowBranchLabels,
    forceShowStripLabels: state.forceShowStripLabels,
    forceShowSpeciesCount: state.forceShowSpeciesCount,
    branchStrokeWidth: state.branchStrokeWidth,
    rectangularFontProfile: state.rectangularFontProfile,
    circularFontProfile: state.circularFontProfile,
    rectangularStripColumnWidth: state.rectangularStripColumnWidth,
    circularStripRingWidth: state.circularStripRingWidth,
    rectangularHeatmapColumnWidth: state.rectangularHeatmapColumnWidth,
    circularHeatmapRingWidth: state.circularHeatmapRingWidth,
    showInternalNodes: state.showInternalNodes,
    showBranchGuides: state.showBranchGuides,
    showBranchLengths: state.showBranchLengths,
    circularArcDegrees: state.circularArcDegrees,
    circularRotationDegrees: state.circularRotationDegrees,
  };
}

export function captureSnapshot(
  rawTree: TreeCoreRuntime,
  state: WorkbenchReactState,
  effectiveAliveBitset: Uint8Array | null | undefined,
  revision: number,
): WorkbenchSnapshot | null {
  const tree = projectTreeSnapshot({
    ...state,
    aliveBitset: effectiveAliveBitset ?? state.aliveBitset,
  });
  if (!tree) return null;
  return {
    datasetIdentity: {
      speciesTree: rawTree.dataset.species_tree,
      genomeDatabase: rawTree.dataset.genome_database,
      datasetRevision: rawTree.dataset.dataset_revision ?? "unversioned",
    },
    revision,
    tree,
    cart: {
      aliveBitset: state.cartAliveBitset ?? new Uint8Array(rawTree.nodeCount),
      records: state.branchCartRecords,
      batches: state.branchCartBatches,
    },
    query: { resultSession: state.resultSession, columnSlots: state.columnSlots },
    heatmap: {
      metric: state.heatmapMetric,
      ratioDisplayMode: state.ratioDisplayMode,
      showNumbers: state.showNumbers,
      shapeSize: state.heatmapShapeSize,
      columnLabelParts: state.columnLabelParts,
      styles: state.heatmapStyles,
      selectedCellKeys: state.selectedCells,
      activeModuleId: state.activeModuleId,
      showModuleNames: state.showModuleNames,
      showModuleFullName: state.showModuleFullName,
      showModuleCompleteness: state.showModuleCompleteness,
      showModuleDetail: state.showModuleDetail,
      moduleCompletenessThreshold: state.moduleCompletenessThreshold,
    },
    appearance: captureAppearance(state),
  };
}

export function executeWorkbenchReactCommand(
  rawTree: TreeCoreRuntime,
  current: WorkbenchReactState,
  command: WorkbenchCommand,
  options: WorkbenchReactCommandOptions = {},
): WorkbenchReactCommandOutcome | null {
  const revision = current.revision;
  const snapshot = captureSnapshot(rawTree, current, options.effectiveAliveBitset, revision);
  if (!snapshot) return null;
  const result = executeWorkbenchCommandEnvelope(rawTree, snapshot, {
    schemaVersion: WORKBENCH_COMMAND_SCHEMA_VERSION,
    datasetIdentity: snapshot.datasetIdentity,
    expectedRevision: options.expectedRevision ?? revision,
    command,
  });
  if (!result.accepted) return { result, state: current };
  return { result, state: projectWorkbenchResult(current, result, command) };
}

/** Restore a committed browser operation when no later Workbench edit exists. */
export function rollbackWorkbenchReactCommit(
  rawTree: TreeCoreRuntime,
  current: WorkbenchReactState,
  receipt: WorkbenchCommitReceipt,
  options: Pick<WorkbenchReactCommandOptions, "effectiveAliveBitset"> = {},
): WorkbenchReactCommandOutcome | null {
  const snapshot = captureSnapshot(rawTree, current, options.effectiveAliveBitset, current.revision);
  if (!snapshot) return null;
  const result = rollbackWorkbenchCommit(snapshot, receipt);
  if (!result.accepted) return { result, state: current };
  return { result, state: projectWorkbenchResult(current, result) };
}
