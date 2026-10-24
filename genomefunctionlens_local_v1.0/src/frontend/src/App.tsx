import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type Dispatch,
  type CSSProperties,
  type SetStateAction,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronsLeft, ChevronsRight, Download, FileDown, FileImage, FileText, FolderPlus, LayoutGrid, LocateFixed, RefreshCcw, Save, X, ListTree } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import TopMenu, { type TopMenuTarget } from "./components/layout/TopMenu";
import NoticeBanner, { type NoticeKind } from "./components/notice/NoticeBanner";
import { ViewportFloatingLayer } from "./components/floating/viewportFloating";
import {
  CIRCULAR_HEATMAP_SHAPES,
  DEFAULT_PALETTE_ID,
  RANKS,
  RECTANGULAR_HEATMAP_SHAPES,
} from "./features/result/resultConstants";
import ActionConfirmDialog from "./features/result/ActionConfirmDialog";
import {
  downloadBlob,
  exportPlotDataArchive,
  sanitizeFilePart,
  svgToPdfBlob,
  svgToPngBlob,
} from "./features/result/resultExport";
import {
  EMPTY_BRANCH_PRUNE_DRAFT,
  planBranchPrune,
  type BranchPruneDraft,
  type BranchPruneErrorCode,
  type BranchPruneStatus,
  type BranchPruneSummary,
} from "./features/result/branchPrune";
import { circularTreeLayoutPresetSettings, type CircularTreeLayoutPreset } from "./features/result/circularTreeLayoutPreset";
import { useViewportController } from "./features/result/viewportController";
import { createHomeDraftExecutor, type HomeDraftChannel, type HomeDraftExecutor } from "./features/home-drafts/homeDraftExecutor";
import { RectangularTreeIcon, TreeLayoutToggle } from "./features/result/TreeLayoutToggle";
import { defaultAnnotationRankForLocalRules, localizedText, shapeLabel } from "./features/result/resultLabels";
import {
  columnLabelPartValue,
  parseBatchQuery,
} from "./features/result/resultSelection";
import {
  createCondition,
  emptyColumnMenu,
  emptyInsertDialog,
} from "./features/result/resultState";
import {
  normalizeHeatmapColumnSlots,
  placeModuleDetailsBeforeCompleteness,
  visibleHeatmapColumnSlots,
} from "./features/result/heatmapColumnLayout";
import { prepareAnnotationSearchConditions } from "./features/query/annotationSearchConditions";
import { appendSearchedHeatmapColumns } from "./features/result/annotationColumnSearch";
import { columnByKey, heatmapCellKeysForRows, hitHeatmapCellKeyAtPoint, hitHeatmapCellKeysInRect } from "./features/result/heatmapHitModel";
import { shouldHandleHeatmapCellClick, shouldStartHeatmapMarquee } from "./features/result/heatmapSelectionInteraction";
import {
  buildLeafStyleMap,
  createStyleFromLeafKeys,
  defaultHeatmapStyleForMode,
  ensureDefaultHeatmapStyles,
  heatmapStylesForMode,
  resetHeatmapStylesForMode,
  removeHeatmapColumnStyles,
  removeHeatmapStyle,
  rectangularHeatmapUsesSquareCells as stylesRequireSquareCells,
  colorScalesForStyle,
  defaultHeatmapColorScales,
} from "./features/result/heatmapStyleModel";
import {
  appendTreeStyleWithCoveragePruning,
  createTreeStyleId,
  defaultTreeStyleKindForNode,
  nextTreeStyleName,
  normalizeTreeStyleColor,
  syncTaxonStyles,
  treeStyleMatchesTaxon,
  updateTreeStyle,
  type TreeStyleKind,
  type TreeStyleRecord,
} from "./features/result/treeStyleModel";
import {
  BASE_HEADER_HEIGHT,
  BASE_ROW_HEIGHT,
  DEFAULT_CIRCULAR_ROTATION_DEGREES,
  TREE_WIDTH,
} from "./features/result/resultVisualConstants";
import {
  branchRank,
  circularLabelWidth,
  clamp,
  columnLabelWidth,
  deepestRank,
  exactTaxonRank,
  heatmapSlotSpan,
  isModuleCompletenessColumn,
  isModuleDetailColumn,
  leafCellKey,
  moduleBraceLabel,
  normalizeColumnKey,
  rectangularColumnLabelProjection,
  rectangularModuleHeaderLayout,
  rowCellKey,
  sourceLabel,
  sourceName,
  taxonomyPath,
  taxonRootForRank,
  taxonomyValue,
  isHeatmapDisplayColumn,
  isAncestorOf,
} from "./features/result/resultVisualUtils";
import { createTaxonColorPlan, taxonStyleColorCss, visibleTaxonColorGroups } from "./features/result/taxonColorSystem";
import { compileRenderTaxonomyGroups, compileResultRenderSnapshot } from "./features/result/render-compiler/renderCompiler";
import { compileExportFrame, exportScene, type FigureScenePlan, type LegendFigureData } from "./features/result/rendering/figureExport";
import { createScenePlanStore } from "./features/result/rendering/scenePlanStore";
import { heatmapCellKeysForRenderNode, resolveVisibleRenderNodeId } from "./features/result/render-compiler/renderSnapshot";
import { resolveCanvasPresentation, resolveCanvasWheelInteractionZoom, resolveCircularPresentationGeometry } from "./features/result/canvasPresentation";
import { advanceViewerFitConvergence, cameraChanged, circularBranchRenderValue, circularStripLabelsVisible, initialDensityVisibility, initialResultFitIsReady, preserveRootAnchor, rectangularFitFrame, scaleBranchCoordinate, scheduleFitWhenStable, shouldAutomaticallyFitLayoutTransition, shouldAutomaticallyFitTreeMutation, speciesTreeRenderer } from "./features/result/tree-renderer/canvasScene";
import type {
  BranchCartBatch,
  BranchCartRecord,
  BranchCartScopeSource,
  ColumnDragDraft,
  ColumnLabelPart,
  ColumnMenuState,
  DisplayColumn,
  DrawerPanel,
  HeatmapLegendState,
  HeatmapColorScales,
  HeatmapMetric,
  HeatmapColumnSlot,
  InsertDialogState,
  NodeMenuState,
  PanDraft,
  HeatmapStyleRecord,
  PartitionShape,
  TreeLayoutNode,
  ScreenRect,
  SelectionDraft,
  TreeViewMode,
  VisibleRow,
} from "./features/result/resultTypes";
import { buildTerminalBands } from "./features/result/terminalBandLayout";
import { resolveCircularAngularLayout, resolveCircularNodeRadii } from "./features/result/circularRadialLayout";
import { circularFontLimits } from "./features/result/treeFontSizing";
import { resolveRectangularColumnWidthWorld, resolveScreenLockedWorldLength, resolveVisualSize, worldToScreenPx } from "./features/result/visualScaleResolver";
import { captureWorkspaceDocument, decodeWorkspaceDocument, prepareWorkspaceRestore, cameraOffsetForViewport, migrateLegacyCamera, type WorkspaceViewDocument, type SavedCamera } from "./features/saved-queries/workspaceDocument";
import { createTreeCoreSession } from "./features/tree-core/treeCoreRuntime";
import { runWorkspaceCodec } from "./features/saved-queries/workspaceCodec";
import { ApiError, fetchTreeCoreSummary, fetchTreeCoreFile, updateSavedQuery, type SavedQueryPayload } from "./api";

import {
  deriveCollapsedHeatmapAggregate,
  makeHeatmapAggregateCacheEntry,
  mapHeatmapAggregateMatrices,
  mergeHeatmapAggregateColumns,
  planHeatmapAggregation,
  projectHeatmapAggregateColumns,
  type HeatmapAggregateCacheEntry,
} from "./features/result/heatmapAggregationPlan";
import LandingPage from "./pages/LandingPage";
import HomePage from "./pages/HomePage";
import {
  aggregateHeatmap,
  downloadSequences,
  getActiveSequenceDownloadTask,
  waitForSequenceDownload,
  fetchDatasets,
  fetchTreeScopeOptions,
  filterTreeGenomes,
  fetchModuleSuggestions,
  fetchSuggestions,
  searchAnnotationColumns,
  createSavedQuery,
  createSavedQueryCategory,
  deleteSavedQuery,
  deleteSavedQueryCategory,
  getSavedQuery,
  listSavedQueries,
  listSavedQueryCategories,
  type SavedQueryCategory,
  type SavedQueryRecord,
} from "./api";
import { createTreeCoreViewModel } from "./features/tree-core/treeCoreView";
import { useTreeCoreBootstrap } from "./features/tree-core/useTreeCoreBootstrap";
import {
  createDefaultRerootSpec,
  createRerootSpecForCanvasPath,
  rerootSpecsEqual,
  swappedBranchNodeIdsFromAliveTree,
} from "./features/tree-core/aliveTreeRuntime";
import type { AliveTreeRuntime, TreeCoreLoadState } from "./features/tree-core/treeCoreTypes";
import {
  aliveBitsetFromLeafNodeIds,
  leafNodeIdsFromAliveBitset,
  createEmptyAliveBitset,
  createFullAliveBitset,
} from "./features/tree-core/treeBitmapState";
import { buildTreeProjection } from "./features/tree-core/treeProjection";
import { createTerminalCutSnapshot } from "./features/tree-core/terminalCutSnapshot";
import {
  conflictingLocalRankNodeId,
  taxonScopeIdentityForNode,
  type LocalRankRule,
} from "./features/tree-core/treeState";
import {
  collapseCeilingRankForNode,
  collapseTerminalChoice,
  nearestNamedAncestorTerminalRank,
  nextAvailableTerminalRank,
} from "./features/tree-core/treeTerminalTransitions";
import {
  buildTerminalNodeTable,
} from "./features/tree-core/terminalNodeTable";
import {
  captureTreeWorkspaceResetBaseline,
  createTreeWorkspace,
  executeTreeWorkspace,
  type TreeWorkspaceCommand,
} from "./features/workbench/treeWorkspace";
import {
  type QuerySpecificationCommand,
} from "./features/workbench/querySpecification";
import { executeGuardedQueryColumnAddition } from "./features/workbench/queryColumnAdditionGuard";
import {
  defaultQueryScopeLeafNodeIds,
  defaultQueryScopeSelection,
  defaultQueryScopeExpansionRank,
  queryScopeOption,
  searchQueryScopeCandidates,
  type QueryScopePresetKey,
} from "./features/query/queryScope";
import {
  cartWorkspaceApplication,
  type CartWorkspaceCommand,
  type CartWorkspaceSnapshot,
} from "./features/workbench/cartWorkspace";
import { type HeatmapPresentationCommand } from "./features/workbench/heatmapPresentation";
import {
  initialTreeViewModeForTerminalCount,
  type TaxonDisplayStyle,
  type TaxonNameDisplayMode,
  type TreeFontProfile,
  type WorkbenchAppearanceCommand,
  type WorkbenchAppearanceSnapshot,
} from "./features/workbench/workbenchAppearance";
import {
  type WorkbenchCommand,
  type WorkbenchCommandResult,
} from "./features/workbench/workbenchCommandFacade";
import { useWorkbenchController } from "./features/workbench/workbenchController";
import {
  createWorkbenchReactState,
} from "./features/workbench/workbenchReactBridge";
import { annotationDisplayValue, moduleDisplayValue } from "./shared/annotation";
import {
  closeFloatingLegend,
  rebaseFloatingLegendToCamera,
  updateFloatingLegendInteraction,
  type FloatingLegendInteractionDraft,
  type FloatingLegendInteractionMode,
} from "./features/result/floatingLegend";
import type { Language, TopPage } from "./shared/types";

import { UI_TEXT } from "./shared/uiText";
import type {
  AnnotationCondition,
  DatasetItem,
  DatasetResponse,
  DownloadTaskStatusResponse,
  HeatmapAggregateResponse,
  ModuleSuggestItem,
  SearchColumn,
  AnnotationColumnSearchResult,
  SuggestItem,
  TreeNodeSearchItem,
  TreeScopeOption as ApiTreeScopeOption,
} from "./types";

const AboutPage = lazy(() => import("./pages/AboutPage"));
const SavedQueriesPage = lazy(() => import("./pages/SavedQueriesPage"));
const loadResultVisualizations = () => import("./features/result/ResultVisualizations");
const CircularTreeView = lazy(() => loadResultVisualizations().then((module) => ({ default: module.CircularTreeView })));
const HeatmapSvg = lazy(() => loadResultVisualizations().then((module) => ({ default: module.HeatmapSvg })));
const RectangularTreeView = lazy(() => loadResultVisualizations().then((module) => ({ default: module.RectangularTreeView })));
const loadResultPanels = () => import("./features/result/ResultPanels");
const TreePanel = lazy(() => loadResultPanels().then((module) => ({ default: module.TreePanel })));
const HeatmapPanel = lazy(() => loadResultPanels().then((module) => ({ default: module.HeatmapPanel })));
const loadResultDialogs = () => import("./features/result/ResultDialogs");
const CandidateDialog = lazy(() => loadResultDialogs().then((module) => ({ default: module.CandidateDialog })));
const DownloadHeaderDialog = lazy(() => loadResultDialogs().then((module) => ({ default: module.DownloadHeaderDialog })));
const HeatmapBatchQueryDialog = lazy(() => loadResultDialogs().then((module) => ({ default: module.HeatmapBatchQueryDialog })));
const HeatmapQueryDialog = lazy(() => loadResultDialogs().then((module) => ({ default: module.HeatmapQueryDialog })));
const InsertColumnDialog = lazy(() => loadResultDialogs().then((module) => ({ default: module.InsertColumnDialog })));
const HeatmapColorScaleEditor = lazy(() => import("./features/result/HeatmapColorScaleEditor"));
const QueryScopeDialog = lazy(() => import("./features/query/QueryScopeDialog"));
const TreeSearchTool = lazy(() => import("./features/result/TreeSearchTool").then((module) => ({ default: module.TreeSearchTool })));

type ResizeTarget = "control";
type ResultPanelMode = "controls";

interface BranchPruneStateSnapshot {
  status: BranchPruneStatus;
  errorCode: BranchPruneErrorCode | null;
  errorDetail: string | null;
  summary: BranchPruneSummary | null;
}

type ShortcutGuardAction =
  | { kind: "reload" }
  | { kind: "return-home"; target: "home" | "query" | "examples" };

type LandingSectionTarget = "home" | "query" | "examples";

type HeatmapStyleDialogState = {
  open: boolean;
  paletteId: string;
  shape: PartitionShape;
  name: string;
  colorScales: HeatmapColorScales;
  metric: HeatmapMetric;
};

type TreeStyleDialogState = {
  open: boolean;
  nodeId: number | null;
  kind: TreeStyleKind;
  color: string;
};

const DEFAULT_TREE_VIEW_MODE: TreeViewMode = "circular";
const RECTANGULAR_FIT_PADDING = 40;
const RECTANGULAR_TAXON_ANNOTATION_GAP = 24;
const RECTANGULAR_TAXON_ANNOTATION_INSET = 36;

const CONTROL_DRAWER_DEFAULT_WIDTH = 640;
const CONTROL_DRAWER_MIN_WIDTH = 280;
const CONTROL_DRAWER_MAX_WIDTH = 1520;
const EMPTY_TREE_LAYOUT_NODES: TreeLayoutNode[] = [];
const EMPTY_VISIBLE_ROWS: VisibleRow[] = [];
const EMPTY_SELECTED_CELL_KEYS = new Set<string>();

function fallbackShapeForMode(mode: TreeViewMode): PartitionShape {
  const shapes = mode === "rectangular" ? RECTANGULAR_HEATMAP_SHAPES : CIRCULAR_HEATMAP_SHAPES;
  return shapes[0]?.value ?? (mode === "rectangular" ? "square" : "fill");
}

function splitCellKeyParts(key: string) {
  const separatorIndex = key.lastIndexOf("::");
  if (separatorIndex < 0) return null;
  return {
    rowId: key.slice(0, separatorIndex),
    columnKey: key.slice(separatorIndex + 2),
  };
}

function branchPruneErrorText(zh: boolean, code: BranchPruneErrorCode, detail: string | null) {
  switch (code) {
    case "empty_scope":
      return zh ? "当前没有可筛选的叶节点范围，请先重置范围。" : "There is no leaf scope left to filter. Reset the scope first.";
    case "empty_filters":
      return zh ? "请至少输入一个筛选条件。" : "Enter at least one filter condition.";
    case "invalid_min_completeness":
      return zh ? "最低完整度必须是大于或等于 0 的数字。" : "Min completeness must be a number greater than or equal to 0.";
    case "invalid_max_contamination":
      return zh ? "最高污染度必须是大于或等于 0 的数字。" : "Max contamination must be a number greater than or equal to 0.";
    case "invalid_min_quality":
      return zh ? "最低质量分数必须是大于或等于 0 的数字。" : "Min quality score must be a number greater than or equal to 0.";
    case "invalid_max_contig":
      return zh ? "最大 contig 数必须是大于或等于 0 的整数。" : "Max contig must be an integer greater than or equal to 0.";
    case "invalid_long_branch_iqr_multiplier":
      return zh ? "长分支 IQR 系数必须是大于 0 的数字。" : "Long-branch IQR multiplier must be a number greater than 0.";
    case "invalid_minimum_terminal_leaf_count":
      return zh ? "小分支阈值必须是大于或等于 1 的整数。" : "Small-branch threshold must be an integer greater than or equal to 1.";
    case "request_failed":
      return detail || (zh ? "分支筛选请求失败。" : "Branch pruning request failed.");
    default:
      return detail || "";
  }
}

function branchPruneSummaryText(zh: boolean, summary: BranchPruneSummary) {
  const action = summary.mode === "preview"
    ? (zh ? "预览" : "Preview")
    : (zh ? "已应用到当前物种树" : "Applied to the current tree");
  const details: string[] = [];
  if (summary.genomeMetadata) {
    details.push(zh ? `基因组元数据筛除了 ${summary.genomeMetadata.removedLeafCount} 个叶节点` : `genome metadata removed ${summary.genomeMetadata.removedLeafCount} leaf nodes`);
  }
  if (summary.longBranch) {
    details.push(zh ? `长分支筛选移除了 ${summary.longBranch.removedSourceCount} 个可见分支` : `long-branch pruning removed ${summary.longBranch.removedSourceCount} visible branches`);
  }
  if (summary.smallBranch) {
    details.push(zh ? `小分支筛选移除了 ${summary.smallBranch.removedSourceCount} 个可见分支` : `small-branch pruning removed ${summary.smallBranch.removedSourceCount} visible branches`);
  }
  if (!summary.removedLeafCount && !summary.previewSourceCount) {
    return zh
      ? `${action}：没有分支符合当前条件。范围仍保留 ${summary.keptLeafCount} 个叶节点和 ${summary.keptTerminalCount} 个末端分支。`
      : `${action}: no branches matched the current conditions. The scope still keeps ${summary.keptLeafCount} leaf nodes and ${summary.keptTerminalCount} terminal branches.`;
  }
  const detailText = details.length ? `${zh ? "；" : "; "}${details.join(zh ? "；" : "; ")}` : "";
  return zh
    ? `${action}：保留 ${summary.keptLeafCount}/${summary.currentScopeLeafCount} 个叶节点和 ${summary.keptTerminalCount}/${summary.currentTerminalCount} 个末端分支；${summary.previewSourceCount} 个可见分支将消失${detailText}。`
    : `${action}: kept ${summary.keptLeafCount}/${summary.currentScopeLeafCount} leaf nodes and ${summary.keptTerminalCount}/${summary.currentTerminalCount} terminal branches; ${summary.previewSourceCount} visible branches would disappear${detailText}.`;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().trim();
}

function isSubsequenceMatch(text: string, query: string) {
  if (!query) return false;
  let queryIndex = 0;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] === query[queryIndex]) {
      queryIndex += 1;
    }
  }
  return queryIndex === query.length;
}

function textMatchScore(label: string, query: string) {
  const normalized = normalizeSearchText(label);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalized || !normalizedQuery) return null;
  const compactLabel = normalized.replace(/[\s/_:.-]+/g, "");
  const compactQuery = normalizedQuery.replace(/[\s/_:.-]+/g, "");
  if (normalized === normalizedQuery || compactLabel === compactQuery) return 0;
  if (normalized.startsWith(normalizedQuery) || compactLabel.startsWith(compactQuery)) return 1;
  if (normalized.includes(normalizedQuery) || compactLabel.includes(compactQuery)) return 2;
  if (normalized.split(/[\s/_:.-]+/).some((token) => token.startsWith(normalizedQuery) || token.includes(normalizedQuery))) return 3;
  if (isSubsequenceMatch(compactLabel, compactQuery)) return 4;
  return null;
}

function sameTreeNodeSearchItem(left: TreeNodeSearchItem | null, right: TreeNodeSearchItem) {
  return Boolean(left && left.id === right.id && left.rank === right.rank && left.label === right.label);
}

function hashLeafNodeScope(leafNodeIds: number[]) {
  let hash = 0;
  leafNodeIds.forEach((leafNodeId) => {
    hash = (hash * 33 + leafNodeId) >>> 0;
    hash = (hash * 33 + 124) >>> 0;
  });
  return hash.toString(36);
}

function cartRecordId(nodeId: number, leafNodeIds: number[], isExactNodeScope: boolean) {
  if (isExactNodeScope) return `branch-cart-${nodeId}`;
  return `branch-cart-${nodeId}-scope-${hashLeafNodeScope(leafNodeIds)}`;
}

function App() {
  const [workbench, workbenchController] = useWorkbenchController(createWorkbenchReactState, () => true);
  const {
    canvasTreeRuntime, resultSession, columnSlots, selectedCells, heatmapStyles, treeStyles,
    treeViewMode, displayRank, stripRank, showStrip, taxonDisplayStyle, taxonNameDisplayMode, taxonLegendFontSize, rectangularTaxonLegendFontSize, circularTaxonLegendFontSize, heatmapLegendFontSize, rectangularHeatmapLegendFontSize, circularHeatmapLegendFontSize, branchScale, spacingScale,
    showStripLabels, stripMinimumLeafCount, showSpeciesCount,
    showBranchLabels, forceShowBranchLabels,
    forceShowStripLabels, forceShowSpeciesCount, branchStrokeWidth,
    rectangularFontProfile, circularFontProfile, rectangularStripColumnWidth, circularStripRingWidth,
    rectangularHeatmapColumnWidth: rectangularHeatmapColumnWidthSetting,
    circularHeatmapRingWidth,
    showInternalNodes, showBranchGuides, showBranchLengths, circularArcDegrees,
    circularRotationDegrees, localRankRules, customTerminalLabels, viewRoot,
    aliveBitset, cartAliveBitset, localRankConstraints,
    terminalNodeTable, showNumbers, ratioDisplayMode, heatmapMetric, heatmapShapeSize,
    columnLabelParts, branchCartRecords, branchCartBatches, activeModuleId,
    showModuleNames, showModuleFullName, showModuleCompleteness, showModuleDetail,
    moduleCompletenessThreshold,
  } = workbench;
  const setCanvasTreeRuntime = workbenchController.field("canvasTreeRuntime");
  const setResultSession = workbenchController.field("resultSession");
  const setColumnSlots = workbenchController.field("columnSlots");
  const setSelectedCells = workbenchController.field("selectedCells");
  const setHeatmapStyles = workbenchController.field("heatmapStyles");
  const setTreeStyles = workbenchController.field("treeStyles");
  const setTreeViewMode = workbenchController.field("treeViewMode");
  const setDisplayRank = workbenchController.field("displayRank");
  const setStripRank = workbenchController.field("stripRank");
  const setTaxonDisplayStyle = workbenchController.field("taxonDisplayStyle");
  const setTaxonNameDisplayMode = workbenchController.field("taxonNameDisplayMode");
  const setForceShowBranchLabels = workbenchController.field("forceShowBranchLabels");
  const setForceShowStripLabels = workbenchController.field("forceShowStripLabels");
  const setForceShowSpeciesCount = workbenchController.field("forceShowSpeciesCount");
  const setCircularRotationDegrees = workbenchController.field("circularRotationDegrees");
  const setLocalRankRules = workbenchController.field("localRankRules");
  const setCustomTerminalLabels = workbenchController.field("customTerminalLabels");
  const setViewRoot = workbenchController.field("viewRoot");
  const setTreeResetBaseline = workbenchController.field("treeResetBaseline");
  const setAliveBitset = workbenchController.field("aliveBitset");
  const setCartAliveBitset = workbenchController.field("cartAliveBitset");
  const setLocalRankConstraints = workbenchController.field("localRankConstraints");
  const setTerminalNodeTable = workbenchController.field("terminalNodeTable");
  const setBranchCartRecords = workbenchController.field("branchCartRecords");
  const setBranchCartBatches = workbenchController.field("branchCartBatches");
  const setActiveModuleId = workbenchController.field("activeModuleId");
  const setShowModuleFullName = workbenchController.field("showModuleFullName");
  const setShowModuleCompleteness = workbenchController.field("showModuleCompleteness");
  const setShowModuleDetail = workbenchController.field("showModuleDetail");
  const setModuleCompletenessThreshold = workbenchController.field("moduleCompletenessThreshold");
  const [language, setLanguage] = useState<Language>("zh");
  const [activePage, setActivePage] = useState<TopPage>("landing");
  const accountEmail = "local";
  const accountResolved = true;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savedQueryTitle, setSavedQueryTitle] = useState("");
  const [savedQueryCategoryId, setSavedQueryCategoryId] = useState<number | null>(null);
  const [saveCategoryDraftOpen, setSaveCategoryDraftOpen] = useState(false);
  const [saveCategoryName, setSaveCategoryName] = useState("");
  const [savedQueriesOpen, setSavedQueriesOpen] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQueryRecord[]>([]);
  const [savedQueryCategories, setSavedQueryCategories] = useState<SavedQueryCategory[]>([]);
  const [savedQueryAction, setSavedQueryAction] = useState<{ kind: "record" | "category"; id: number } | null>(null);
  const [restoredRecord, setRestoredRecord] = useState<{ id: number; record_version: number; title: string; category_id: number | null } | null>(null);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const savingWorkspaceRef = useRef(false);
  const restoringWorkspaceRef = useRef<AbortController | null>(null);
  const [isRestoringWorkspace, setIsRestoringWorkspace] = useState(false);
  const [preparedTreeLoad, setPreparedTreeLoad] = useState<TreeCoreLoadState | null>(null);
  const cameraByModeRef = useRef<WorkspaceViewDocument["cameras"]>({ rectangular: null, circular: null });
  const pendingCameraRestoreRef = useRef<SavedCamera | null>(null);
  const restoredCameraActiveRef = useRef(false);
  const [savedWorkspaceToken, setSavedWorkspaceToken] = useState<object | null>(null);
  const workspaceChangeTokenRef = useRef<object>({});
  const workspaceSessionRef = useRef(0);
  const pendingSaveAttemptRef = useRef<{ payload: SavedQueryPayload; encoded: string; target: number | null; token: object; session: number } | null>(null);
  const restoreCleanFramesRef = useRef(false);
  const taxonAnnotationRestoreKeyRef = useRef<string | null>(null);
  const [savedQueriesHasMore, setSavedQueriesHasMore] = useState(false);
  const [savedQueriesLoadingMore, setSavedQueriesLoadingMore] = useState(false);
  const controlPanelRef = useRef<HTMLDivElement | null>(null);
  const [controlPanelScrollTop, setControlPanelScrollTop] = useState(0);
  const resultPageEntryRef = useRef(false);
  const shouldConfirmWorkbenchExitRef = useRef(false);
  const homeBackgroundRgb: [number, number, number] = [255, 255, 255];
  const [resultPanelMode, setResultPanelMode] = useState<ResultPanelMode>("controls");
  const [queryMode, setQueryMode] = useState<"manual" | "batch">("manual");
  const [datasets, setDatasets] = useState<DatasetResponse | null>(null);
  const [activeDataset, setActiveDataset] = useState<DatasetItem | null>(null);
  const [homeScopeOptions, setHomeScopeOptions] = useState<ApiTreeScopeOption[]>([]);
  const [homeScopeOptionsLoading, setHomeScopeOptionsLoading] = useState(false);
  const [homeScopeSelection, setHomeScopeSelection] = useState<QueryScopePresetKey | null>(null);
  const [homeScopeDialogOpen, setHomeScopeDialogOpen] = useState(false);
  const [homeScopeVersion, setHomeScopeVersion] = useState(0);
  const [homeScopeSearchRank, setHomeScopeSearchRank] = useState("all");
  const [homeScopeSearch, setHomeScopeSearch] = useState("");
  const [homeScopePickedItem, setHomeScopePickedItem] = useState<TreeNodeSearchItem | null>(null);
  const [homeScopeExpandRank, setHomeScopeExpandRank] = useState("family");
  const [resultScopeDialogOpen, setResultScopeDialogOpen] = useState(false);
  const resultScopeDialogSnapshotRef = useRef<CartWorkspaceSnapshot | null>(null);
  const [resultScopeSearch, setResultScopeSearch] = useState("");
  const [resultScopeSearchRank, setResultScopeSearchRank] = useState("all");
  const [resultScopeExpandRank, setResultScopeExpandRank] = useState("family");
  const [resultScopePickedItem, setResultScopePickedItem] = useState<TreeNodeSearchItem | null>(null);
  const [resultScopeVersion, setResultScopeVersion] = useState(0);
  const homeScopeDialogSnapshotRef = useRef<CartWorkspaceSnapshot | null>(null);
  const homeDraftExecutorRef = useRef<HomeDraftExecutor | null>(null);
  if (!homeDraftExecutorRef.current) homeDraftExecutorRef.current = createHomeDraftExecutor();
  const homeDraftExecutor = homeDraftExecutorRef.current;
  const treeCoreLoadState = useTreeCoreBootstrap(activeDataset, preparedTreeLoad);
  const [conditions, setConditions] = useState<AnnotationCondition[]>([createCondition(0)]);
  const [batchQueryText, setBatchQueryText] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, SuggestItem[]>>({});
  const [moduleSuggestions, setModuleSuggestions] = useState<Record<string, ModuleSuggestItem[]>>({});
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [candidateConditionId, setCandidateConditionId] = useState<string | null>(null);
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const [hoveredColumnKey, setHoveredColumnKey] = useState<string | null>(null);
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel>("tree");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [branchPruneDraft, setBranchPruneDraft] = useState<BranchPruneDraft>({
    ...EMPTY_BRANCH_PRUNE_DRAFT,
  });
  const [detailRankAddOpen, setDetailRankAddOpen] = useState(false);
  const [branchPruneStatus, setBranchPruneStatus] = useState<BranchPruneStatus>("idle");
  const [branchPruneErrorCode, setBranchPruneErrorCode] = useState<BranchPruneErrorCode | null>(null);
  const [branchPruneErrorDetail, setBranchPruneErrorDetail] = useState<string | null>(null);
  const [branchPruneSummary, setBranchPruneSummary] = useState<BranchPruneSummary | null>(null);
  const [branchPrunePreviewNodeIds, setBranchPrunePreviewNodeIds] = useState<Set<number>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [pendingCenterNodeId, setPendingCenterNodeId] = useState<number | null>(null);
  const [treeSearch, setTreeSearch] = useState("");
  const [treeSearchRank, setTreeSearchRank] = useState("all");
  const [treeSearchPickedItem, setTreeSearchPickedItem] = useState<TreeNodeSearchItem | null>(null);
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);
  const [detailRankSearch, setDetailRankSearch] = useState("");
  const [detailRankSearchRank, setDetailRankSearchRank] = useState("all");
  const [detailRankPickedItem, setDetailRankPickedItem] = useState<TreeNodeSearchItem | null>(null);
  const [detailRankTargetRank, setDetailRankTargetRank] = useState("family");
  const [controlDrawerWidth, setControlDrawerWidth] = useState(CONTROL_DRAWER_DEFAULT_WIDTH);
  const [activeResizeTarget, setActiveResizeTarget] = useState<ResizeTarget | null>(null);
  const [downloadHeaderDialog, setDownloadHeaderDialog] = useState<{
    open: boolean;
    mode: "all" | "representative";
    fields: string[];
  }>({ open: false, mode: "all", fields: ["protein_name"] });
  const [isPreparingDownload, setIsPreparingDownload] = useState(false);
  const [downloadTaskProgress, setDownloadTaskProgress] = useState<DownloadTaskStatusResponse | null>(null);
  const [viewerDownloadMenuOpen, setViewerDownloadMenuOpen] = useState(false);
  const [columnMenu, setColumnMenu] = useState<ColumnMenuState>(emptyColumnMenu());
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState>({ open: false, x: 0, y: 0, nodeId: null, kind: null });
  const [insertDialog, setInsertDialog] = useState<InsertDialogState>(emptyInsertDialog());
  const [insertSuggestions, setInsertSuggestions] = useState<SuggestItem[]>([]);
  const [heatmapQueryDialogOpen, setHeatmapQueryDialogOpen] = useState(false);
  const [heatmapBatchQueryDialogOpen, setHeatmapBatchQueryDialogOpen] = useState(false);
  const [heatmapBatchQueryText, setHeatmapBatchQueryText] = useState("");
  const [heatmapQueryConditions, setHeatmapQueryConditions] = useState<AnnotationCondition[]>([createCondition(0)]);
  const [heatmapQuerySuggestionsById, setHeatmapQuerySuggestionsById] = useState<Record<string, SuggestItem[]>>({});
  const [heatmapModuleSuggestionsById, setHeatmapModuleSuggestionsById] = useState<Record<string, ModuleSuggestItem[]>>({});
  const [heatmapQueryActiveSuggestionId, setHeatmapQueryActiveSuggestionId] = useState<string | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [isHeatmapStyleSelecting, setIsHeatmapStyleSelecting] = useState(false);
  const [columnDragDraft, setColumnDragDraft] = useState<ColumnDragDraft | null>(null);
  const columnDragDraftRef = useRef<ColumnDragDraft | null>(null);
  const [heatmapLegend, setHeatmapLegend] = useState<HeatmapLegendState | null>(null);
  const [taxonAnnotation, setTaxonAnnotation] = useState<HeatmapLegendState | null>(null);
  const [heatmapStyleDialog, setHeatmapStyleDialog] = useState<HeatmapStyleDialogState>({
    open: false,
    paletteId: DEFAULT_PALETTE_ID,
    shape: fallbackShapeForMode(DEFAULT_TREE_VIEW_MODE),
    name: "",
    colorScales: defaultHeatmapColorScales(),
    metric: "count",
  });
  const [editingHeatmapStyleId, setEditingHeatmapStyleId] = useState<string | null>(null);
  const [treeStyleDialog, setTreeStyleDialog] = useState<TreeStyleDialogState>({ open: false, nodeId: null, kind: "label", color: "#D32F2F" });
  const [resetViewConfirmOpen, setResetViewConfirmOpen] = useState(false);
  const [treeStyleResetConfirmOpen, setTreeStyleResetConfirmOpen] = useState(false);
  const [pendingNameNodeId, setPendingNameNodeId] = useState<number | null>(null);
  const [pendingNameCollapseRank, setPendingNameCollapseRank] = useState<string | null>(null);
  const [customNameDraft, setCustomNameDraft] = useState("");
  const noticeSequenceRef = useRef(0);
  const [notice, setNotice] = useState<{ id: number; kind: NoticeKind; message: string } | null>(null);
  const showNotice = useCallback((kind: NoticeKind, message: string) => {
    noticeSequenceRef.current += 1;
    setNotice({ id: noticeSequenceRef.current, kind, message });
  }, []);
  const setError = useCallback((message: string | null) => {
    if (message) showNotice("error", message);
    else setNotice(null);
  }, [showNotice]);
  const [pendingShortcutGuard, setPendingShortcutGuard] = useState<ShortcutGuardAction | null>(null);
  const [standardHeatmapAggregate, setStandardHeatmapAggregate] = useState<HeatmapAggregateResponse | null>(null);
  const heatmapAggregateCacheRef = useRef<HeatmapAggregateCacheEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAppendingHeatmapQueries, setIsAppendingHeatmapQueries] = useState(false);
  const [renderNotice, setRenderNotice] = useState("");
  const [viewportSnapshot, viewportController] = useViewportController();
  const {
    zoom: viewZoom,
    offset: viewOffset,
    viewport: viewerViewport,
  } = viewportSnapshot;
  const setViewZoom = viewportController.setZoom;
  const setViewOffset = viewportController.setOffset;
  const setViewerViewport = viewportController.setViewport;
  const setRectangularAutoFitZoom = (value: Parameters<typeof viewportController.setModeFitScale>[1]) => viewportController.setModeFitScale("rectangular", value);
  const setCircularAutoFitZoom = (value: Parameters<typeof viewportController.setModeFitScale>[1]) => viewportController.setModeFitScale("circular", value);
  const setFitZoom = viewportController.setFitZoom;
  const setInteractionZoom = viewportController.setInteractionZoom;
  const setPendingFit = viewportController.setPendingFit;
  const setResetCircularFitReference = viewportController.setResetCircularFitReference;
  const setFitSettled = viewportController.setFitSettled;
  const setPreviousCircularSize = viewportController.setPreviousCircularSize;
  const [isPanning, setIsPanning] = useState(false);
  const [ctrlDown, setCtrlDown] = useState(false);
  const uiText = UI_TEXT[language];

  useEffect(() => {
    if (!accountResolved || !accountEmail) return;
    const task = getActiveSequenceDownloadTask(accountEmail);
    if (!task) return;

    const controller = new AbortController();
    setError(null);
    setIsPreparingDownload(true);
    setDownloadTaskProgress({
      task_id: task.task_id,
      status: "queued",
      stage: "queued",
      completed_files: 0,
      total_files: 0,
    });
    setDownloadHeaderDialog((current) => ({ ...current, open: true }));
    void waitForSequenceDownload(task, setDownloadTaskProgress, 1000, accountEmail, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const downloadLink = document.createElement("a");
      downloadLink.href = result.download_url;
      downloadLink.download = "";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted || (requestError instanceof Error && requestError.name === "AbortError")) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "Download failed");
    }).finally(() => {
      if (controller.signal.aborted) return;
      setIsPreparingDownload(false);
      setDownloadTaskProgress(null);
      setDownloadHeaderDialog((current) => ({ ...current, open: false }));
    });

    return () => {
      controller.abort();
    };
  }, [accountEmail, accountResolved]);

  useEffect(() => {
    const handlePopState = () => {
      if (!resultPageEntryRef.current) return;
      if (shouldConfirmWorkbenchExitRef.current) {
        window.history.pushState({ page: "result" }, "", window.location.href);
        setPendingShortcutGuard({ kind: "return-home", target: "home" });
        return;
      }
      resultPageEntryRef.current = false;
      resetToLandingSection("home");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const scenePlanStore = useRef(createScenePlanStore()).current;
  const publishScenePlan = useCallback((plan: FigureScenePlan) => {
    scenePlanStore.publish(plan);
  }, [scenePlanStore]);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const viewerContentRef = useRef<HTMLDivElement | null>(null);
  const heatmapLegendRef = useRef<HTMLDivElement | null>(null);
  const taxonAnnotationRef = useRef<HTMLDivElement | null>(null);
  const panDraftRef = useRef<PanDraft | null>(null);
  const panAnimationFrameRef = useRef<number | null>(null);
  const heatmapLegendDraftRef = useRef<FloatingLegendInteractionDraft | null>(null);
  const taxonAnnotationDraftRef = useRef<FloatingLegendInteractionDraft | null>(null);
  const resizeDraftRef = useRef<{ target: ResizeTarget; startX: number; startWidth: number } | null>(null);
  const previousTreeViewModeRef = useRef<TreeViewMode>(treeViewMode);
  const previousDisplayRankRef = useRef(displayRank);
  const previousRenderDatasetRef = useRef("");
  const previousViewerFitViewportRef = useRef("");
  const initializedTreeRuntimeRef = useRef<unknown>(null);

  useLayoutEffect(() => {
    const viewport = viewerScrollRef.current;
    if (!viewport) return;
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = viewport.getBoundingClientRect();
        const next = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
        setViewerViewport((current) => current.width === next.width && current.height === next.height ? current : next);
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [activePage]);
  const preserveTerminalTableRuntimeRef = useRef<AliveTreeRuntime | null>(null);
  const viewerFitConvergenceRef = useRef({ iteration: 0, lastLayoutKey: null as string | null, lastZoom: null as number | null });
  const heatmapAggregateRequestIdRef = useRef(0);
  const allowBrowserUnloadRef = useRef(false);
  const suppressColumnClickRef = useRef<string | null>(null);
  const selectionDraftRef = useRef<SelectionDraft | null>(null);
  const marqueeBoxRef = useRef<HTMLDivElement | null>(null);
  const marqueeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeResizeTarget) return;

    const handlePointerMove = (event: PointerEvent) => {
      const draft = resizeDraftRef.current;
      if (!draft) return;
      const nextWidth = draft.startWidth + (draft.startX - event.clientX);
      const viewportMax = Math.max(CONTROL_DRAWER_MIN_WIDTH, window.innerWidth - 160);
      const maxWidth = Math.min(CONTROL_DRAWER_MAX_WIDTH, viewportMax);
      setControlDrawerWidth(clamp(nextWidth, CONTROL_DRAWER_MIN_WIDTH, maxWidth));
    };

    const handlePointerUp = () => {
      resizeDraftRef.current = null;
      setActiveResizeTarget(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [activeResizeTarget]);

  const validConditions = useMemo(() => conditions.filter((item) => item.value.trim()), [conditions]);
  const parsedBatchConditions = useMemo(() => parseBatchQuery(batchQueryText), [batchQueryText]);
  const workspaceChangeToken = useMemo(() => ({}), [workbench, drawerPanel, drawerOpen, controlDrawerWidth,
    viewZoom, viewOffset, heatmapLegend, taxonAnnotation, selectedNodeId, controlPanelScrollTop,
    queryMode, conditions, batchQueryText, branchPruneDraft, treeSearch, treeSearchRank, treeSearchPickedItem,
    detailRankSearch, detailRankSearchRank, detailRankTargetRank, heatmapQueryConditions, heatmapBatchQueryText,
    resultScopeSearch, resultScopeSearchRank, resultScopeExpandRank, customNameDraft,
    pendingNameNodeId, pendingNameCollapseRank, heatmapStyleDialog, editingHeatmapStyleId, treeStyleDialog]);
  workspaceChangeTokenRef.current = workspaceChangeToken;
  useEffect(() => {
    if (!restoreCleanFramesRef.current || pendingCameraRestoreRef.current) return;
    const first = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!restoreCleanFramesRef.current) return;
        restoreCleanFramesRef.current = false;
        setSavedWorkspaceToken(workspaceChangeTokenRef.current);
      });
    });
    return () => window.cancelAnimationFrame(first);
  }, [workspaceChangeToken]);

  const hasQueryDraft = useMemo(() => {
    if (queryMode === "batch") {
      return Boolean(batchQueryText.trim());
    }
    return conditions.some((condition) => (
      Boolean(condition.value.trim())
      || condition.selected !== null
      || condition.moduleSelected !== null
    ));
  }, [batchQueryText, conditions, queryMode]);
  const hasWorkbenchProgress = useMemo(() => (
    activePage === "result"
    || resultSession !== null
    || selectedCells.size > 0
    || branchCartRecords.length > 0
    || localRankRules.length > 0
  ), [
    activePage,
    branchCartRecords.length,
    localRankRules.length,
    resultSession,
    selectedCells,
  ]);
  const shouldConfirmPageExit = isSearching || Boolean(renderNotice) || hasQueryDraft || hasWorkbenchProgress;
  const shouldConfirmHomeNavigation = isSearching || Boolean(renderNotice) || hasWorkbenchProgress;
  useEffect(() => {
    shouldConfirmWorkbenchExitRef.current = shouldConfirmHomeNavigation;
  }, [shouldConfirmHomeNavigation]);
  useEffect(() => {
    if (treeCoreLoadState.status === "ready" && initializedTreeRuntimeRef.current === treeCoreLoadState.session.rawTree) return;
    setCanvasTreeRuntime(treeCoreLoadState.status === "ready" ? treeCoreLoadState.session.aliveTree : null);
  }, [treeCoreLoadState]);
  const treeModel = useMemo(() => {
    if (treeCoreLoadState.status !== "ready" || !activeDataset) {
      return null;
    }
    if (
      treeCoreLoadState.session.summary.species_tree !== activeDataset.species_tree
      || treeCoreLoadState.session.summary.genome_database !== activeDataset.genome_database
    ) {
      return null;
    }
    const runtime = canvasTreeRuntime
      && canvasTreeRuntime.dataset.species_tree === activeDataset.species_tree
      && canvasTreeRuntime.dataset.genome_database === activeDataset.genome_database
      ? canvasTreeRuntime
      : treeCoreLoadState.session.aliveTree;
    return createTreeCoreViewModel(runtime);
  }, [activeDataset, canvasTreeRuntime, treeCoreLoadState]);
  const rawTreeModel = useMemo(() => {
    if (treeCoreLoadState.status !== "ready" || !activeDataset) return null;
    if (
      treeCoreLoadState.session.summary.species_tree !== activeDataset.species_tree
      || treeCoreLoadState.session.summary.genome_database !== activeDataset.genome_database
    ) return null;
    return createTreeCoreViewModel(treeCoreLoadState.session.rawTree);
  }, [activeDataset, treeCoreLoadState]);
  const defaultRerootSpec = useMemo(
    () => rawTreeModel ? createDefaultRerootSpec(rawTreeModel.runtime) : null,
    [rawTreeModel],
  );
  const isCanvasRerooted = useMemo(() => Boolean(
    defaultRerootSpec
    && canvasTreeRuntime
    && !rerootSpecsEqual(canvasTreeRuntime.rerootSpec, defaultRerootSpec)
  ), [canvasTreeRuntime, defaultRerootSpec]);
  useEffect(() => {
    if (!treeModel || !rawTreeModel) {
      setAliveBitset(null);
      setCartAliveBitset(null);
      setLocalRankRules([]);
      setLocalRankConstraints([]);
      setTerminalNodeTable([]);
      initializedTreeRuntimeRef.current = null;
      return;
    }
    // A view model may be recreated while React renders.  Initialization is
    // tied to the immutable tree-core runtime, not to a view-model reference.
    if (initializedTreeRuntimeRef.current === rawTreeModel.runtime) return;
    initializedTreeRuntimeRef.current = rawTreeModel.runtime;
    setAliveBitset(createFullAliveBitset(treeModel.nodeCount));
    setCartAliveBitset(new Uint8Array(rawTreeModel?.nodeCount ?? treeModel.nodeCount));
    setLocalRankRules([]);
    setLocalRankConstraints([]);
    setTerminalNodeTable([]);
  }, [rawTreeModel, treeModel]);

  const moduleQueryInfo = useMemo(
    () => (resultSession?.module_groups?.length ? { enabled: true, modules: resultSession.module_groups } : null),
    [resultSession?.module_groups],
  );
  const isModuleResult = Boolean(moduleQueryInfo);
  const activeModule = useMemo(
    () => moduleQueryInfo?.modules.find((module) => module.module_id === activeModuleId) ?? moduleQueryInfo?.modules[0] ?? null,
    [activeModuleId, moduleQueryInfo?.modules],
  );
  const rowHeight = useMemo(() => BASE_ROW_HEIGHT * spacingScale, [spacingScale]);
  const fullTreeLeafNodeIds = useMemo(() => {
    if (!treeModel) return [] as number[];
    return treeModel.materializeLeafNodeIds(treeModel.rootId)
      .sort((left, right) => left - right);
  }, [treeModel]);
  // `null` only exists during tree-core/bootstrap hand-off.  Its display
  // meaning is the untouched full tree; an intentionally empty result is an
  // allocated all-zero bitmap and must remain distinguishable from this case.
  const effectiveAliveBitset = useMemo(
    () => (treeModel ? aliveBitset ?? createFullAliveBitset(treeModel.nodeCount) : null),
    [aliveBitset, treeModel],
  );
  const currentAliveLeafNodeScope = useMemo(
    () => treeModel && effectiveAliveBitset
      ? leafNodeIdsFromAliveBitset(treeModel, effectiveAliveBitset)
      : fullTreeLeafNodeIds,
    [effectiveAliveBitset, fullTreeLeafNodeIds, treeModel],
  );
  const rederivedTerminalNodeTable = useMemo(
    () => treeModel && effectiveAliveBitset
      ? buildTerminalNodeTable(treeModel, effectiveAliveBitset, displayRank, localRankConstraints, viewRoot)
      : [],
    [displayRank, effectiveAliveBitset, localRankConstraints, treeModel, viewRoot],
  );
  useEffect(() => {
    if (preserveTerminalTableRuntimeRef.current === treeModel?.runtime) {
      preserveTerminalTableRuntimeRef.current = null;
      return;
    }
    if (!terminalNodeTable.length && currentAliveLeafNodeScope.length && viewRoot === null) setTerminalNodeTable(rederivedTerminalNodeTable);
  }, [rederivedTerminalNodeTable, treeModel?.runtime]);
  const treeProjection = useMemo(
    () => treeModel && effectiveAliveBitset
      ? buildTreeProjection(treeModel, effectiveAliveBitset, terminalNodeTable, viewRoot, rowHeight)
      : null,
    [effectiveAliveBitset, rowHeight, terminalNodeTable, treeModel, viewRoot],
  );
  const terminalCutSnapshot = useMemo(() => createTerminalCutSnapshot(terminalNodeTable), [terminalNodeTable]);
  const semanticVisibleRows = treeProjection?.visibleRows ?? EMPTY_VISIBLE_ROWS;
  const visibleScopeLeafNodeIds = terminalCutSnapshot.scopeLeafNodeIds;
  const terminalHeatmapKey = terminalCutSnapshot.aggregationRowsKey;
  const treeLayoutNodes = treeProjection?.treeLayoutNodes ?? EMPTY_TREE_LAYOUT_NODES;
  const visibleRows = treeProjection?.visibleRows ?? EMPTY_VISIBLE_ROWS;
  const terminalBands = useMemo(() => buildTerminalBands(visibleRows, rowHeight), [rowHeight, visibleRows]);
  // The control-panel table is a view of the actual local constraints.  It
  // must never depend on the former draft-only detail-rule state.
  const localRankTableRows = useMemo(() => {
    if (!treeModel) return [];
    const groups = new Map<string, LocalRankRule[]>();
    localRankRules.forEach((rule) => {
      const identity = taxonScopeIdentityForNode(treeModel.runtime, rule);
      const key = identity ? `${identity.taxonRank}\u0000${identity.taxonNameNorm}` : `node\u0000${rule.nodeId}`;
      const group = groups.get(key) ?? [];
      group.push(rule);
      groups.set(key, group);
    });
    return Array.from(groups.values()).map((rules) => {
      const rule = rules[0];
      const identity = taxonScopeIdentityForNode(treeModel.runtime, rule);
      const labelRank = identity?.taxonRank ?? branchRank(treeModel, rule.nodeId, rule.expandRank);
      return {
        nodeId: rule.nodeId,
        taxonRank: identity?.taxonRank ?? labelRank,
        taxonName: identity?.taxonName ?? sourceLabel(treeModel, rule.nodeId, labelRank),
        path: taxonomyPath(treeModel, rule.nodeId),
        rank: rule.expandRank,
        enabled: rules.every((item) => item.enabled),
      };
    });
  }, [localRankRules, treeModel]);
  const branchPruneActive = useMemo(
    () => Boolean(treeModel && effectiveAliveBitset && currentAliveLeafNodeScope.length < treeModel.leafCount),
    [currentAliveLeafNodeScope.length, effectiveAliveBitset, treeModel],
  );
  const branchPruneFeedback = useMemo(() => {
    const zh = language === "zh";
    if (branchPruneStatus === "error" && branchPruneErrorCode) {
      return {
        tone: "error" as const,
        text: branchPruneErrorText(zh, branchPruneErrorCode, branchPruneErrorDetail),
      };
    }

    if (branchPruneStatus === "ready" && branchPruneSummary) {
      return {
        tone: "ready" as const,
        text: branchPruneSummaryText(zh, branchPruneSummary),
      };
    }

    return null;
  }, [branchPruneErrorCode, branchPruneErrorDetail, branchPruneStatus, branchPruneSummary, language]);
  useEffect(() => {
    // Keep the same state object when there is nothing to clear. This effect
    // also runs while tree-core is loading, so an unconditional new Set()
    // would create a render loop before the first projection exists.
    setBranchPrunePreviewNodeIds((current) => current.size ? new Set() : current);
  }, [branchPruneDraft, semanticVisibleRows]);
  const activeStripRank = showStrip ? stripRank : "none";
  const rectangularHeatmapUsesSquareCells = useMemo(
    () => stylesRequireSquareCells(heatmapStyles),
    [heatmapStyles],
  );
  // Graphic units are reference CSS pixels. Fit/reference zoom belongs to
  // camera fitting only; it must not create a second mode-specific font unit.
  const graphicUnitScale = 1;
  const rectangularHeatmapColumnWidth = resolveRectangularColumnWidthWorld({
    preferredPx: rectangularHeatmapColumnWidthSetting,
    documentScale: graphicUnitScale,
    rowHeightWorld: rowHeight,
    shapeLocked: rectangularHeatmapUsesSquareCells,
  });
  const viewerViewportWidth = viewerViewport.width;
  const viewerViewportHeight = viewerViewport.height;
  const viewerViewportShortSide = Math.min(viewerViewportWidth, viewerViewportHeight);
  const effectiveCircularHeatmapRingWidth = resolveScreenLockedWorldLength(circularHeatmapRingWidth, graphicUnitScale);
  const rectangularStripColumnWidthWorld = resolveScreenLockedWorldLength(rectangularStripColumnWidth, graphicUnitScale);
  const circularStripRingWidthWorld = resolveScreenLockedWorldLength(circularStripRingWidth, graphicUnitScale);
  const heatmapColumnWidth = treeViewMode === "rectangular" ? rectangularHeatmapColumnWidth : effectiveCircularHeatmapRingWidth;
  const activeHeatmapColumnWidthPx = treeViewMode === "rectangular"
    ? (rectangularHeatmapUsesSquareCells ? worldToScreenPx(rowHeight, graphicUnitScale) : rectangularHeatmapColumnWidthSetting)
    : circularHeatmapRingWidth;
  const activeStripWidth = treeViewMode === "rectangular" ? rectangularStripColumnWidth : circularStripRingWidth;
  const circularArcRadians = useMemo(() => Math.PI * 2 * clamp(circularArcDegrees, 180, 360) / 360, [circularArcDegrees]);
  const circularMinimumTreePartitionRadius = useMemo(() => {
    return Math.max(1, resolveCircularNodeRadii(treeLayoutNodes, 1).treeDepth);
  }, [treeLayoutNodes]);
  const circularBranchScale = circularBranchRenderValue(branchScale);
  const circularNodeRadii = useMemo(
    () => resolveCircularNodeRadii(treeLayoutNodes, circularBranchScale),
    [circularBranchScale, treeLayoutNodes],
  );
  const circularAngularLayout = useMemo(
    () => resolveCircularAngularLayout({
      treeNodes: treeLayoutNodes,
      visibleRows,
      arcDegrees: circularArcDegrees,
      rotationDegrees: circularRotationDegrees,
    }),
    [circularArcDegrees, circularRotationDegrees, treeLayoutNodes, visibleRows],
  );
  const circularBranchStrokeWidth = circularBranchRenderValue(branchStrokeWidth);
  const circularTreeOuterRadius = Math.max(1, circularMinimumTreePartitionRadius * circularBranchScale);
  const rectangularBranchName = resolveVisualSize(rectangularFontProfile.branchLabel, rowHeight, graphicUnitScale);
  const rectangularSpeciesCount = resolveVisualSize(rectangularFontProfile.speciesCount, rowHeight, graphicUnitScale);
  const rectangularBranchLength = resolveVisualSize(rectangularFontProfile.branchLength, rowHeight, graphicUnitScale);
  const rectangularStripLabel = resolveVisualSize(rectangularFontProfile.stripLabel, rowHeight, graphicUnitScale);
  const rectangularHeatmapValue = resolveVisualSize(rectangularFontProfile.heatmapValue, Math.min(rowHeight, rectangularHeatmapColumnWidth), graphicUnitScale);
  const rectangularColumnLabel = resolveVisualSize(rectangularFontProfile.heatmapColumnLabel, rectangularHeatmapColumnWidth, graphicUnitScale);
  const rectangularModuleLabelFontSize = resolveScreenLockedWorldLength(rectangularFontProfile.moduleLabel, graphicUnitScale);
  const circularBranchNameBaseLimitWorld = circularFontLimits({
    arcRadians: circularArcRadians,
    terminalCount: visibleRows.length,
    treeOuterRadius: circularTreeOuterRadius,
    speciesCountRadius: circularTreeOuterRadius,
  }).branchName;
  const circularBranchNameBase = resolveVisualSize(circularFontProfile.branchLabel, circularBranchNameBaseLimitWorld, graphicUnitScale, 1);
  const circularBranchLabelBaseRadialLength = useMemo(
    () => visibleRows.reduce(
      (max, row) => Math.max(max, circularLabelWidth(row.label, circularBranchNameBase.world)),
      circularBranchNameBase.world,
    ),
    [circularBranchNameBase.world, visibleRows],
  );
  const circularBranchLabelRadius = circularTreeOuterRadius
    + circularBranchLabelBaseRadialLength
    + circularBranchNameBase.world * 1.6;
  const circularBranchNameLimitWorld = circularFontLimits({
    arcRadians: circularArcRadians,
    terminalCount: visibleRows.length,
    treeOuterRadius: circularTreeOuterRadius,
    branchLabelRadius: circularBranchLabelRadius,
    speciesCountRadius: circularTreeOuterRadius,
  }).branchName;
  const circularBranchName = resolveVisualSize(circularFontProfile.branchLabel, circularBranchNameLimitWorld, graphicUnitScale, 1);
  const circularBranchLabelRadialLength = useMemo(
    () => visibleRows.reduce(
      (max, row) => Math.max(max, circularLabelWidth(row.label, circularBranchName.world)),
      circularBranchName.world,
    ),
    [circularBranchName.world, visibleRows],
  );
  const circularSpeciesCountRadius = circularTreeOuterRadius
    + circularBranchLabelRadialLength
    + circularBranchName.world * 1.6;
  const circularSpeciesCountLimitWorld = circularFontLimits({
    arcRadians: circularArcRadians,
    terminalCount: visibleRows.length,
    treeOuterRadius: circularTreeOuterRadius,
    speciesCountRadius: circularSpeciesCountRadius,
  }).speciesCount;
  const circularSpeciesCount = resolveVisualSize(circularFontProfile.speciesCount, circularSpeciesCountLimitWorld, graphicUnitScale, 1);
  const circularBranchLength = resolveVisualSize(circularFontProfile.branchLength, circularBranchNameLimitWorld, graphicUnitScale, 1);
  const circularStripLabel = resolveVisualSize(circularFontProfile.stripLabel, circularBranchNameLimitWorld, graphicUnitScale, 1);
  const circularHeatmapValue = resolveVisualSize(circularFontProfile.heatmapValue, effectiveCircularHeatmapRingWidth, graphicUnitScale);
  const circularColumnLabel = resolveVisualSize(circularFontProfile.heatmapColumnLabel, effectiveCircularHeatmapRingWidth, graphicUnitScale);
  const circularModuleLabelFontSize = resolveScreenLockedWorldLength(circularFontProfile.moduleLabel, graphicUnitScale);
  const activeFontProfile = treeViewMode === "circular" ? circularFontProfile : rectangularFontProfile;
  const activeResolvedFonts = treeViewMode === "circular"
    ? {
        branchLabel: circularBranchName,
        branchLength: circularBranchLength,
        speciesCount: circularSpeciesCount,
        stripLabel: circularStripLabel,
        heatmapValue: circularHeatmapValue,
        heatmapColumnLabel: circularColumnLabel,
      }
    : {
        branchLabel: rectangularBranchName,
        branchLength: rectangularBranchLength,
        speciesCount: rectangularSpeciesCount,
        stripLabel: rectangularStripLabel,
        heatmapValue: rectangularHeatmapValue,
        heatmapColumnLabel: rectangularColumnLabel,
      };
  const branchNameFontMax = activeResolvedFonts.branchLabel.maxPx;
  const speciesCountFontMax = activeResolvedFonts.speciesCount.maxPx;
  const columnLabelFontMax = activeResolvedFonts.heatmapColumnLabel.maxPx;
  const speciesCountFontSize = activeResolvedFonts.speciesCount.world;
  const stripNameFontSize = activeResolvedFonts.stripLabel.world;
  const branchLabelFontSize = activeResolvedFonts.branchLabel.world;
  const branchLengthFontSize = activeResolvedFonts.branchLength.world;
  const heatmapNumberFontSize = activeResolvedFonts.heatmapValue.world;
  const columnLabelFontSize = activeResolvedFonts.heatmapColumnLabel.world;
  const moduleLabelFontSize = treeViewMode === "circular" ? circularModuleLabelFontSize : rectangularModuleLabelFontSize;
  const speciesFontSize = speciesCountFontSize;
  const stripLabelFontSize = stripNameFontSize;
  const treeLabelFontSize = branchLabelFontSize;
  const branchMetricFontSize = branchLengthFontSize;
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.info("[font-measurement]", {
        mode: treeViewMode,
        activeFontProfileBranchLabel: activeFontProfile.branchLabel,
        effectivePx: activeResolvedFonts.branchLabel.effectivePx,
        world: activeResolvedFonts.branchLabel.world,
        viewZoom,
        screenFontPx: branchLabelFontSize * viewZoom,
      });
    }
  }, [activeFontProfile.branchLabel, activeResolvedFonts.branchLabel.effectivePx, activeResolvedFonts.branchLabel.world, branchLabelFontSize, treeViewMode, viewZoom]);
  const heatmapValueFontSize = heatmapNumberFontSize;
  const showSpeciesLayer = showSpeciesCount;
  const maxVisibleSpeciesCount = useMemo(() => Math.max(...visibleRows.map((row) => row.ownedLeafNodeIds.length), 1), [visibleRows]);
  const taxonColorPlan = useMemo(() => createTaxonColorPlan(compileRenderTaxonomyGroups({
    visibleRows,
    treeLayoutNodes,
    treeModel,
    activeStripRank: stripRank,
  })), [stripRank, treeLayoutNodes, treeModel, visibleRows]);
  const visibleStripGroups = useMemo(
    () => visibleTaxonColorGroups(taxonColorPlan, stripMinimumLeafCount),
    [stripMinimumLeafCount, taxonColorPlan],
  );
  useEffect(() => {
    if (!showStrip || stripRank === "none") {
      setTreeStyles((current) => current.some((style) => style.source === "taxon") ? current.filter((style) => style.source !== "taxon") : current);
      return;
    }
    const colorByLabel = new Map(visibleStripGroups.map((group) => [group.label, taxonColorPlan.assignments.get(group.label)?.color ?? "#000000"]));
    setTreeStyles((current) => syncTaxonStyles(current, visibleStripGroups, stripRank, (label) => colorByLabel.get(label) ?? "#000000", taxonDisplayStyle));
  }, [showStrip, stripRank, taxonColorPlan, taxonDisplayStyle, visibleStripGroups]);
  const taxonLegendItems = useMemo(() => {
    const items = new Map<string, { label: string; color: string }>();
    visibleStripGroups.forEach((group) => {
      const style = treeStyles.find((candidate) => candidate.kind === taxonDisplayStyle && treeStyleMatchesTaxon(candidate, stripRank, group.label));
      const assigned = taxonColorPlan.assignments.get(group.label)?.color;
      const color = style?.color ?? assigned;
      if (color) items.set(group.label, { label: group.label, color: taxonStyleColorCss(color, "legend") });
    });
    return Array.from(items.values());
  }, [stripRank, taxonDisplayStyle, treeStyles, visibleStripGroups]);
  const stripGroupCount = visibleStripGroups.length;
  const hasVisibleTreeStyleStrip = useMemo(() => {
    const visibleNodeIds = new Set(visibleRows.map((row) => row.nodeId));
    return treeStyles.some((style) => style.kind === "strip" && style.nodeIds.some((nodeId) => visibleNodeIds.has(nodeId)));
  }, [treeStyles, visibleRows]);
  const hasRectangularStrip = hasVisibleTreeStyleStrip || (activeStripRank !== "none" && taxonDisplayStyle === "strip");
  const treeLayout = useMemo(() => {
    const terminals = treeLayoutNodes.filter((node) => node.kind !== "internal");
    const rootX = treeLayoutNodes.find((node) => node.parent === null)?.x ?? 0;
    const terminalMaxX = Math.max(...terminals.map((node) => node.x), rootX + 1);
    const maxX = scaleBranchCoordinate(rootX, terminalMaxX, branchScale);
    const labelX = maxX + 34;
    const maxLabelWidth = showBranchLabels
      ? visibleRows.reduce((max, row) => Math.max(max, row.label.length * treeLabelFontSize * 0.58 + treeLabelFontSize + 36), 208)
      : 0;
    const labelColumnWidth = showBranchLabels ? clamp(maxLabelWidth, 208, 2200) : 0;
    const speciesCountWidth = showSpeciesLayer
      ? clamp(String(maxVisibleSpeciesCount).length * speciesFontSize * 0.62 + 44, 72, 420)
      : 0;
    const stripLabelWidth = taxonNameDisplayMode === "embedded" && activeStripRank !== "none" && treeModel
      ? clamp(
          visibleStripGroups.reduce((max, group) => Math.max(max, group.label.length * stripLabelFontSize * 0.58 + stripLabelFontSize + 34), 140),
          140,
          1400,
        )
      : 0;
    const scene = speciesTreeRenderer.buildDrawPlan({
      mode: "rectangular",
      rootAnchor: { x: rootX, y: 0 },
      bounds: { left: rootX, top: 0, right: labelX + labelColumnWidth, bottom: Math.max(1, visibleRows.length) },
      terminalCount: visibleRows.length,
      partition: {
        root: rootX,
        treeContent: Math.max(TREE_WIDTH - rootX, (labelX - rootX) + labelColumnWidth),
        stripContent: speciesCountWidth + (hasRectangularStrip ? rectangularStripColumnWidthWorld + 8 : 0) + stripLabelWidth,
        heatmapContent: 0,
        treeToStripGap: 24,
        stripToHeatmapGap: 32,
      },
    });
    const partitions = scene.partitions;
    const speciesCountX = partitions.strip.start;
    const stripX = speciesCountX + speciesCountWidth + (speciesCountWidth ? 12 : 0);
    const treeWidth = partitions.heatmap.start;
    return { labelX, labelTextBudget: labelColumnWidth, speciesCountX, stripX, stripWidth: rectangularStripColumnWidthWorld, stripLabelWidth, treeWidth };
  }, [activeStripRank, branchScale, hasRectangularStrip, maxVisibleSpeciesCount, treeLayoutNodes, showBranchLabels, showSpeciesLayer, speciesFontSize, rectangularStripColumnWidthWorld, stripLabelFontSize, taxonDisplayStyle, taxonNameDisplayMode, treeModel, treeLabelFontSize, treeStyles, visibleRows, visibleStripGroups]);
  const normalizedColumnSlots = useMemo(
    () => (resultSession ? normalizeHeatmapColumnSlots(columnSlots, resultSession.columns) : []),
    [columnSlots, resultSession],
  );
  const displayColumns = useMemo(() => {
    if (!resultSession) return [];
    const columnsByKey = new Map(resultSession.columns.map((column) => [normalizeColumnKey(column), column]));
    const visibleColumnKeys = new Set(
      resultSession.columns
        .filter((column) => (showModuleCompleteness || !isModuleCompletenessColumn(column)) && (showModuleDetail || !isModuleDetailColumn(column)))
        .map(normalizeColumnKey),
    );
    const projectedSlots = visibleHeatmapColumnSlots(normalizedColumnSlots, visibleColumnKeys);
    const labelCounts = new Map<string, number>();
    const usedLabels = new Map<string, number>();
    const labelPartValue = (column: SearchColumn, part: ColumnLabelPart) => columnLabelPartValue(column, part);
    if (!isModuleResult) {
      projectedSlots.forEach((slot) => {
        if (!slot.columnKey) return;
        const column = columnsByKey.get(slot.columnKey);
        if (!column) return;
        const label = columnLabelParts
          .map((part) => labelPartValue(column, part))
          .filter(Boolean)
          .join(":");
        if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      });
    }
    return projectedSlots
      .map((slot): DisplayColumn | null => {
        const column = columnsByKey.get(slot.columnKey);
        if (!column) return null;
        const label = columnLabelParts
          .map((part) => labelPartValue(column, part))
          .filter(Boolean)
          .join(":");
        let displayLabel = label;
        if (!isModuleResult && label) {
          const nextCount = (usedLabels.get(label) ?? 0) + 1;
          usedLabels.set(label, nextCount);
          const suffix = column.value && column.value !== label ? column.value : column.column_id || String(nextCount);
          displayLabel = (labelCounts.get(label) ?? 0) > 1 ? `${label} (${suffix})` : label;
        }
        return { ...column, kind: "column", displayLabel, slotId: slot.slotId, slotIndex: slot.slotIndex, reserveTrailingGap: slot.reserveTrailingGap };
      })
      .filter((column): column is DisplayColumn => Boolean(column));
  }, [columnLabelParts, isModuleResult, language, normalizedColumnSlots, resultSession, showModuleCompleteness, showModuleDetail]);
  const displayColumnSlotSpan = useMemo(() => heatmapSlotSpan(displayColumns), [displayColumns]);
  const displayColumnLabelMap = useMemo(
    () =>
      new Map(
        displayColumns
          .filter(isHeatmapDisplayColumn)
          .map((column) => [normalizeColumnKey(column), column.displayLabel]),
      ),
    [displayColumns],
  );
  const moduleCompletenessNumericThreshold = useMemo(() => {
    const parsed = Number(moduleCompletenessThreshold);
    return Number.isFinite(parsed) ? clamp(parsed, 0, 100) : 80;
  }, [moduleCompletenessThreshold]);
  useEffect(() => {
    const visibleRowIds = new Set(semanticVisibleRows.map((row) => row.id));
    const visibleColumnKeys = new Set(
      displayColumns
        .filter(isHeatmapDisplayColumn)
        .map((column) => normalizeColumnKey(column)),
    );
    setSelectedCells((current) => {
      const next = new Set<string>();
      current.forEach((key) => {
        const parsed = splitCellKeyParts(key);
        if (parsed && visibleRowIds.has(parsed.rowId) && visibleColumnKeys.has(parsed.columnKey)) next.add(key);
      });
      const changed = next.size !== current.size;
      return changed ? next : current;
    });
  }, [displayColumns, semanticVisibleRows]);

  const headerHeight = useMemo(() => {
    const maxLabelWidth = displayColumns.reduce((max, column) => column.displayLabel ? Math.max(max, columnLabelWidth(column.displayLabel, columnLabelFontSize)) : max, 0);
    const labelProjection = rectangularColumnLabelProjection(maxLabelWidth);
    const moduleClearance = isModuleResult && showModuleNames ? rectangularModuleHeaderLayout(moduleLabelFontSize).braceBottom + 18 : 14;
    return Math.ceil(Math.max(BASE_HEADER_HEIGHT, labelProjection.height + moduleClearance));
  }, [columnLabelFontSize, displayColumns, isModuleResult, moduleLabelFontSize, showModuleNames]);
  const contentHeight = Math.max(360, headerHeight + (visibleRows.length ? visibleRows[visibleRows.length - 1].y : 0) + rowHeight + 32);
  const rectangularTreeHeight = Math.max(1, contentHeight - headerHeight);
  const heatmapVisibleSlots = Math.max(displayColumnSlotSpan, displayColumns.length ? displayColumnSlotSpan + 8 : 8);
  const maxHeatmapColumnLabelWidth = displayColumns.reduce(
    (max, column) => isHeatmapDisplayColumn(column) && column.displayLabel
      ? Math.max(max, columnLabelWidth(column.displayLabel, columnLabelFontSize))
      : max,
    0,
  );
  const heatmapColumnProjection = rectangularColumnLabelProjection(maxHeatmapColumnLabelWidth);
  const heatmapModuleLabelWidth = moduleQueryInfo && showModuleNames
    ? moduleQueryInfo.modules.reduce(
        (max, module) => Math.max(max, columnLabelWidth(moduleBraceLabel(module.module_id, module.module_name, showModuleNames, showModuleFullName), moduleLabelFontSize)),
        0,
      )
    : 0;
  const heatmapBodyWidth = heatmapVisibleSlots * heatmapColumnWidth;
  const heatmapWidth = Math.max(
    260,
    heatmapBodyWidth + 80 + heatmapColumnProjection.width,
    heatmapBodyWidth + 40 + heatmapModuleLabelWidth,
  );
  const viewerWidth = treeLayout.treeWidth + heatmapWidth;
  const rectangularExportBounds = useMemo(() => ({
    left: 0,
    top: 0,
    right: Math.ceil(viewerWidth + 36),
    bottom: Math.ceil(contentHeight),
  }), [contentHeight, viewerWidth]);
  // A circular label consumes arc length. Decide whether it fits before it
  // contributes to the canvas size, otherwise labels enlarge the circle until
  // they appear to fit and the backing tiles grow without bound.
  const circularDensity = useMemo(() => {
    const visibility = initialDensityVisibility(visibleRows.length);
    return {
      branchLabels: !visibility.branchLabels,
      stripLabels: !visibility.stripLabels,
      speciesNumbers: !visibility.speciesNumbers,
    };
  }, [visibleRows.length]);
  const reserveCircularBranchLabels = showBranchLabels && (!circularDensity.branchLabels || forceShowBranchLabels);
  const reserveCircularStripLabels = circularStripLabelsVisible({
    terminalCount: visibleRows.length,
    showStrip,
    embedded: taxonNameDisplayMode === "embedded",
    forceVisible: forceShowStripLabels,
  });
  const circularGeometry = useMemo(() => {
    const labelFontSize = branchLabelFontSize;
    const labelTextBudget = reserveCircularBranchLabels ? visibleRows.reduce((max, row) => Math.max(max, circularLabelWidth(row.label, labelFontSize)), 120) : 0;
    const labelSlotHeight = reserveCircularBranchLabels ? labelFontSize * 1.56 : 0;
    const labelRadiusNeeded = visibleRows.length * labelSlotHeight / Math.max(circularArcRadians, Math.PI);
    const labelArcSize = labelRadiusNeeded / 0.31;
    const labelTextSize = labelTextBudget / 0.095;
    const circularHeatmapSlots = displayColumns.length ? displayColumnSlotSpan : 0;
    const columnLabelBudget = displayColumns.reduce((max, column) => column.displayLabel ? Math.max(max, columnLabelWidth(column.displayLabel, columnLabelFontSize)) : max, 42);
    const moduleLabelBudget = moduleQueryInfo && showModuleNames
      ? moduleQueryInfo.modules.reduce((max, module) => Math.max(max, columnLabelWidth(moduleBraceLabel(module.module_id, module.module_name, showModuleNames, showModuleFullName), moduleLabelFontSize)), 0)
      : 0;
    const circularStripTextBudget = showStrip && reserveCircularStripLabels && stripRank !== "none" && treeModel
      ? visibleStripGroups.reduce((max, group) => Math.max(max, circularLabelWidth(group.label, stripNameFontSize)), 0)
      : 0;
    const spacingBase = 920;
    const densityBase = 900 + visibleRows.length * 0.14;
    const layoutSize = Math.max(880, spacingBase, densityBase, labelArcSize, labelTextSize + circularStripTextBudget);
    const treeDepth = Math.max(1, circularMinimumTreePartitionRadius * circularBranchScale);
    const hasCircularStrip = hasVisibleTreeStyleStrip || (showStrip && taxonDisplayStyle === "strip" && stripRank !== "none");
    const stripRingWidth = hasCircularStrip ? circularStripRingWidthWorld : 0;
    const labelTailBudget = Math.max(columnLabelFontSize * 2, Math.min(520, columnLabelBudget + moduleLabelBudget + 96));
    return resolveCircularPresentationGeometry({
      layoutSize,
      radialLayout: {
        treeOuterRadius: treeDepth,
        showBranchLabels: reserveCircularBranchLabels,
        branchLabelFontSize,
        branchLabelTextBudget: labelTextBudget,
        showSpeciesLayer,
        showStrip: hasCircularStrip,
        stripRingWidth,
        showStripLabels: reserveCircularStripLabels,
        stripLabelFontSize: stripNameFontSize,
        stripLabelTextBudget: circularStripTextBudget,
      },
      heatmapSlotSpan: circularHeatmapSlots,
      heatmapRingWidth: effectiveCircularHeatmapRingWidth,
      outerLabelBudget: labelTailBudget,
    });
  }, [branchLabelFontSize, circularArcRadians, circularBranchScale, circularMinimumTreePartitionRadius, circularStripRingWidthWorld, columnLabelFontSize, displayColumnSlotSpan, displayColumns, effectiveCircularHeatmapRingWidth, hasVisibleTreeStyleStrip, moduleLabelFontSize, moduleQueryInfo, reserveCircularBranchLabels, reserveCircularStripLabels, showModuleFullName, showModuleNames, showSpeciesLayer, showStrip, stripNameFontSize, stripRank, taxonDisplayStyle, treeModel, treeStyles, visibleRows, visibleStripGroups]);
  const circularSceneGeometry = useMemo(() => ({
    ...circularGeometry,
    treeOuterRadius: Math.max(1, circularNodeRadii.treeDepth),
    radiusByNodeId: circularNodeRadii.radiusByNodeId,
    angular: circularAngularLayout,
  }), [circularAngularLayout, circularGeometry, circularNodeRadii]);
  const circularSize = circularGeometry.size;
  const effectiveShowBranchLabels = treeViewMode === "circular" ? reserveCircularBranchLabels : showBranchLabels;
  const effectiveShowStripLabels = treeViewMode === "circular"
    ? reserveCircularStripLabels
    : showStrip && taxonNameDisplayMode === "embedded";
  const effectiveShowSpeciesCount = treeViewMode === "circular"
    ? showSpeciesCount && (!circularDensity.speciesNumbers || forceShowSpeciesCount)
    : showSpeciesCount;
  const activeViewerWidth = treeViewMode === "circular" ? circularSize : viewerWidth;
  const activeViewerHeight = treeViewMode === "circular" ? circularSize : contentHeight;
  // Graphic dimensions are document units; the viewport must not silently
  // clamp user input (especially circular ring width).
  const heatmapColumnWidthMax = undefined;
  const stripWidthMax = Math.max(
    treeViewMode === "circular" ? 4 : 8,
    Math.floor((treeViewMode === "circular" ? viewerViewportShortSide : viewerViewportWidth) * 0.12),
  );
  function rememberHeatmapAggregate(entry: HeatmapAggregateCacheEntry) {
    heatmapAggregateCacheRef.current = [
      entry,
      ...heatmapAggregateCacheRef.current.filter((current) => current.key !== entry.key),
    ].slice(0, 4);
  }
  const heatmapAggregateRequest = useMemo(() => {
    if (
      !resultSession
      || !activeDataset
      || !treeModel
      || !resultSession.columns.length
      || !terminalNodeTable.length
    ) {
      return null;
    }

    const input = {
      speciesTree: activeDataset.species_tree,
      genomeDatabase: activeDataset.genome_database,
      datasetRevision: activeDataset.dataset_revision ?? "unversioned",
      terminalRows: terminalNodeTable.map((row) => ({ nodeId: row.nodeId, ownedLeafNodeIds: row.ownedLeafNodeIds })),
      terminalRowsKey: terminalCutSnapshot.aggregationRowsKey,
      leafOwnerByNodeId: terminalCutSnapshot.leafOwnerByNodeId,
      annotationColumns: resultSession.columns.map((column) => ({
        annotation_id: column.annotation_id ?? null,
        type: column.type,
        value: column.value,
      })),
      moduleCompletenessThreshold: isModuleResult ? moduleCompletenessNumericThreshold : null,
    };
    return input;
  }, [
    activeDataset,
    isModuleResult,
    moduleCompletenessNumericThreshold,
    resultSession,
    treeModel,
    terminalHeatmapKey,
    terminalCutSnapshot,
  ]);

  useEffect(() => {
    heatmapAggregateRequestIdRef.current += 1;
    const requestId = heatmapAggregateRequestIdRef.current;

    if (!heatmapAggregateRequest) {
      setStandardHeatmapAggregate(null);
      return;
    }
    const plan = planHeatmapAggregation(heatmapAggregateRequest, heatmapAggregateCacheRef.current);
    if (plan.kind === "reuse") {
      rememberHeatmapAggregate(plan.entry);
      setStandardHeatmapAggregate(plan.entry.response);
      return;
    }
    if (plan.kind === "project-columns") {
      const response = projectHeatmapAggregateColumns(plan.entry.response, heatmapAggregateRequest.annotationColumns);
      rememberHeatmapAggregate(makeHeatmapAggregateCacheEntry(heatmapAggregateRequest, response));
      setStandardHeatmapAggregate(response);
      return;
    }
    if (plan.kind === "derive-collapse") {
      const response = deriveCollapsedHeatmapAggregate(heatmapAggregateRequest, plan.entry, plan.sourceRowIndexes);
      rememberHeatmapAggregate(makeHeatmapAggregateCacheEntry(heatmapAggregateRequest, response));
      setStandardHeatmapAggregate(response);
      return;
    }

    const controller = new AbortController();
    setStandardHeatmapAggregate(null);
    void (async () => {
      try {
        const requestedColumns = plan.kind === "merge-columns" || plan.kind === "fetch-all"
          ? plan.requestedColumns
          : heatmapAggregateRequest.annotationColumns;
        const response = await aggregateHeatmap(
          heatmapAggregateRequest.speciesTree,
          heatmapAggregateRequest.genomeDatabase,
          heatmapAggregateRequest.terminalRows,
          requestedColumns,
          heatmapAggregateRequest.moduleCompletenessThreshold,
          controller.signal,
        );
        if (requestId !== heatmapAggregateRequestIdRef.current) {
          return;
        }
        const mergedResponse = plan.kind === "merge-columns"
          ? mergeHeatmapAggregateColumns(plan.entry.response, response, heatmapAggregateRequest.annotationColumns)
          : response;
        rememberHeatmapAggregate(makeHeatmapAggregateCacheEntry(heatmapAggregateRequest, mergedResponse));
        setStandardHeatmapAggregate(mergedResponse);
        setError(null);
      } catch (requestError) {
        if (controller.signal.aborted || requestId !== heatmapAggregateRequestIdRef.current) {
          return;
        }
        setStandardHeatmapAggregate(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : localizedText(language, "热图聚合失败。", "Heatmap aggregation failed."),
        );
      }
    })();

    return () => {
      controller.abort();
    };
  }, [heatmapAggregateRequest, language]);

  useEffect(() => () => {
    if (panAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(panAnimationFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!showModuleNames) setShowModuleFullName(false);
  }, [showModuleNames]);

  function viewerIsReadyForFit() {
    const viewport = viewerScrollRef.current;
    if (!viewport) return false;
    const rect = viewport.getBoundingClientRect();
    return initialResultFitIsReady(
      { width: rect.width, height: rect.height },
      { width: activeViewerWidth, height: activeViewerHeight },
      visibleRows.length,
    );
  }

  function viewerFitLayoutKey() {
    const rect = viewerScrollRef.current?.getBoundingClientRect();
    return [
      rect?.width ?? 0,
      rect?.height ?? 0,
      treeViewMode === "rectangular" ? treeLayout.treeWidth : activeViewerWidth,
      activeViewerHeight,
      treeViewMode === "circular" ? circularGeometry.fitOuterRadius : 0,
    ].join(":");
  }

  function resetViewerFitConvergence() {
    viewerFitConvergenceRef.current = { iteration: 0, lastLayoutKey: null, lastZoom: null };
  }

  function fitViewerToViewport(purpose: "display" | "export" = "display") {
    const viewport = viewerScrollRef.current;
    if (!viewport || !activeViewerWidth || !activeViewerHeight) return false;
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const padding = treeViewMode === "circular" ? 12 : RECTANGULAR_FIT_PADDING;
    const drawerWidth = drawerOpen ? controlDrawerWidth : 52;
    const visibleCanvasWidth = rect.width - Math.min(drawerWidth, Math.max(0, rect.width - 24));
    const taxonAnnotationWidth = 0;
    const rectangularFrame = treeViewMode === "rectangular"
      ? rectangularFitFrame(
          visibleCanvasWidth,
          padding,
          taxonAnnotationWidth,
          RECTANGULAR_TAXON_ANNOTATION_GAP,
          taxonAnnotationWidth ? RECTANGULAR_TAXON_ANNOTATION_INSET : 0,
        )
      : null;
    const fitViewport = { width: rectangularFrame?.viewportWidth ?? visibleCanvasWidth, height: rect.height };
    // Dense heatmaps remain pannable once the shared readability floor is reached.
    const treeFitContentWidth = treeViewMode === "rectangular" ? treeLayout.treeWidth : activeViewerWidth;
    const treeBounds = treeViewMode === "circular"
      ? (purpose === "export" ? circularGeometry.exportBounds : circularGeometry.displayBounds)
      : { left: 0, top: 0, right: treeFitContentWidth, bottom: activeViewerHeight };
    const treeScene = speciesTreeRenderer.buildDrawPlan({
      mode: treeViewMode,
      rootAnchor: treeViewMode === "circular" ? { x: activeViewerWidth / 2, y: activeViewerHeight / 2 } : { x: 0, y: 0 },
      bounds: treeBounds,
      terminalCount: visibleRows.length,
      partition: { root: 0, treeContent: 0, stripContent: 0, heatmapContent: 0, treeToStripGap: 0, stripToHeatmapGap: 0 },
    });
    const presentation = resolveCanvasPresentation({
      mode: treeViewMode,
      viewport: fitViewport,
      bounds: treeScene.bounds,
      padding,
      purpose,
      interactionZoom: viewportController.getSnapshot().interactionZoom,
    });
    const nextZoom = presentation.camera.zoom;
    const nextOffset = treeViewMode === "circular"
      ? { x: presentation.camera.offsetX, y: presentation.camera.offsetY }
      : { x: rectangularFrame?.offsetX ?? presentation.camera.offsetX, y: presentation.camera.offsetY };
    const previousCamera = { zoom: viewportController.getSnapshot().zoom, offset: viewportController.getSnapshot().offset };
    const nextCamera = { zoom: nextZoom, offset: nextOffset };
    const previousTreeCamera = {
      zoom: previousCamera.zoom,
      offsetX: previousCamera.offset.x,
      offsetY: previousCamera.offset.y,
    };
    const nextTreeCamera = {
      zoom: nextCamera.zoom,
      offsetX: nextCamera.offset.x,
      offsetY: nextCamera.offset.y,
    };
    // Auto-fit changes can remeasure text and geometry. Bound that feedback
    // loop, and avoid notifying React when the camera is already settled.
    const cameraDidChange = cameraChanged(previousTreeCamera, nextTreeCamera);
    const convergence = advanceViewerFitConvergence(
      viewerFitConvergenceRef.current,
      viewerFitLayoutKey(),
      nextZoom,
      4,
    );
    viewerFitConvergenceRef.current = convergence.state;
    const previousAutoFitZoom = treeViewMode === "circular"
      ? viewportController.getSnapshot().circular.fitScale
      : viewportController.getSnapshot().rectangular.fitScale;
    const fitDelta = Math.abs(presentation.fitZoom - previousAutoFitZoom);
    setFitZoom(presentation.fitZoom);
    if (treeViewMode === "circular") {
      setResetCircularFitReference(false);
      setCircularAutoFitZoom(presentation.fitZoom);
    } else {
      setRectangularAutoFitZoom(presentation.fitZoom);
    }
    setFitSettled(convergence.settled || fitDelta <= Math.max(0.000001, nextZoom * 0.0001));
    const placeTaxonAnnotationLeft = treeViewMode === "rectangular"
      && taxonAnnotation?.open
      && rectangularFrame !== null
      && taxonAnnotationWidth > 0;
    const taxonAnnotationLeft = placeTaxonAnnotationLeft
      ? (padding + RECTANGULAR_TAXON_ANNOTATION_INSET - nextOffset.x) / nextZoom
      : null;
    if (!cameraDidChange && !placeTaxonAnnotationLeft) return true;
    const legendViewport = { width: visibleCanvasWidth, height: rect.height };
    if (cameraDidChange) {
      if (purpose !== "export") {
        setHeatmapLegend((current) => current
          ? rebaseFloatingLegendToCamera(current, previousCamera, nextCamera, legendViewport, 24, nextZoom)
          : current);
        setTaxonAnnotation((current) => {
          if (!current) return current;
          const rebased = rebaseFloatingLegendToCamera(current, previousCamera, nextCamera, legendViewport, 24, nextZoom);
          if (taxonAnnotationLeft === null || Math.abs(rebased.x - taxonAnnotationLeft) <= 0.0001) return rebased;
          return { ...rebased, x: taxonAnnotationLeft };
        });
      }
      if (Math.abs(previousCamera.zoom - nextZoom) > 0.0001) setViewZoom(nextZoom);
      if (previousCamera.offset.x !== nextOffset.x || previousCamera.offset.y !== nextOffset.y) setViewOffset(nextOffset);
    } else if (taxonAnnotationLeft !== null) {
      setTaxonAnnotation((current) => current && Math.abs(current.x - taxonAnnotationLeft) > 0.0001
        ? { ...current, x: taxonAnnotationLeft }
        : current);
    }
    return true;
  }

  function requestViewerFit(resetCircularReference = false, purpose: "display" | "export" = "display") {
    setInteractionZoom(1);
    resetViewerFitConvergence();
    setPendingFit(true);
    setFitSettled(false);
    if (treeViewMode === "circular" && resetCircularReference) {
      setResetCircularFitReference(true);
    }
    const fitted = fitViewerToViewport(purpose);
    if (fitted && viewportController.getSnapshot().fitSettled) setPendingFit(false);
    return fitted;
  }

  useLayoutEffect(() => {
    const previousMode = previousTreeViewModeRef.current;
    const previousRank = previousDisplayRankRef.current;
    const datasetKey = `${resultSession?.species_tree ?? ""}:${resultSession?.genome_database ?? ""}`;
    const previousDatasetKey = previousRenderDatasetRef.current;
    const previousSize = viewportController.getSnapshot().previousCircularSize;
    previousTreeViewModeRef.current = treeViewMode;
    previousDisplayRankRef.current = displayRank;
    previousRenderDatasetRef.current = datasetKey;
    const fitViewportKey = [viewerViewportWidth, viewerViewportHeight, drawerOpen, controlDrawerWidth].join(":");
    const viewportChanged = previousViewerFitViewportRef.current !== fitViewportKey;
    previousViewerFitViewportRef.current = fitViewportKey;
    setPreviousCircularSize(circularSize);
    const modeChanged = previousMode !== treeViewMode;
    const rankChanged = previousRank !== displayRank;
    const datasetChanged = previousDatasetKey !== datasetKey;
    if (modeChanged || rankChanged || datasetChanged) {
      setForceShowBranchLabels(false);
      setForceShowStripLabels(false);
      setForceShowSpeciesCount(false);
    }
    if (pendingCameraRestoreRef.current) {
      if (activePage !== "result" || !viewerScrollRef.current || (visibleRows.length > 0 && !viewerIsReadyForFit())) return;
      const saved = pendingCameraRestoreRef.current;
      pendingCameraRestoreRef.current = null;
      applySavedCamera(saved);
      return;
    }
    if (restoredCameraActiveRef.current && !modeChanged && !rankChanged && !datasetChanged && !viewportChanged) return;
    if (modeChanged || rankChanged || datasetChanged || viewportChanged) restoredCameraActiveRef.current = false;
    if (modeChanged) {
      cameraByModeRef.current[previousMode] = captureCurrentCamera();
    }
    const layoutTransitionRequiresFit = shouldAutomaticallyFitLayoutTransition({ modeChanged, rankChanged, datasetChanged });
    if (layoutTransitionRequiresFit || viewportChanged) {
      if (layoutTransitionRequiresFit) setInteractionZoom(1);
      resetViewerFitConvergence();
      setPendingFit(true);
      setFitSettled(false);
      if (treeViewMode === "circular" && (modeChanged || datasetChanged)) {
        setResetCircularFitReference(true);
      }
    }
    if (viewportController.getSnapshot().pendingFit) {
      return scheduleFitWhenStable(
        viewerIsReadyForFit,
        viewerFitLayoutKey,
        () => {
          if (fitViewerToViewport() && viewportController.getSnapshot().fitSettled) setPendingFit(false);
        },
        window.requestAnimationFrame.bind(window),
      );
    }
    if (treeViewMode === "circular" && previousSize !== null && previousSize !== circularSize) {
      setViewOffset((current) => {
        const beforeScene = speciesTreeRenderer.buildDrawPlan({ mode: "circular", rootAnchor: { x: previousSize / 2, y: previousSize / 2 }, bounds: { left: 0, top: 0, right: previousSize, bottom: previousSize }, terminalCount: visibleRows.length, partition: { root: 0, treeContent: 0, stripContent: 0, heatmapContent: 0, treeToStripGap: 0, stripToHeatmapGap: 0 } });
        const afterScene = speciesTreeRenderer.buildDrawPlan({ mode: "circular", rootAnchor: { x: circularSize / 2, y: circularSize / 2 }, bounds: { left: 0, top: 0, right: circularSize, bottom: circularSize }, terminalCount: visibleRows.length, partition: { root: 0, treeContent: 0, stripContent: 0, heatmapContent: 0, treeToStripGap: 0, stripToHeatmapGap: 0 } });
        const camera = preserveRootAnchor(beforeScene, afterScene, { zoom: viewportController.getSnapshot().zoom, offsetX: current.x, offsetY: current.y });
        const nextOffset = { x: camera.offsetX, y: camera.offsetY };
        return nextOffset;
      });
    }
  }, [activePage, activeViewerHeight, activeViewerWidth, circularArcDegrees, circularGeometry.fitOuterRadius, circularRotationDegrees, circularSize, controlDrawerWidth, displayRank, drawerOpen, resultSession?.genome_database, resultSession?.species_tree, treeViewMode, viewerViewportHeight, viewerViewportWidth, visibleRows.length]);

  const aggregateRowMatrices = useMemo(() => {
    if (!resultSession || !standardHeatmapAggregate) {
      return { counts: new Map<string, number>(), speciesHits: new Map<string, number>() };
    }
    return mapHeatmapAggregateMatrices(standardHeatmapAggregate, visibleRows, resultSession.columns);
  }, [resultSession, standardHeatmapAggregate, visibleRows]);

  const aggregateRowCounts = aggregateRowMatrices.counts;
  const aggregateRowSpeciesHits = aggregateRowMatrices.speciesHits;

  const rowCounts = aggregateRowCounts;
  const rowSpeciesHits = aggregateRowSpeciesHits;

  const downloadColumns = useMemo(
    () => {
      if (!resultSession) return [];
      return displayColumns
        .filter((column) => !isModuleCompletenessColumn(column))
        .map((column) => ({
          ...column,
          displayLabel: displayColumnLabelMap.get(normalizeColumnKey(column)) ?? column.short_name ?? column.value,
        }));
    },
    [displayColumnLabelMap, displayColumns, resultSession],
  );

  const resultColumnByKey = useMemo(() => {
    const columns = resultSession?.columns ?? [];
    const map = new Map<string, SearchColumn>();
    columns.forEach((column) => {
      const key = normalizeColumnKey(column);
      if (!map.has(key)) map.set(key, column);
    });
    return map;
  }, [resultSession?.columns]);

  const cellValues = useMemo(() => {
    const map = heatmapMetric === "count" ? new Map(rowCounts) : new Map<string, number>();
    const leafCountByRowId = new Map(visibleRows.map((row) => [row.id, row.ownedLeafNodeIds.length]));
    rowSpeciesHits.forEach((speciesHits, key) => {
      const separatorIndex = key.lastIndexOf("::");
      if (separatorIndex < 0) return;
      const leafCount = leafCountByRowId.get(key.slice(0, separatorIndex)) ?? 0;
      const columnKey = key.slice(separatorIndex + 2);
      const column = resultColumnByKey.get(columnKey);
      if (leafCount > 0 && (heatmapMetric === "ratio" || (column && isModuleCompletenessColumn(column)))) {
        map.set(key, speciesHits / leafCount);
      }
    });
    return map;
  }, [heatmapMetric, resultColumnByKey, rowCounts, rowSpeciesHits, visibleRows]);

  const activeHeatmapStyles = useMemo(() => heatmapStylesForMode(heatmapStyles, treeViewMode), [heatmapStyles, treeViewMode]);
  const leafHeatmapStyleMap = useMemo(() => buildLeafStyleMap(heatmapStyles, treeViewMode), [heatmapStyles, treeViewMode]);
  const fallbackHeatmapStyle = useMemo(() => defaultHeatmapStyleForMode(heatmapStyles, treeViewMode), [heatmapStyles, treeViewMode]);
  const renderSnapshot = useMemo(() => compileResultRenderSnapshot({
    terminalCut: terminalCutSnapshot,
    visibleRows,
    treeLayoutNodes,
    columns: displayColumns,
    rowCounts,
    rowSpeciesHits,
    cellValues,
    leafStyleMap: leafHeatmapStyleMap,
    defaultHeatmapStyle: fallbackHeatmapStyle,
    metric: heatmapMetric,
    ratioDisplayMode,
    treeStyles,
    treeModel,
    taxonColorPlan,
  }), [
    cellValues,
    displayColumns,
    fallbackHeatmapStyle,
    heatmapMetric,
    leafHeatmapStyleMap,
    ratioDisplayMode,
    rowCounts,
    rowSpeciesHits,
    terminalCutSnapshot,
    treeModel,
    taxonColorPlan,
    treeStyles,
    treeLayoutNodes,
    visibleRows,
  ]);
  const resolveRenderNodeId = (nodeId: number | null) => resolveVisibleRenderNodeId(
    renderSnapshot,
    nodeId,
    (ancestorNodeId, descendantNodeId) => treeModel?.isAncestorOf(ancestorNodeId, descendantNodeId) ?? false,
  );
  const selectedRenderNodeId = useMemo(
    () => resolveRenderNodeId(selectedNodeId),
    [renderSnapshot, selectedNodeId, treeModel],
  );
  const hoveredRenderNodeId = useMemo(
    () => resolveRenderNodeId(hoveredNodeId),
    [hoveredNodeId, renderSnapshot, treeModel],
  );
  const prunePreviewNodeIds = useMemo(() => new Set(Array.from(branchPrunePreviewNodeIds, resolveRenderNodeId).filter((nodeId): nodeId is number => nodeId !== null)), [branchPrunePreviewNodeIds, renderSnapshot, treeModel]);
  const editingHeatmapStyle = useMemo(
    () => editingHeatmapStyleId ? heatmapStyles.find((style) => style.id === editingHeatmapStyleId) ?? null : null,
    [editingHeatmapStyleId, heatmapStyles],
  );

  const aliveSearchNodeIds = useMemo(() => {
    if (!treeModel) return [] as number[];
    const nodeIds = new Set<number>();
    currentAliveLeafNodeScope.forEach((leafNodeId) => {
      let current = leafNodeId;
      while (current >= 0) {
        nodeIds.add(current);
        current = treeModel.parentOf(current);
      }
    });
    return Array.from(nodeIds).sort((left, right) => treeModel.runtime.nodeIn[left] - treeModel.runtime.nodeIn[right]);
  }, [currentAliveLeafNodeScope, treeModel]);

  const treeSearchResults = useMemo(() => {
    const query = treeSearch.trim().toLowerCase();
    if (!query || !treeModel) return [];
    const activeTree = treeModel;
    const results: Array<TreeNodeSearchItem & { score: number; sourceOrder: number }> = [];
    const seen = new Set<string>();
    const searchableRanks = treeSearchRank === "all" ? RANKS : [treeSearchRank];
    const aliveNodeIdSet = new Set(aliveSearchNodeIds);

    function addResult(nodeId: number, rank: string, label: string, score: number, sourceOrder: number) {
      const key = `${nodeId}|${rank}`;
      if (!aliveNodeIdSet.has(nodeId)) return;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        id: nodeId,
        label,
        rank,
        path: taxonomyPath(activeTree, nodeId),
        speciesCount: activeTree.leafCountByNode[nodeId] ?? 0,
        genomeCount: activeTree.genomeCountByNode[nodeId] ?? 0,
        score,
        sourceOrder,
      });
    }

    aliveSearchNodeIds.forEach((nodeId) => {
      searchableRanks.forEach((rankName, rankIndex) => {
        const label = taxonomyValue(activeTree, nodeId, rankName);
        if (!label) return;
        const score = textMatchScore(label, query);
        if (score === null) return;
        const targetId = taxonRootForRank(activeTree, nodeId, rankName);
        const order = activeTree.runtime.nodeIn[targetId] * RANKS.length + rankIndex;
        addResult(targetId, rankName, taxonomyValue(activeTree, targetId, rankName) || label, score, order);
      });

      if (treeSearchRank !== "all") return;
      const name = sourceName(activeTree, nodeId);
      const score = textMatchScore(name, query);
      if (score === null) return;
      const rank = exactTaxonRank(activeTree, nodeId) ?? deepestRank(activeTree, nodeId) ?? "node";
      const order = activeTree.runtime.nodeIn[nodeId] * RANKS.length + RANKS.length;
      addResult(nodeId, rank, sourceLabel(activeTree, nodeId, rank), score + 1, order);
    });

    return results
      .sort((a, b) => a.score - b.score || a.sourceOrder - b.sourceOrder)
      .slice(0, 30)
      .map((item): TreeNodeSearchItem => ({
        id: item.id,
        label: item.label,
        rank: item.rank,
        path: item.path,
        speciesCount: item.speciesCount,
        genomeCount: item.genomeCount,
      }));
  }, [aliveSearchNodeIds, treeModel, treeSearch, treeSearchRank]);
  const detailRankCandidates = useMemo(() => {
    const query = detailRankSearch.trim().toLowerCase();
    if (!query || !treeModel) return [];
    const activeTree = treeModel;
    const results: Array<TreeNodeSearchItem & { score: number; sourceOrder: number }> = [];
    const seen = new Set<string>();
    const searchableRanks = detailRankSearchRank === "all"
      ? RANKS.filter((rank) => rank !== "species")
      : [detailRankSearchRank];
    const aliveNodeIdSet = new Set(aliveSearchNodeIds);

    function addCandidate(nodeId: number, rank: string, label: string, score: number, sourceOrder: number) {
      if (!label || !aliveNodeIdSet.has(nodeId) || !activeTree.childrenOf(nodeId).length) return;
      const key = `${nodeId}|${rank}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        id: nodeId,
        label,
        rank,
        path: taxonomyPath(activeTree, nodeId),
        speciesCount: activeTree.leafCountByNode[nodeId] ?? 0,
        genomeCount: activeTree.genomeCountByNode[nodeId] ?? 0,
        score,
        sourceOrder,
      });
    }

    aliveSearchNodeIds.forEach((nodeId) => {
      searchableRanks.forEach((rankName, rankIndex) => {
        const label = taxonomyValue(activeTree, nodeId, rankName);
        if (!label) return;
        const score = textMatchScore(label, query);
        if (score === null) return;
        const targetId = taxonRootForRank(activeTree, nodeId, rankName);
        addCandidate(targetId, rankName, taxonomyValue(activeTree, targetId, rankName) || label, score, activeTree.runtime.nodeIn[targetId] * RANKS.length + rankIndex);
      });

      if (detailRankSearchRank !== "all") return;
      const name = sourceName(activeTree, nodeId);
      const score = textMatchScore(name, query);
      if (score === null) return;
      const rank = exactTaxonRank(activeTree, nodeId) ?? deepestRank(activeTree, nodeId) ?? "node";
      addCandidate(nodeId, rank, sourceLabel(activeTree, nodeId, rank), score + 1, activeTree.runtime.nodeIn[nodeId] * RANKS.length + RANKS.length);
    });

    return results
      .sort((a, b) => a.score - b.score || a.sourceOrder - b.sourceOrder)
      .slice(0, 30)
      .map((item): TreeNodeSearchItem => ({
        id: item.id,
        label: item.label,
        rank: item.rank,
        path: item.path,
        speciesCount: item.speciesCount,
        genomeCount: item.genomeCount,
      }));
  }, [aliveSearchNodeIds, detailRankSearch, detailRankSearchRank, treeModel]);
  const homeScopeRecords = useMemo(
    () => homeDraftExecutor.getSnapshot("manual")?.state.branchCartRecords ?? [],
    [homeScopeVersion],
  );
  const homeScopeCandidates = useMemo(
    () => searchQueryScopeCandidates(rawTreeModel, homeScopeSearchRank, homeScopeSearch),
    [homeScopeSearch, homeScopeSearchRank, rawTreeModel],
  );
  const homeScopeLeafCount = useMemo(
    () => Array.from(new Set(homeScopeRecords.flatMap((record) => record.leafNodeIds))).length,
    [homeScopeRecords],
  );
  const resultScopeRecords = useMemo(() => branchCartRecords, [branchCartRecords, resultScopeVersion]);
  const resultScopeCandidates = useMemo(
    () => searchQueryScopeCandidates(rawTreeModel, resultScopeSearchRank, resultScopeSearch),
    [rawTreeModel, resultScopeSearch, resultScopeSearchRank],
  );
  const resultScopeLeafCount = useMemo(
    () => Array.from(new Set(resultScopeRecords.flatMap((record) => record.leafNodeIds))).length,
    [resultScopeRecords],
  );

  useEffect(() => {
    fetchDatasets()
      .then((data) => {
        setDatasets(data);
        const first = data.datasets.find((item) => item.available) ?? data.datasets[0] ?? null;
        setActiveDataset(first);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Failed to load datasets."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeDataset) {
      setHomeScopeOptions([]);
      setHomeScopeSelection(null);
      setHomeScopeOptionsLoading(false);
      return () => { cancelled = true; };
    }
    setHomeScopeOptionsLoading(true);
    setHomeScopeOptions([]);
    setHomeScopeSelection(null);
    homeDraftExecutor.clear();
    setHomeScopeVersion((value) => value + 1);
    void fetchTreeScopeOptions(activeDataset.species_tree, activeDataset.genome_database)
      .then((response) => {
        if (cancelled) return;
        setHomeScopeOptions(response.options);
        setHomeScopeSelection(defaultQueryScopeSelection(response.options));
      })
      .catch(() => {
        if (cancelled) return;
        setHomeScopeOptions([]);
        setHomeScopeSelection(null);
      })
      .finally(() => {
        if (!cancelled) setHomeScopeOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeDataset?.dataset_revision, activeDataset?.genome_database, activeDataset?.species_tree]);

  useEffect(() => {
    if (homeScopeDialogOpen || homeScopeOptionsLoading || !rawTreeModel || !homeScopeSelection || homeScopeSelection === "other") return;
    if (homeScopeRecords.length) return;
    replaceHomeScopeFromPreset(homeScopeSelection);
  }, [homeScopeDialogOpen, homeScopeOptionsLoading, homeScopeOptions, homeScopeRecords.length, homeScopeSelection, rawTreeModel]);

  useEffect(() => {
    const timers: number[] = [];
    conditions.forEach((condition) => {
      const trimmed = condition.value.trim();
      if (!trimmed) {
        setSuggestions((current) => ({ ...current, [condition.id]: [] }));
        setModuleSuggestions((current) => ({ ...current, [condition.id]: [] }));
        return;
      }
      const timer = window.setTimeout(async () => {
        try {
          if (condition.type === "module") {
            const items = await fetchModuleSuggestions("module", trimmed);
            setModuleSuggestions((current) => ({ ...current, [condition.id]: items }));
            setSuggestions((current) => ({ ...current, [condition.id]: [] }));
            return;
          }
          const items = await fetchSuggestions(condition.type, trimmed);
          setSuggestions((current) => ({ ...current, [condition.id]: items }));
          setModuleSuggestions((current) => ({ ...current, [condition.id]: [] }));
        } catch {
          setSuggestions((current) => ({ ...current, [condition.id]: [] }));
          setModuleSuggestions((current) => ({ ...current, [condition.id]: [] }));
        }
      }, 220);
      timers.push(timer);
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [conditions]);

  useEffect(() => {
    if (!insertDialog.open || !insertDialog.value.trim()) {
      setInsertSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        setInsertSuggestions(await fetchSuggestions(insertDialog.type, insertDialog.value.trim()));
      } catch {
        setInsertSuggestions([]);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [insertDialog.open, insertDialog.type, insertDialog.value]);

  useEffect(() => {
    const timers: number[] = [];
    heatmapQueryConditions.forEach((condition) => {
      const trimmed = condition.value.trim();
      if (!trimmed) {
        setHeatmapQuerySuggestionsById((current) => ({ ...current, [condition.id]: [] }));
        setHeatmapModuleSuggestionsById((current) => ({ ...current, [condition.id]: [] }));
        return;
      }
      const timer = window.setTimeout(async () => {
        try {
          if (condition.type === "module") {
            const items = await fetchModuleSuggestions("module", trimmed);
            setHeatmapModuleSuggestionsById((current) => ({ ...current, [condition.id]: items }));
            setHeatmapQuerySuggestionsById((current) => ({ ...current, [condition.id]: [] }));
            return;
          }
          const items = await fetchSuggestions(condition.type, trimmed);
          setHeatmapQuerySuggestionsById((current) => ({ ...current, [condition.id]: items }));
          setHeatmapModuleSuggestionsById((current) => ({ ...current, [condition.id]: [] }));
        } catch {
          setHeatmapQuerySuggestionsById((current) => ({ ...current, [condition.id]: [] }));
          setHeatmapModuleSuggestionsById((current) => ({ ...current, [condition.id]: [] }));
        }
      }, 220);
      timers.push(timer);
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [heatmapQueryConditions]);

  useEffect(() => {
    const moduleIds = moduleQueryInfo?.modules.map((item) => item.module_id) ?? [];
    if (!moduleIds.length) {
      setActiveModuleId("");
      return;
    }
    if (!moduleIds.includes(activeModuleId)) {
      setActiveModuleId(moduleIds[0]);
    }
  }, [activeModuleId, moduleQueryInfo?.modules]);

  useEffect(() => {
    if (pendingCenterNodeId === null) return;
    const targetRendered = treeLayoutNodes.some((node) => (
      node.nodeId === pendingCenterNodeId || node.nodePath.includes(pendingCenterNodeId)
    ));
    if (!targetRendered) return;
    centerViewOnSource(pendingCenterNodeId);
    setPendingCenterNodeId(null);
  }, [pendingCenterNodeId, treeLayoutNodes]);

  const defaultAnnotationRank = useMemo(
    () => defaultAnnotationRankForLocalRules(displayRank, localRankRules),
    [displayRank, localRankRules],
  );
  const appliedDefaultAnnotationRankRef = useRef<string | null>(null);

  useEffect(() => {
    // The rank can be calculated before the tree workspace exists, but the
    // command cannot be applied until the raw tree has loaded. Do not mark
    // that unapplied value as handled, or the real initialization is skipped.
    if (!rawTreeModel) return;
    if (appliedDefaultAnnotationRankRef.current === defaultAnnotationRank) return;
    if (stripRank !== defaultAnnotationRank) {
      const result = executeTreeCommand({ type: "set-strip-rank", rank: defaultAnnotationRank });
      if (!result?.accepted) return;
    }
    appliedDefaultAnnotationRankRef.current = defaultAnnotationRank;
  }, [defaultAnnotationRank, rawTreeModel, stripRank, workbench.revision]);

  useEffect(() => {
    function updateCtrl(event: KeyboardEvent) {
      setCtrlDown(event.ctrlKey);
    }
    function clearCtrl() {
      setCtrlDown(false);
    }
    window.addEventListener("keydown", updateCtrl);
    window.addEventListener("keyup", updateCtrl);
    window.addEventListener("blur", clearCtrl);
    return () => {
      window.removeEventListener("keydown", updateCtrl);
      window.removeEventListener("keyup", updateCtrl);
      window.removeEventListener("blur", clearCtrl);
    };
  }, []);

  useEffect(() => {
    if (!shouldConfirmPageExit) {
      return undefined;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (allowBrowserUnloadRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shouldConfirmPageExit]);

  useEffect(() => {
    function handleShortcutGuard(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || pendingShortcutGuard) {
        return;
      }

      const key = event.key.toLowerCase();
      const refreshRequested = event.key === "F5"
        || event.key === "BrowserRefresh"
        || ((event.ctrlKey || event.metaKey) && key === "r");
      if (refreshRequested) {
        if (!shouldConfirmPageExit) {
          return;
        }
        event.preventDefault();
        setPendingShortcutGuard({ kind: "reload" });
        return;
      }

      const homeRequested = event.key === "BrowserHome" || (event.altKey && key === "home");
      if (!homeRequested || !shouldConfirmHomeNavigation) {
        return;
      }

      event.preventDefault();
      setPendingShortcutGuard({
        kind: "return-home",
        target: "home",
      });
    }

    window.addEventListener("keydown", handleShortcutGuard);
    return () => {
      window.removeEventListener("keydown", handleShortcutGuard);
    };
  }, [pendingShortcutGuard, shouldConfirmHomeNavigation, shouldConfirmPageExit]);

  useEffect(() => {
    if (!pendingShortcutGuard) {
      return undefined;
    }

    function handleGuardEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setPendingShortcutGuard(null);
    }

    window.addEventListener("keydown", handleGuardEscape);
    return () => {
      window.removeEventListener("keydown", handleGuardEscape);
    };
  }, [pendingShortcutGuard]);

  function clearMarqueeFrame() {
    if (marqueeFrameRef.current === null) return;
    window.cancelAnimationFrame(marqueeFrameRef.current);
    marqueeFrameRef.current = null;
  }

  function renderMarqueeBox() {
    marqueeFrameRef.current = null;
    const draft = selectionDraftRef.current;
    const box = marqueeBoxRef.current;
    const workbench = workbenchRef.current;
    if (!draft?.active || !box || !workbench) return;
    const workbenchRect = workbench.getBoundingClientRect();
    box.style.left = `${Math.min(draft.startX, draft.currentX) - workbenchRect.left}px`;
    box.style.top = `${Math.min(draft.startY, draft.currentY) - workbenchRect.top}px`;
    box.style.width = `${Math.abs(draft.currentX - draft.startX)}px`;
    box.style.height = `${Math.abs(draft.currentY - draft.startY)}px`;
  }

  function scheduleMarqueeBoxRender() {
    if (marqueeFrameRef.current !== null) return;
    marqueeFrameRef.current = window.requestAnimationFrame(renderMarqueeBox);
  }

  useEffect(() => {
    function handleMove(event: MouseEvent) {
      const draft = selectionDraftRef.current;
      if (draft?.active) {
        draft.currentX = event.clientX;
        draft.currentY = event.clientY;
        scheduleMarqueeBoxRender();
      }
      setColumnDragDraft((current) => {
        columnDragDraftRef.current = current;
        if (!current) return current;
        const moved = current.moved || Math.abs(event.clientX - current.startX) > 6 || Math.abs(event.clientY - current.startY) > 6;
        const next = { ...current, currentX: event.clientX, currentY: event.clientY, moved };
        columnDragDraftRef.current = next;
        return next;
      });
    }
    function handleUp() {
      if (columnDragDraftRef.current) {
        finishColumnDrag();
        return;
      }
      finishMarqueeSelection();
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      clearMarqueeFrame();
    };
  }, [columnDragDraft, circularSize, heatmapColumnWidth, resultSession, showModuleCompleteness, showModuleDetail, treeViewMode, viewZoom]);

  function selectDataset(dataset: DatasetItem) {
    if (!dataset.available) return;
    setActiveDataset(dataset);
    setActiveDataset(dataset);
  }

  function updateCondition(id: string, patch: Partial<AnnotationCondition>) {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id
          ? {
              ...condition,
              ...patch,
              selected: patch.value !== undefined || patch.type !== undefined ? patch.selected ?? null : patch.selected ?? condition.selected,
              moduleSelected: patch.value !== undefined || patch.type !== undefined
                ? patch.moduleSelected ?? null
                : patch.moduleSelected ?? condition.moduleSelected,
            }
          : condition,
      ),
    );
  }

  function addCondition() {
    setConditions((current) => [
      ...current,
      createCondition(current.length, current.at(-1)?.type ?? "cog"),
    ]);
  }

  function removeCondition(id: string) {
    setConditions((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)));
  }

  function applySuggestion(conditionId: string, item: SuggestItem) {
    updateCondition(conditionId, { type: item.type, value: annotationDisplayValue(item), selected: item });
    setSuggestions((current) => ({ ...current, [conditionId]: [] }));
    setActiveSuggestionId(null);
  }

  function applyModuleSuggestion(conditionId: string, item: ModuleSuggestItem) {
    updateCondition(conditionId, { type: "module", value: moduleDisplayValue(item), moduleSelected: item, selected: null });
    setModuleSuggestions((current) => ({ ...current, [conditionId]: [] }));
    setActiveSuggestionId(null);
  }

  function resetHeatmapQueryDialog() {
    setHeatmapQueryDialogOpen(false);
    setHeatmapQueryConditions([createCondition(0)]);
    setHeatmapQuerySuggestionsById({});
    setHeatmapModuleSuggestionsById({});
    setHeatmapQueryActiveSuggestionId(null);
  }

  function updateHeatmapQueryCondition(id: string, patch: Partial<AnnotationCondition>) {
    setHeatmapQueryConditions((current) =>
      current.map((condition) =>
        condition.id === id
          ? {
              ...condition,
              ...patch,
              selected: patch.value !== undefined || patch.type !== undefined ? patch.selected ?? null : patch.selected ?? condition.selected,
              moduleSelected: patch.value !== undefined || patch.type !== undefined
                ? patch.moduleSelected ?? null
                : patch.moduleSelected ?? condition.moduleSelected,
            }
          : condition,
      ),
    );
  }

  function addHeatmapQueryCondition() {
    setHeatmapQueryConditions((current) => [
      ...current,
      createCondition(current.length, current.at(-1)?.type ?? "cog"),
    ]);
  }

  function removeHeatmapQueryCondition(id: string) {
    setHeatmapQueryConditions((current) => (
      current.length === 1 ? current : current.filter((condition) => condition.id !== id)
    ));
  }

  function applyHeatmapQuerySuggestion(conditionId: string, item: SuggestItem) {
    updateHeatmapQueryCondition(conditionId, { type: item.type, value: annotationDisplayValue(item), selected: item });
    setHeatmapQuerySuggestionsById((current) => ({ ...current, [conditionId]: [] }));
    setHeatmapQueryActiveSuggestionId(null);
  }

  function applyHeatmapModuleSuggestion(conditionId: string, item: ModuleSuggestItem) {
    updateHeatmapQueryCondition(conditionId, { type: "module", value: moduleDisplayValue(item), moduleSelected: item, selected: null });
    setHeatmapModuleSuggestionsById((current) => ({ ...current, [conditionId]: [] }));
    setHeatmapQueryActiveSuggestionId(null);
  }

  function applyBranchPruneStateSnapshot(snapshot: BranchPruneStateSnapshot) {
    setBranchPruneStatus(snapshot.status);
    setBranchPruneErrorCode(snapshot.errorCode);
    setBranchPruneErrorDetail(snapshot.errorDetail);
    setBranchPruneSummary(snapshot.summary);
  }

  function executeWorkbenchDomainCommand(command: WorkbenchCommand): WorkbenchCommandResult | null {
    if (!rawTreeModel) return null;
    const current = workbenchController.getSnapshot();
    const result = workbenchController.dispatch(rawTreeModel.runtime, command, {
      effectiveAliveBitset: current.aliveBitset ?? effectiveAliveBitset,
    });
    if (!result) return null;
    if (!result.accepted) setError(result.rejection);
    return result;
  }

  function executeTreeCommand(
    command: TreeWorkspaceCommand,
    facadeCommand: WorkbenchCommand = { type: "tree", command },
  ) {
    if (!rawTreeModel) return null;
    const result = executeWorkbenchDomainCommand(facadeCommand);
    if (!result) return null;
    if (!result.accepted) {
      return result;
    }

    if (command.type === "apply-cart-scope" || command.type === "append-leaf-scope") {
      // A scope change can replace the active local ranks. Re-evaluate the
      // default annotation rank after the new workspace snapshot is applied.
      appliedDefaultAnnotationRankRef.current = null;
    }

    const next = result.snapshot.tree;
    if (next.runtime !== canvasTreeRuntime) preserveTerminalTableRuntimeRef.current = next.runtime;
    if (result.invalidation.heatmap) setStandardHeatmapAggregate(null);
    const isResetCommand = command.type === "reset-default-tree" || command.type === "restore-reset-baseline";
    if (shouldAutomaticallyFitTreeMutation({
      mode: treeViewMode,
      fitRequested: result.invalidation.fitView,
      reset: isResetCommand,
    })) {
      resetViewerFitConvergence();
      setInteractionZoom(1);
      setPendingFit(true);
      setFitSettled(false);
      if (treeViewMode === "circular" && isResetCommand) {
        setResetCircularFitReference(true);
      }
    }
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setPendingCenterNodeId(null);
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
    setError(null);
    return result;
  }

  function executeQueryCommand(command: QuerySpecificationCommand) {
    const result = executeWorkbenchDomainCommand({ type: "query", command });
    if (!result) return null;
    if (!result.accepted) {
      setError(result.rejection);
      return result;
    }
    if (result.invalidation.aggregate) setStandardHeatmapAggregate(null);
    return result;
  }

  function executeCartCommand(command: CartWorkspaceCommand) {
    const result = executeWorkbenchDomainCommand({ type: "cart", command });
    if (!result) return null;
    if (!result.accepted) {
      setError(result.rejection);
      return result;
    }
    setError(null);
    return result;
  }

  function executeHeatmapCommand(command: HeatmapPresentationCommand) {
    const result = executeWorkbenchDomainCommand({ type: "heatmap", command });
    if (!result) return null;
    if (!result.accepted) return result;
    if (result.invalidation.aggregate) setStandardHeatmapAggregate(null);
    return result;
  }

  function captureAppearanceSnapshot(): WorkbenchAppearanceSnapshot {
    return {
      treeViewMode,
      showStrip,
      taxonDisplayStyle,
      taxonNameDisplayMode,
      taxonLegendFontSize,
      rectangularTaxonLegendFontSize,
      circularTaxonLegendFontSize,
      heatmapLegendFontSize,
      rectangularHeatmapLegendFontSize,
      circularHeatmapLegendFontSize,
      branchScale,
      spacingScale,
      showStripLabels,
      stripMinimumLeafCount,
      showSpeciesCount,
      showBranchLabels,
      forceShowBranchLabels,
      forceShowStripLabels,
      forceShowSpeciesCount,
      branchStrokeWidth,
      rectangularFontProfile,
      circularFontProfile,
      rectangularStripColumnWidth,
      circularStripRingWidth,
      rectangularHeatmapColumnWidth: rectangularHeatmapColumnWidthSetting,
      circularHeatmapRingWidth,
      showInternalNodes,
      showBranchGuides,
      showBranchLengths,
      circularArcDegrees,
      circularRotationDegrees,
    };
  }

  function executeAppearanceCommand(command: WorkbenchAppearanceCommand) {
    const result = executeWorkbenchDomainCommand({ type: "appearance", command });
    if (!result) return null;
    if (!result.accepted) return result;
    return result;
  }

  async function executeQueryColumnAddition<T extends { status: "accepted" | "cancelled" | "rejected" }>(
    currentSession: AnnotationColumnSearchResult | null,
    searchedColumns: AnnotationColumnSearchResult,
    mode: "replace" | "append",
    apply: () => T | Promise<T>,
  ) {
    return executeGuardedQueryColumnAddition(
      currentSession,
      searchedColumns,
      mode,
      () => window.confirm(localizedText(
        language,
        "当前查询范围过大，可能导致画面卡顿，是否继续？",
        "This query is large and may make the canvas unresponsive. Continue?",
      )),
      apply,
    );
  }

  function resetHeatmapBatchQueryDialog() {
    setHeatmapBatchQueryDialogOpen(false);
    setHeatmapBatchQueryText("");
  }

  function applyCircularTreeLayoutPreset(preset: CircularTreeLayoutPreset) {
    const settings = circularTreeLayoutPresetSettings(preset);
    if (settings.fitView) {
      resetViewerFitConvergence();
      setInteractionZoom(1);
      setPendingFit(true);
      setFitSettled(false);
    }
    executeAppearanceCommand({
      type: "set-circular-geometry",
      arcDegrees: settings.arcDegrees,
      rotationDegrees: settings.rotationDegrees,
    });
    if (settings.clearColumnLabels) {
      executeHeatmapCommand({ type: "set-column-label-parts", parts: [] });
    }
  }

  function resetBranchPruneState(resetDraft = false, resetAliveBitset = true) {
    if (resetAliveBitset && treeModel) setAliveBitset(createFullAliveBitset(treeModel.nodeCount));
    setBranchPruneStatus("idle");
    setBranchPruneErrorCode(null);
    setBranchPruneErrorDetail(null);
    setBranchPruneSummary(null);
    setBranchPrunePreviewNodeIds(new Set());
    if (resetDraft) {
      setBranchPruneDraft({
        ...EMPTY_BRANCH_PRUNE_DRAFT,
      });
    }
  }

  function buildBranchPruneRows(leafNodeIds: number[]) {
    if (!treeModel) return [] as VisibleRow[];
    const scopedAliveBitset = aliveBitsetFromLeafNodeIds(treeModel, leafNodeIds);
    const scopedTerminalNodeTable = buildTerminalNodeTable(
      treeModel,
      scopedAliveBitset,
      displayRank,
      localRankConstraints,
      viewRoot,
    );
    return buildTreeProjection(treeModel, scopedAliveBitset, scopedTerminalNodeTable, viewRoot, rowHeight).visibleRows;
  }

  async function planCurrentBranchPrune(mode: "preview" | "apply") {
    if (!activeDataset || !treeModel) {
      return null;
    }

    setBranchPruneStatus("loading");
    setBranchPruneErrorCode(null);
    setBranchPruneErrorDetail(null);
    setBranchPruneSummary(null);
    setBranchPrunePreviewNodeIds(new Set());

    const result = await planBranchPrune({
      draft: branchPruneDraft,
      mode,
      treeModel,
      currentVisibleRows: visibleRows,
      visibleScopeLeafNodeIds: [...visibleScopeLeafNodeIds],
      currentAliveLeafNodeIds: currentAliveLeafNodeScope,
      fullTreeLeafNodeIds,
      buildScopedRows: buildBranchPruneRows,
      requestGenomeScope: (filters, leafNodeIds) =>
        filterTreeGenomes(
          activeDataset.species_tree,
          activeDataset.genome_database,
          {
            node_ids: [],
            leaf_node_ids: leafNodeIds,
            genome_ids: [],
          },
          filters,
        ),
    });

    if (!result.ok) {
      setBranchPruneStatus("error");
      setBranchPruneErrorCode(result.errorCode);
      setBranchPruneErrorDetail(result.errorDetail);
      setBranchPruneSummary(null);
      return null;
    }

    return result.plan;
  }

  async function previewBranchPrune() {
    const plan = await planCurrentBranchPrune("preview");
    if (!plan) return;
    setBranchPruneStatus("ready");
    setBranchPruneErrorCode(null);
    setBranchPruneErrorDetail(null);
    setBranchPruneSummary(plan.summary);
    setBranchPrunePreviewNodeIds(new Set(plan.previewNodeIds));
    setError(null);
  }

  async function applyBranchPrune() {
    const baseRevision = workbenchController.getSnapshot().revision;
    const plan = await planCurrentBranchPrune("apply");
    if (baseRevision !== workbenchController.getSnapshot().revision) {
      setError("The workbench changed while branch pruning was running. Run the filter again.");
      return false;
    }
    if (!plan || !treeModel) return;
    const nextState: BranchPruneStateSnapshot = {
      status: "ready",
      errorCode: null,
      errorDetail: null,
      summary: plan.summary,
    };
    executeTreeCommand({
      type: "apply-leaf-scope",
      leafNodeIds: plan.nextAliveLeafNodeIds ?? fullTreeLeafNodeIds,
    });
    applyBranchPruneStateSnapshot(nextState);
    setBranchPrunePreviewNodeIds(new Set());
    setError(null);
  }

  function initializeResultWorkbench(
    nextResultSession: AnnotationColumnSearchResult,
    nextColumnSlots: HeatmapColumnSlot[],
    initialCart: CartWorkspaceSnapshot | null = null,
  ) {
    workspaceSessionRef.current += 1; pendingSaveAttemptRef.current = null; setRestoredRecord(null); setSavedWorkspaceToken(null); taxonAnnotationRestoreKeyRef.current = null; cameraByModeRef.current = { rectangular: null, circular: null }; restoredCameraActiveRef.current = false;
    const initialScope = initialCart ? cartWorkspaceApplication(initialCart) : null;
    let initialTreeViewMode: TreeViewMode = DEFAULT_TREE_VIEW_MODE;
    if (rawTreeModel) {
      const unscopedBaseline = createTreeWorkspace(rawTreeModel.runtime, "phylum", "phylum");
      const scopedBaseline = initialScope?.leafNodeIds.length
        ? executeTreeWorkspace(rawTreeModel.runtime, unscopedBaseline, {
          type: "apply-cart-scope",
          leafNodeIds: initialScope.leafNodeIds,
          localRankRules: initialScope.localRankConstraints.map((constraint) => ({ ...constraint, enabled: true })),
          localRankConstraints: initialScope.localRankConstraints,
        })
        : { accepted: true as const, snapshot: unscopedBaseline };
      initialTreeViewMode = initialTreeViewModeForTerminalCount(scopedBaseline.snapshot.terminalNodeTable.length);
      setTreeResetBaseline(captureTreeWorkspaceResetBaseline(scopedBaseline.snapshot).resetBaseline);
      // Start each result from the runtime used to build its baseline. This
      // keeps the alive bitmap, DFS ordering, and later rank rebuilds aligned
      // after a previous result was rerooted or had branches swapped.
      setCanvasTreeRuntime(scopedBaseline.snapshot.runtime);
      setAliveBitset(Uint8Array.from(scopedBaseline.snapshot.aliveBitset));
    }
    setRenderNotice(localizedText(language, "数据加载完成，正在渲染物种树和热图...", "Data loaded. Rendering the tree and heatmap..."));
    setStandardHeatmapAggregate(null);
    setResultSession(nextResultSession);
    // A new search starts a new main-tree session. Do not carry a previous
    // query's bitmap filters into it: doing so can leave the new result with
    // no terminal rows after the main-tree state is reset.
    if (treeModel) {
      setCartAliveBitset(initialCart
        ? Uint8Array.from(initialCart.aliveBitset)
        : createEmptyAliveBitset(rawTreeModel?.nodeCount ?? treeModel.nodeCount));
    }
    setLocalRankConstraints(initialScope?.localRankConstraints.map((constraint) => ({ ...constraint })) ?? []);
    setLocalRankRules(initialScope?.localRankConstraints.map((constraint) => ({ ...constraint, enabled: true })) ?? []);
    setTerminalNodeTable([]);
    setTreeViewMode(initialTreeViewMode);
    setTaxonNameDisplayMode(initialTreeViewMode === "rectangular" ? "embedded" : "annotation");
    setDisplayRank("phylum");
    // A new result starts a fresh tree-rank initialization. Allow the
    // default annotation rank effect to apply to this result again.
    appliedDefaultAnnotationRankRef.current = null;
    setStripRank("phylum");
    setTaxonDisplayStyle("background");
    setCircularRotationDegrees(DEFAULT_CIRCULAR_ROTATION_DEGREES);
    setColumnSlots(nextColumnSlots);
    setSelectedCells(new Set());
    setHeatmapStyles(ensureDefaultHeatmapStyles([]));
    setTreeStyles([]);
    setDetailRankAddOpen(false);
    setCustomTerminalLabels(new Map());
    setViewRoot(null);
    // Reset filter UI state without discarding the scope selected on Home.
    resetBranchPruneState(true, false);
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setDetailRankSearch("");
    setDetailRankPickedItem(null);
    setDrawerPanel("tree");
    setResultPanelMode("controls");
    setActiveModuleId(nextResultSession.module_groups[0]?.module_id ?? "");
    setShowModuleCompleteness(true);
    setShowModuleDetail(false);
    setModuleCompletenessThreshold("80");
    resetHeatmapQueryDialog();
    // Home scope records are a query draft. Once the scope is materialized on
    // the result canvas they must not remain as a second, implicit draft.
    setBranchCartRecords([]);
    setBranchCartBatches([]);
    setInteractionZoom(1);
    setFitZoom(1);
    setRectangularAutoFitZoom(1);
    setCircularAutoFitZoom(1);
    setViewZoom(1);
    setResetCircularFitReference(true);
    resetViewerFitConvergence();
    setFitSettled(false);
    setPendingFit(true);
    setActivePage("result");
    if (!resultPageEntryRef.current) {
      window.history.pushState({ page: "result" }, "", window.location.href);
      resultPageEntryRef.current = true;
    }
    window.setTimeout(() => setRenderNotice(""), 600);
  }

  async function submitHomeSearch() {
    if (!activeDataset) {
      setError(localizedText(language, "当前没有可用数据集。", "No dataset is available."));
      return;
    }
    if (homeScopeOptionsLoading || !homeScopeSelection || !homeScopeRecords.length || !homeScopeLeafCount) {
      setError(localizedText(language, "查询范围尚未准备完成，请稍后重试或选择其他范围。", "The query scope is not ready. Try again shortly or choose another scope."));
      return;
    }
    const queryConditions = queryMode === "batch" ? parsedBatchConditions : validConditions;
    if (!queryConditions.length) {
      setError(localizedText(language, "请至少输入一条查询。", "Enter at least one query."));
      return;
    }

    const preparation = prepareAnnotationSearchConditions(queryConditions, suggestions, moduleSuggestions);
    if (preparation.ambiguity) {
      setActiveSuggestionId(preparation.ambiguity.conditionId);
      if (preparation.ambiguity.kind === "annotation") setCandidateConditionId(preparation.ambiguity.conditionId);
      setError(localizedText(
        language,
        preparation.ambiguity.kind === "module" ? "多个 Module 匹配，请先选择一个候选项。" : "多个注释匹配，请先选择一个候选项。",
        preparation.ambiguity.kind === "module" ? "Multiple modules matched. Pick one suggestion first." : "Multiple annotations matched. Pick one suggestion first.",
      ));
      return;
    }
    setIsSearching(true);
    setRenderNotice(localizedText(language, "正在读取数据库、物种树和热图数据...", "Loading database, tree, and heatmap data..."));
    setError(null);
    try {
      const searchedColumns = await searchAnnotationColumns(activeDataset.species_tree, activeDataset.genome_database, preparation.conditions);
      const guarded = await executeQueryColumnAddition(null, searchedColumns, "replace", () => {
        const appended = appendSearchedHeatmapColumns(null, [], searchedColumns);
        const draft = homeDraftExecutor.getSnapshot("manual")?.state;
        const initialCart = draft?.cartAliveBitset && draft.branchCartRecords.length
          ? {
            aliveBitset: Uint8Array.from(draft.cartAliveBitset),
            records: draft.branchCartRecords.map((record) => ({ ...record, leafNodeIds: [...record.leafNodeIds] })),
            batches: draft.branchCartBatches.map((batch) => ({ ...batch })),
          }
          : null;
        initializeResultWorkbench(
          appended.resultSession,
          appended.columnSlots,
          initialCart,
        );
        homeDraftExecutor.clear("manual");
        touchHomeScope();
        return { status: "accepted" as const };
      });
      if (guarded.status === "cancelled") {
        setRenderNotice("");
        return;
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : localizedText(language, "查询失败", "Search failed"));
      setRenderNotice("");
    } finally {
      setIsSearching(false);
    }
  }

  function resetToLandingSection(target: LandingSectionTarget) {
    resultPageEntryRef.current = false;
    setActivePage(target === "home" ? "query" : target);
    setStandardHeatmapAggregate(null);
    setResultSession(null);
    setSelectedCells(new Set());
    resetBranchPruneState(true);
    resetHeatmapQueryDialog();
    clearBranchCart();
  }

  function runTrustedBrowserAction(action: () => void) {
    allowBrowserUnloadRef.current = true;
    action();
    window.setTimeout(() => {
      allowBrowserUnloadRef.current = false;
    }, 1500);
  }

  function executeShortcutGuardAction(action: ShortcutGuardAction) {
    if (action.kind === "reload") {
      runTrustedBrowserAction(() => {
        window.location.reload();
      });
      return;
    }
    resetToLandingSection(action.target);
  }

  function requestShortcutGuard(action: ShortcutGuardAction) {
    const needsConfirmation = action.kind === "reload"
      ? shouldConfirmPageExit
      : shouldConfirmHomeNavigation;
    if (!needsConfirmation) {
      executeShortcutGuardAction(action);
      return;
    }
    setPendingShortcutGuard(action);
  }

  function handleTopMenuNavigate(target: TopMenuTarget) {
    if (target === "about") {
      setActivePage("about");
      return;
    }

    if (activePage !== "result") {
      setActivePage(target);
      return;
    }

    requestShortcutGuard({
      kind: "return-home",
      target,
    });
  }

  function confirmShortcutGuard() {
    if (!pendingShortcutGuard) return;
    const action = pendingShortcutGuard;
    setPendingShortcutGuard(null);
    executeShortcutGuardAction(action);
  }

  function cancelShortcutGuard() {
    setPendingShortcutGuard(null);
  }

  function closeFloatingMenus() {
    setColumnMenu(emptyColumnMenu());
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
  }

  function handleAppClick() {
    closeFloatingMenus();
    setSelectedNodeId(null);
    setHoveredNodeId(null);
  }

  function menuTreeLayoutNode(menu: NodeMenuState) {
    if (menu.nodeId === null) return null;
    return treeLayoutNodes.find((node) => node.nodeId === menu.nodeId && node.kind === menu.kind) ?? null;
  }

  function canExpandBranch(menu: NodeMenuState) {
    if (menu.nodeId === null || !treeModel) return false;
    const terminal = treeProjection?.terminalNodeTable.find((row) => row.nodeId === menu.nodeId);
    const currentRank = terminal?.rank ?? menuTreeLayoutNode(menu)?.rank ?? deepestRank(treeModel, menu.nodeId) ?? displayRank;
    return nextAvailableTerminalRank(treeModel, menu.nodeId, currentRank) !== null;
  }

  function expandBranch(menu: NodeMenuState) {
    if (menu.nodeId === null || !treeModel || !effectiveAliveBitset || !canExpandBranch(menu)) return;
    const terminal = treeProjection?.terminalNodeTable.find((row) => row.nodeId === menu.nodeId);
    const currentRank = terminal?.rank ?? menuTreeLayoutNode(menu)?.rank ?? deepestRank(treeModel, menu.nodeId) ?? displayRank;
    const nextRank = nextAvailableTerminalRank(treeModel, menu.nodeId, currentRank);
    if (!nextRank) return;
    executeTreeCommand({
      type: "expand-terminal",
      nodeId: menu.nodeId,
      targetRank: nextRank,
      collapseCeilingRank: terminal?.collapseCeilingRank ?? displayRank,
    });
  }

  function ensureHomeDraft(channel: HomeDraftChannel) {
    if (!rawTreeModel || treeCoreLoadState.status !== "ready") return null;
    return homeDraftExecutor.getOrCreateSnapshot(channel, rawTreeModel.runtime);
  }

  function executeHomeDraftCommand(
    channel: HomeDraftChannel,
    command: WorkbenchCommand,
    expectedRevision?: number,
  ): WorkbenchCommandResult | null {
    if (!rawTreeModel) return null;
    return homeDraftExecutor.dispatch(channel, rawTreeModel.runtime, command, expectedRevision);
  }

  function addTaxonToHomeDraft(
    channel: HomeDraftChannel,
    nodeId: number,
    requestedRank: string,
    scope?: { leafNodeIds: number[]; isExactNodeScope: boolean },
  ): boolean {
    const draft = ensureHomeDraft(channel);
    if (!draft || !rawTreeModel) return false;
    // A taxonomy range can legitimately include a singleton taxon whose
    // current-index identity is a leaf. It contributes its one exact leaf
    // even when the requested display rank is lower than that leaf can expose.
    const sourceRank = branchRank(rawTreeModel, nodeId);
    const isLeaf = !rawTreeModel.childrenOf(nodeId).length;
    if (!isLeaf && RANKS.indexOf(requestedRank) < RANKS.indexOf(sourceRank)) return false;
    const leafNodeIds = scope?.leafNodeIds ?? rawTreeModel.materializeLeafNodeIds(nodeId);
    if (!leafNodeIds.length) return false;
    const batchId = draft.state.branchCartBatches.reduce((max, batch) => Math.max(max, batch.id), 0) + 1;
    const expandRank = isLeaf ? sourceRank : requestedRank;
    const rank = branchRank(rawTreeModel, nodeId, expandRank);
    const label = sourceLabel(rawTreeModel, nodeId, rank);
    const batch: BranchCartBatch = {
      id: batchId,
      sourceType: "manual",
      ancestorNodeId: nodeId,
      ancestorLabel: label || branchCartBatchLabelFromNode(nodeId, batchId),
      ancestorRank: rank,
      expandRank,
      recordCount: 0,
    };
    const record = branchCartRecordForSource(nodeId, batch, expandRank, {
      leafNodeIds,
      isExactNodeScope: scope?.isExactNodeScope ?? true,
      label,
      rank,
      scopeSource: "database",
    });
    if (!record) return false;
    return Boolean(executeHomeDraftCommand(
      channel,
      { type: "cart", command: { type: "add-batch", batch, records: [record] } },
      draft.state.revision,
    )?.accepted);
  }

  function touchHomeScope() {
    setHomeScopeVersion((value) => value + 1);
  }

  function homeScopeEditAllowed() {
    return true;
  }

  function ensureHomeScopeDraft() {
    return ensureHomeDraft("manual");
  }

  function replaceHomeScopeFromPreset(selection: Exclude<QueryScopePresetKey, "other">) {
    if (!homeScopeEditAllowed() || !rawTreeModel) return false;
    const option = queryScopeOption(homeScopeOptions, selection);
    const draft = option?.status === "available" ? ensureHomeScopeDraft() : null;
    if (!option || option.status !== "available" || !draft) return false;
    const cleared = executeHomeDraftCommand("manual", { type: "cart", command: { type: "clear" } }, draft.state.revision);
    if (cleared && !cleared.accepted && cleared.rejection !== "The cart is already empty.") return false;
    for (const member of option.members) {
      const defaultLeafNodeIds = defaultQueryScopeLeafNodeIds(rawTreeModel, member.node_id);
      const fullLeafCount = rawTreeModel.materializeLeafNodeIds(member.node_id).length;
      if (!addTaxonToHomeDraft(
        "manual",
        member.node_id,
        member.rank === "domain" ? "phylum" : member.rank,
        { leafNodeIds: defaultLeafNodeIds, isExactNodeScope: defaultLeafNodeIds.length === fullLeafCount },
      )) {
        homeDraftExecutor.clear("manual");
        touchHomeScope();
        return false;
      }
    }
    setHomeScopeSelection(selection);
    touchHomeScope();
    return true;
  }

  function openHomeCustomScope() {
    if (!homeScopeEditAllowed()) return;
    const draft = ensureHomeScopeDraft();
    if (!draft?.state.cartAliveBitset) return;
    homeScopeDialogSnapshotRef.current = {
      aliveBitset: Uint8Array.from(draft.state.cartAliveBitset),
      records: draft.state.branchCartRecords.map((record) => ({ ...record, leafNodeIds: [...record.leafNodeIds] })),
      batches: draft.state.branchCartBatches.map((batch) => ({ ...batch })),
    };
    setHomeScopeSearch("");
    setHomeScopePickedItem(null);
    setHomeScopeSearchRank("all");
    startTransition(() => setHomeScopeDialogOpen(true));
  }

  function restoreHomeCustomScopeSnapshot() {
    const draft = ensureHomeScopeDraft();
    const snapshot = homeScopeDialogSnapshotRef.current;
    if (!draft || !snapshot) return;
    if (homeDraftExecutor.restoreCartSnapshot("manual", snapshot, draft.state.revision)) touchHomeScope();
  }

  function cancelHomeCustomScope() {
    restoreHomeCustomScopeSnapshot();
    homeScopeDialogSnapshotRef.current = null;
    setHomeScopeDialogOpen(false);
  }

  function pickHomeCustomTaxon(item: TreeNodeSearchItem) {
    setHomeScopePickedItem(item);
    setHomeScopeExpandRank(defaultQueryScopeExpansionRank([
      ...homeScopeRecords.map((record) => record.rank),
      item.rank,
    ]));
  }

  function addHomeCustomTaxon() {
    if (!homeScopeEditAllowed()) return;
    const candidate = homeScopePickedItem;
    const draft = ensureHomeScopeDraft();
    if (!candidate || !draft) return;
    if (addTaxonToHomeDraft("manual", candidate.id, homeScopeExpandRank)) {
      setHomeScopeSearch("");
      setHomeScopePickedItem(null);
      touchHomeScope();
    }
  }

  function deleteHomeCustomTaxon(recordId: string) {
    if (!homeScopeEditAllowed()) return;
    const draft = ensureHomeScopeDraft();
    if (!draft) return;
    const result = executeHomeDraftCommand("manual", { type: "cart", command: { type: "remove-record", recordId } }, draft.state.revision);
    if (result?.accepted) touchHomeScope();
  }

  function updateHomeCustomTaxonRank(recordId: string, rank: string) {
    if (!homeScopeEditAllowed()) return;
    const draft = ensureHomeScopeDraft();
    if (!draft) return;
    const result = executeHomeDraftCommand("manual", { type: "cart", command: { type: "update-record-rank", recordId, rank } }, draft.state.revision);
    if (result?.accepted) touchHomeScope();
  }

  function clearHomeCustomScope() {
    if (!homeScopeEditAllowed()) return;
    const draft = ensureHomeScopeDraft();
    if (!draft) return;
    const result = executeHomeDraftCommand("manual", { type: "cart", command: { type: "clear" } }, draft.state.revision);
    if (result?.accepted || result?.rejection === "The cart is already empty.") touchHomeScope();
  }

  function confirmHomeCustomScope() {
    if (!homeScopeRecords.length) return;
    setHomeScopeSelection("other");
    homeScopeDialogSnapshotRef.current = null;
    setHomeScopeDialogOpen(false);
    touchHomeScope();
  }

  function openResultQueryScope() {
    if (!rawTreeModel || !resultSession) return;
    resultScopeDialogSnapshotRef.current = {
      aliveBitset: Uint8Array.from(cartAliveBitset ?? createEmptyAliveBitset(rawTreeModel.nodeCount)),
      records: branchCartRecords.map((record) => ({ ...record, leafNodeIds: [...record.leafNodeIds] })),
      batches: branchCartBatches.map((batch) => ({ ...batch })),
    };
    setResultScopeSearch("");
    setResultScopePickedItem(null);
    setResultScopeSearchRank("all");
    startTransition(() => setResultScopeDialogOpen(true));
  }

  function cancelResultQueryScope() {
    const snapshot = resultScopeDialogSnapshotRef.current;
    if (snapshot) {
      executeCartCommand({ type: "clear" });
      snapshot.batches.forEach((batch) => {
        const records = snapshot.records.filter((record) => record.batchId === batch.id);
        if (records.length) executeCartCommand({ type: "add-batch", batch, records });
      });
    }
    resultScopeDialogSnapshotRef.current = null;
    setResultScopeDialogOpen(false);
    setResultScopeVersion((value) => value + 1);
  }

  function applyResultQueryScope(mode: "replace" | "append") {
    if (!rawTreeModel || !resultScopeRecords.length) return;
    const leafNodeIds = Array.from(new Set(resultScopeRecords.flatMap((record) => record.leafNodeIds)));
    const draftRankConstraints = resultScopeRecords.map((record) => ({
      nodeId: record.nodeId,
      expandRank: record.expandRank,
      taxonRank: record.rank ?? undefined,
      taxonName: record.taxonLabel || undefined,
    }));
    const nextLocalRankConstraints = mode === "append"
      ? Array.from(new Map([...workbenchController.getSnapshot().localRankConstraints, ...draftRankConstraints].map((constraint) => [constraint.nodeId, constraint])).values())
      : draftRankConstraints;
    const draftRankRules = draftRankConstraints.map((constraint) => ({ ...constraint, enabled: true }));
    const nextLocalRankRules = mode === "append"
      ? Array.from(new Map([...workbenchController.getSnapshot().localRankRules, ...draftRankRules].map((rule) => [rule.nodeId, rule])).values())
      : draftRankRules;
    const applied = executeTreeCommand(mode === "replace"
      ? { type: "apply-cart-scope", leafNodeIds, localRankRules: nextLocalRankRules, localRankConstraints: nextLocalRankConstraints }
      : { type: "append-leaf-scope", leafNodeIds, localRankRules: nextLocalRankRules, localRankConstraints: nextLocalRankConstraints });
    if (!applied?.accepted) return;
    // The records are only the modal's draft. Once applied, the canvas
    // alive scope and local rules become the source of truth.
    executeCartCommand({ type: "clear" });
    resultScopeDialogSnapshotRef.current = null;
    setResultScopeDialogOpen(false);
  }

  function collapseNodeToRank(
    nodeId: number,
    rank: string,
    customLabel?: string,
    nextCustomTerminalLabels?: Map<number, string>,
  ) {
    if (nextCustomTerminalLabels && customLabel) {
      executeTreeCommand({ type: "collapse-node", nodeId, rank, label: customLabel });
      return;
    }
    executeTreeCommand({ type: "collapse-node", nodeId, rank, label: customLabel });
  }

  function collapseInternalNode(nodeId: number) {
    if (!treeModel) return;
    const collapseCeilingRank = collapseCeilingRankForNode(
      treeModel,
      nodeId,
      terminalNodeTable,
      displayRank,
    );
    const target = collapseTerminalChoice(treeModel, nodeId, collapseCeilingRank);
    if (!target && !customTerminalLabels.has(nodeId)) {
      setPendingNameNodeId(nodeId);
      setPendingNameCollapseRank(collapseCeilingRank);
      setCustomNameDraft("");
      setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
      return;
    }
    const terminalRank = target?.rank
      ?? nearestNamedAncestorTerminalRank(treeModel, nodeId, collapseCeilingRank);
    collapseNodeToRank(nodeId, terminalRank, customTerminalLabels.get(nodeId));
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
  }

  function deleteBranch(nodeId: number) {
    executeTreeCommand({ type: "delete-branch", nodeId });
  }

  function changeDisplayRank(nextRank: string) {
    if (nextRank === displayRank) return;
    executeTreeCommand({ type: "set-global-rank", rank: nextRank, stripRank });
  }

  function changeStripRank(nextRank: string) {
    if (!RANKS.includes(nextRank) || nextRank === stripRank) return;
    executeTreeCommand({ type: "set-strip-rank", rank: nextRank });
  }

  function updateDenseTextVisibility(
    nextValue: boolean,
    dense: boolean,
    label: string,
    visibilityKey: "showStripLabels" | "showSpeciesCount" | "showBranchLabels",
    overrideKey: "forceShowStripLabels" | "forceShowSpeciesCount" | "forceShowBranchLabels",
  ) {
    if (nextValue && dense) {
      const confirmed = window.confirm(localizedText(
        language,
        `${label} 当前信息密度较高，强制显示可能造成重叠或降低渲染性能。是否继续显示？`,
        `${label} is currently dense. Forcing it to show may cause overlaps or reduce rendering performance. Continue?`,
      ));
      if (!confirmed) return;
      executeAppearanceCommand({
        type: "replace",
        snapshot: { ...captureAppearanceSnapshot(), [overrideKey]: true, [visibilityKey]: true },
      });
      return;
    }
    executeAppearanceCommand({
      type: "replace",
      snapshot: {
        ...captureAppearanceSnapshot(),
        [visibilityKey]: nextValue,
        ...(!nextValue && { [overrideKey]: false }),
      },
    });
  }

  function selectSubtree(nodeId: number) {
    const result = executeTreeCommand({ type: "set-view-root", nodeId });
    if (!result?.accepted) return;
    setSelectedNodeId(nodeId);
    setHoveredNodeId(null);
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
  }

  function nextBranchCartBatchId() {
    return branchCartBatches.reduce((max, batch) => Math.max(max, batch.id), 0) + 1;
  }

  function branchCartBatchLabelFromNode(nodeId: number, fallbackBatchId: number) {
    if (!rawTreeModel) return `#${fallbackBatchId}`;
    const exactRank = exactTaxonRank(rawTreeModel, nodeId);
    if (exactRank) {
      const taxonLabel = taxonomyValue(rawTreeModel, nodeId, exactRank).trim();
      if (taxonLabel) return taxonLabel;
    }
    const nodeName = sourceName(rawTreeModel, nodeId).trim();
    return nodeName || `#${fallbackBatchId}`;
  }

  function resolveCartExpandRank(nodeId: number, requestedRank?: string) {
    if (!rawTreeModel) return requestedRank ?? displayRank;
    const sourceRank = branchRank(rawTreeModel, nodeId);
    const candidateRank = requestedRank ?? displayRank;
    return RANKS.indexOf(candidateRank) < RANKS.indexOf(sourceRank) ? sourceRank : candidateRank;
  }

  function addSourceNodeToBranchCart(nodeId: number, requestedRank?: string, replaceExisting = false): boolean {
    if (!rawTreeModel) return false;
    // Keep singleton taxon scopes executable.  `branchCartRecordForSource`
    // materializes the leaf itself, so no synthetic descendants are needed.
    const sourceRank = branchRank(rawTreeModel, nodeId);
    const isLeaf = !rawTreeModel.childrenOf(nodeId).length;
    if (!isLeaf && requestedRank && RANKS.indexOf(requestedRank) < RANKS.indexOf(sourceRank)) {
      setError(localizedText(language, "展开层级不能高于所选节点自身的层级。", "The expand rank cannot be above the selected node's own rank."));
      return false;
    }
    const expandRank = isLeaf ? sourceRank : resolveCartExpandRank(nodeId, requestedRank);
    // A manually searched cart branch starts from the immutable original tree,
    // not from the currently filtered main-tree bitmap.
    const rawLeafNodeIds = rawTreeModel.materializeLeafNodeIds(nodeId);
    if (!rawLeafNodeIds.length) {
      setError(localizedText(language, "所选原始树节点不包含叶节点。", "The selected original-tree node has no leaf nodes."));
      return false;
    }
    const batchId = nextBranchCartBatchId();
    const rank = branchRank(rawTreeModel, nodeId, expandRank);
    const label = sourceLabel(rawTreeModel, nodeId, rank);
    const batch: BranchCartBatch = {
      id: batchId,
      sourceType: "manual",
      ancestorNodeId: nodeId,
      ancestorLabel: label || branchCartBatchLabelFromNode(nodeId, batchId),
      ancestorRank: rank,
      expandRank,
      recordCount: 0,
    };
    const record = branchCartRecordForSource(
      nodeId,
      batch,
      expandRank,
      {
        leafNodeIds: rawLeafNodeIds,
        isExactNodeScope: true,
        label,
        rank,
        scopeSource: "database",
      },
    );
    if (!record) {
      setError(localizedText(language, "当前分支无法加入下载列表。", "The current branch could not be added to the download list."));
      return false;
    }
    const accepted = commitBranchCartBatch(batch, [record], replaceExisting);
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
    return accepted;
  }

  /**
   * Add any node represented on the current canvas to Cart.
   *
   * Unlike `addSourceNodeToBranchCart`, this preserves the active canvas
   * scope: a node's raw descendants are intersected with `aliveBitset`. It is
   * therefore the shared operation for the node menu and the “append the
   * current canvas” command. `null` selects the current canvas root.
   */
  function addCanvasNodeToBranchCart(nodeId: number | null, requestedRank?: string, replaceExisting = false): boolean {
    if (!rawTreeModel) return false;
    const current = workbenchController.getSnapshot();
    const targetNodeId = nodeId ?? current.viewRoot ?? rawTreeModel.rootId;
    const currentAlive = current.aliveBitset;
    if (!currentAlive) return false;
    const sourceRank = branchRank(rawTreeModel, targetNodeId);
    if (requestedRank && RANKS.indexOf(requestedRank) < RANKS.indexOf(sourceRank)) {
      setError(localizedText(language, "展开层级不能高于所选节点自身的层级。", "The expand rank cannot be above the selected node's own rank."));
      return false;
    }
    const rawLeafNodeIds = rawTreeModel.materializeLeafNodeIds(targetNodeId);
    const leafNodeIds = rawLeafNodeIds.filter((leafNodeId) => currentAlive[leafNodeId] === 1);
    if (!leafNodeIds.length) {
      setError(localizedText(language, "所选画布节点不包含可见叶节点。", "The selected canvas node has no visible leaf nodes."));
      return false;
    }
    const expandRank = requestedRank ?? sourceRank;
    const rank = branchRank(rawTreeModel, targetNodeId, expandRank);
    const label = sourceLabel(rawTreeModel, targetNodeId, rank);
    const batchId = current.branchCartBatches.reduce((max, batch) => Math.max(max, batch.id), 0) + 1;
    const batch: BranchCartBatch = {
      id: batchId,
      sourceType: "manual",
      ancestorNodeId: targetNodeId,
      ancestorLabel: label || branchCartBatchLabelFromNode(targetNodeId, batchId),
      ancestorRank: rank,
      expandRank,
      recordCount: 0,
    };
    const record = branchCartRecordForSource(targetNodeId, batch, expandRank, {
      leafNodeIds,
      isExactNodeScope: leafNodeIds.length === rawLeafNodeIds.length,
      label,
      rank,
      scopeSource: "current_view",
    });
    if (!record) return false;
    const result = workbenchController.dispatch(
      rawTreeModel.runtime,
      { type: "cart", command: replaceExisting
        ? { type: "replace-node-record", batch, record }
        : { type: "add-batch", batch, records: [record] } },
      { effectiveAliveBitset: current.aliveBitset },
    );
    if (!result) {
      setError(localizedText(language, "当前画布节点无法加入下载列表。", "The canvas node could not be added to the download list."));
      return false;
    }
    if (!result.accepted) {
      setError(result.rejection);
      return false;
    }
    setError(null);
    return true;
  }

  function addCurrentBranchToCart(nodeId: number) {
    if (addCanvasNodeToBranchCart(nodeId)) {
      setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
    }
  }

  function branchCartRecordForSource(
    nodeId: number,
    batch: BranchCartBatch,
    expandRank: string,
    scope: {
      leafNodeIds?: number[];
      isExactNodeScope?: boolean;
      label?: string;
      rank?: string | null;
      scopeSource?: BranchCartScopeSource;
    } = {},
  ): BranchCartRecord | null {
    if (!rawTreeModel) return null;
    const rank = scope.rank ?? branchRank(rawTreeModel, nodeId, expandRank);
    const label = scope.label ?? sourceLabel(rawTreeModel, nodeId, rank);
    const taxonLabel = sourceLabel(rawTreeModel, nodeId, rank);
    const leafNodeIds = scope.leafNodeIds ?? rawTreeModel.materializeLeafNodeIds(nodeId);
    const isExactNodeScope = scope.isExactNodeScope ?? true;
    if (!leafNodeIds.length) return null;
    return {
      id: cartRecordId(nodeId, leafNodeIds, isExactNodeScope),
      nodeId,
      label,
      taxonLabel,
      rank,
      expandRank,
      ancestorNodeId: batch.ancestorNodeId,
      ancestorLabel: batch.ancestorLabel,
      ancestorRank: batch.ancestorRank,
      path: taxonomyPath(rawTreeModel, nodeId),
      leafCount: leafNodeIds.length,
      fullTreeLeafCount: rawTreeModel.leafCountByNode[nodeId] ?? rawTreeModel.leafRangeOf(nodeId)[1] - rawTreeModel.leafRangeOf(nodeId)[0],
      leafNodeIds,
      isExactNodeScope,
      batchId: batch.id,
      sourceType: batch.sourceType,
      scopeSource: scope.scopeSource ?? "database",
    };
  }

  function commitBranchCartBatch(batch: BranchCartBatch, records: BranchCartRecord[], replaceExisting = false) {
    const result = executeCartCommand(replaceExisting && records.length === 1
      ? { type: "replace-node-record", batch, record: records[0] }
      : { type: "add-batch", batch, records });
    if (!result?.accepted) return false;
    return true;
  }

  function clearBranchCart() {
    if (rawTreeModel && (branchCartRecords.length || branchCartBatches.length)) executeCartCommand({ type: "clear" });
    else {
      setBranchCartRecords([]);
      setBranchCartBatches([]);
      if (rawTreeModel) setCartAliveBitset(createEmptyAliveBitset(rawTreeModel.nodeCount));
    }
  }

  function confirmCustomName() {
    if (pendingNameNodeId === null || !customNameDraft.trim()) return;
    const nodeId = pendingNameNodeId;
    const collapseCeilingRank = pendingNameCollapseRank ?? displayRank;
    const terminalRank = treeModel
      ? nearestNamedAncestorTerminalRank(treeModel, nodeId, collapseCeilingRank)
      : collapseCeilingRank;
    const nextCustomTerminalLabels = new Map(customTerminalLabels).set(nodeId, customNameDraft.trim());
    collapseNodeToRank(nodeId, terminalRank, customNameDraft.trim(), nextCustomTerminalLabels);
    setPendingNameNodeId(null);
    setPendingNameCollapseRank(null);
    setCustomNameDraft("");
  }

  function runTreeSearch() {
    const pickedItem = treeSearchPickedItem && treeSearchResults.some((item) => sameTreeNodeSearchItem(treeSearchPickedItem, item))
      ? treeSearchPickedItem
      : treeSearchResults[0] ?? null;
    if (!pickedItem) {
      setError(localizedText(language, "当前没有可搜索的物种树结果。", "No searchable tree result is available."));
      return;
    }
    revealTreeSearchItem(pickedItem);
  }

  function localRankRuleMatchesTaxon(rule: LocalRankRule, taxonRank: string, taxonName: string) {
    if (!treeModel) return false;
    const taxonNameNorm = taxonName.trim().toLowerCase();
    const identity = taxonScopeIdentityForNode(treeModel.runtime, rule);
    return identity?.taxonRank === taxonRank
      && identity.taxonNameNorm === taxonNameNorm;
  }

  function confirmDetailRankRule() {
    if (!treeModel) return;
    const pickedItem = detailRankPickedItem && detailRankCandidates.some((item) => sameTreeNodeSearchItem(detailRankPickedItem, item))
      ? detailRankPickedItem
      : detailRankCandidates[0] ?? null;
    if (!pickedItem) {
      setError(localizedText(language, "请先在当前有效范围中选择一个内部节点。", "Choose an internal node in the alive scope first."));
      return;
    }
    const sourceRank = branchRank(treeModel, pickedItem.id);
    if (RANKS.indexOf(detailRankTargetRank) < RANKS.indexOf(sourceRank)) {
      setError(localizedText(language, "细分层级不能高于所选节点自身的层级。", "The detail rank cannot be above the selected node's own rank."));
      return;
    }
    const taxonRank = pickedItem.rank;
    const taxonName = taxonomyValue(treeModel, pickedItem.id, taxonRank) || pickedItem.label;
    const taxonNameNorm = taxonName.trim().toLowerCase();
    const componentNodeIds = (treeModel.runtime.rankIndexes[taxonRank] ?? [])
      .filter((entry) => entry.taxonNameNorm === taxonNameNorm)
      .map((entry) => entry.nodeId)
      .filter((nodeId) => treeModel.someLeafNodeId(nodeId, (leafNodeId) => effectiveAliveBitset?.[leafNodeId] === 1));
    const targetNodeIds = componentNodeIds.length ? componentNodeIds : [pickedItem.id];
    const nextLocalRankRules = [
      ...localRankRules.filter((rule) => {
        const identity = taxonScopeIdentityForNode(treeModel.runtime, rule);
        return identity?.taxonRank !== taxonRank || identity.taxonNameNorm !== taxonNameNorm;
      }),
      ...targetNodeIds.map((nodeId): LocalRankRule => ({
        nodeId,
        expandRank: detailRankTargetRank,
        enabled: true,
        taxonRank,
        taxonName,
      })),
    ];
    executeTreeCommand({ type: "replace-local-rules", rules: nextLocalRankRules });
    setDetailRankAddOpen(false);
    setDetailRankSearch("");
    setDetailRankPickedItem(null);
    setSelectedNodeId(pickedItem.id);
    setPendingCenterNodeId(pickedItem.id);
    setHoveredNodeId(null);
    setError(null);
  }

  function updateDetailRankRuleRank(taxonRank: string, taxonName: string, nextRank: string) {
    if (!treeModel) return;
    const sourceRank = taxonRank;
    if (RANKS.indexOf(nextRank) < RANKS.indexOf(sourceRank)) {
      setError(localizedText(language, "细分层级不能高于所选节点自身的层级。", "The detail rank cannot be above the selected node's own rank."));
      return;
    }
    const nextLocalRankRules = localRankRules.map((constraint) => (
      localRankRuleMatchesTaxon(constraint, taxonRank, taxonName)
        ? { ...constraint, expandRank: nextRank }
        : constraint
    ));
    executeTreeCommand({ type: "replace-local-rules", rules: nextLocalRankRules });
  }

  function toggleDetailRankAdd() {
    setDetailRankAddOpen((current) => !current);
    setDetailRankSearch("");
    setDetailRankSearchRank("all");
    setDetailRankPickedItem(null);
    setDetailRankTargetRank("family");
  }

  function updateDetailRankRuleEnabled(taxonRank: string, taxonName: string, enabled: boolean) {
    const nextLocalRankRules = localRankRules.map((rule) => (
      localRankRuleMatchesTaxon(rule, taxonRank, taxonName) ? { ...rule, enabled } : rule
    ));
    executeTreeCommand({ type: "replace-local-rules", rules: nextLocalRankRules });
  }

  function removeDetailRankRule(taxonRank: string, taxonName: string) {
    const nextLocalRankRules = localRankRules.filter((rule) => !localRankRuleMatchesTaxon(rule, taxonRank, taxonName));
    const replaced = executeTreeCommand({ type: "replace-local-rules", rules: nextLocalRankRules });
    if (replaced?.accepted) executeTreeCommand({ type: "apply-local-rules" });
  }

  function applyDetailRankRules() {
    const nextLocalRankConstraints = localRankRules
      .filter((rule) => rule.enabled)
      .map((rule) => ({
        nodeId: rule.nodeId,
        expandRank: rule.expandRank,
        taxonRank: rule.taxonRank,
        taxonName: rule.taxonName,
      }));
    if (!treeModel || !effectiveAliveBitset) return;
    if (conflictingLocalRankNodeId(nextLocalRankConstraints) !== null) {
      setError(localizedText(
        language,
        "同一物种树分支上的局部层级规则不能使用不同的目标 rank。请先统一这些规则的 rank。",
        "Detail-rank rules on the same tree branch cannot use different target ranks. Align their ranks first.",
      ));
      return;
    }
    executeTreeCommand({ type: "apply-local-rules" });
    setHoveredNodeId(null);
    setError(null);
  }

  function clearAllDetailRankRules() {
    if (!localRankRules.length && !localRankConstraints.length) return;
    if (treeModel && effectiveAliveBitset) executeTreeCommand({ type: "clear-local-rules" });
    setDetailRankAddOpen(false);
    setDetailRankSearch("");
    setDetailRankPickedItem(null);
    setError(null);
  }

  function revealTreeSearchItem(item: TreeNodeSearchItem) {
    if (!treeModel || !effectiveAliveBitset) return;
    if (!effectiveAliveBitset[item.id]) {
      setError("The node is outside the current tree scope and cannot be located directly.");
      return;
    }
    const directlyVisible = treeLayoutNodes.some((node) => node.nodeId === item.id || node.nodePath.includes(item.id));
    const nextViewRoot = viewRoot !== null && !isAncestorOf(treeModel, viewRoot, item.id) ? null : viewRoot;
    if (!directlyVisible || nextViewRoot !== viewRoot) {
      const containingTerminal = terminalNodeTable.find((row) => treeModel.isAncestorOf(row.nodeId, item.id));
      const currentRankIndex = RANKS.indexOf(containingTerminal?.rank ?? displayRank);
      const itemRankIndex = RANKS.indexOf(item.rank);
      executeTreeCommand({
        type: "reveal-node",
        nodeId: item.id,
        targetRank: itemRankIndex > currentRankIndex ? item.rank : "species",
      });
    }
    setSelectedNodeId(item.id);
    setPendingCenterNodeId(item.id);
    setHoveredNodeId(item.id);
    setError(null);
  }

  function findVisibleRenderAnchor(nodeId: number) {
    const directNode = treeLayoutNodes.find((item) => item.nodeId === nodeId);
    if (directNode || !treeModel) return directNode;

    const visibleDescendantOrPathNode = treeLayoutNodes.find(
      (item) => treeModel.isAncestorOf(nodeId, item.nodeId) || item.nodePath.includes(nodeId),
    );
    if (visibleDescendantOrPathNode) return visibleDescendantOrPathNode;

    const containingTerminal = treeLayoutNodes.find(
      (item) => item.kind !== "internal" && treeModel.isAncestorOf(item.nodeId, nodeId),
    );
    if (containingTerminal) return containingTerminal;

    return undefined;
  }

  function centerViewOnSource(nodeId: number) {
    const viewport = viewerScrollRef.current;
    const node = findVisibleRenderAnchor(nodeId);
    if (!viewport || !node) return;
    const rect = viewport.getBoundingClientRect();
    if (treeViewMode === "circular") {
      setViewOffset({
        x: rect.width * 0.5 - circularSize * 0.5 * viewZoom,
        y: rect.height * 0.5 - circularSize * 0.5 * viewZoom,
      });
      return;
    }
    const rootX = treeLayoutNodes.find((item) => item.parent === null)?.x ?? 0;
    const nodeX = scaleBranchCoordinate(rootX, node.x, branchScale);
    setViewOffset({
      x: rect.width * 0.28 - nodeX * viewZoom,
      y: rect.height * 0.45 - (node.y + headerHeight) * viewZoom,
    });
  }

  function updateActiveFontProfile(patch: Partial<TreeFontProfile>) {
    executeAppearanceCommand({ type: "set-font-profile", mode: treeViewMode, patch });
  }

  function setBranchLabelFontSize(value: number) {
    updateActiveFontProfile({ branchLabel: clamp(value || branchNameFontMax, 1, branchNameFontMax) });
  }

  function setBranchLengthFontSize(value: number) {
    updateActiveFontProfile({ branchLength: clamp(value || activeResolvedFonts.branchLength.maxPx, 1, activeResolvedFonts.branchLength.maxPx) });
  }

  function setSpeciesCountFontSize(value: number) {
    updateActiveFontProfile({ speciesCount: clamp(value || speciesCountFontMax, 1, speciesCountFontMax) });
  }

  function setStripNameFontSize(value: number) {
    updateActiveFontProfile({ stripLabel: clamp(value || activeResolvedFonts.stripLabel.maxPx, 1, activeResolvedFonts.stripLabel.maxPx) });
  }

  function setHeatmapNumberFontSize(value: number) {
    updateActiveFontProfile({ heatmapValue: clamp(value || activeResolvedFonts.heatmapValue.maxPx, 1, activeResolvedFonts.heatmapValue.maxPx) });
  }

  function setColumnLabelFontSize(value: number) {
    updateActiveFontProfile({ heatmapColumnLabel: clamp(value || columnLabelFontMax, 1, columnLabelFontMax) });
  }

  function resetToInitialSpeciesTree() {
    setResetCircularFitReference(true);
    resetViewerFitConvergence();
    setInteractionZoom(1);
    setFitSettled(false);
    if (rawTreeModel) executeTreeCommand({ type: "restore-reset-baseline" });
    setBranchPruneDraft({
      ...EMPTY_BRANCH_PRUNE_DRAFT,
    });
    setSelectedCells(new Set());
    setHoveredCellKey(null);
    setHoveredColumnKey(null);
    setColumnMenu(emptyColumnMenu());
    setStandardHeatmapAggregate(null);
    setDetailRankAddOpen(false);
    resetBranchPruneState(true, false);
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setPendingCenterNodeId(null);
    setTreeSearch("");
    setTreeSearchRank("all");
    setTreeSearchPickedItem(null);
    setDetailRankSearch("");
    setDetailRankPickedItem(null);
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
    setPendingFit(true);
    setError(null);
  }

  function updateModuleCompletenessThreshold(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    executeHeatmapCommand({ type: "set-module-view", completenessThreshold: String(Math.round(clamp(parsed, 0, 100))) });
  }

  function handleViewerWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!visibleRows.length) return;
    event.preventDefault();
    const viewport = viewerScrollRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const oldZoom = Math.max(0.0001, viewportController.getSnapshot().zoom);
    const oldInteractionZoom = viewportController.getSnapshot().interactionZoom;
    const nextInteractionZoom = resolveCanvasWheelInteractionZoom(oldInteractionZoom, viewportController.getSnapshot().fitZoom, event.deltaY > 0 ? "out" : "in");
    const nextZoom = viewportController.getSnapshot().fitZoom * nextInteractionZoom;
    if (nextInteractionZoom === oldInteractionZoom) return;

    const anchorOffset = treeViewMode === "circular" ? viewportController.getSnapshot().offset : viewOffset;
    const pointerX = treeViewMode === "circular" ? rect.width / 2 : event.clientX - rect.left;
    const pointerY = treeViewMode === "circular" ? rect.height / 2 : event.clientY - rect.top;
    const worldX = (pointerX - anchorOffset.x) / oldZoom;
    const worldY = (pointerY - anchorOffset.y) / oldZoom;

    const nextOffset = {
      x: pointerX - worldX * nextZoom,
      y: pointerY - worldY * nextZoom,
    };
    setInteractionZoom(nextInteractionZoom);
    setViewZoom(nextZoom);
    setViewOffset(nextOffset);
  }

  function startViewerPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, .context-menu, .modal-card, .heatmap-legend-box, .heat-cell, .circular-heat-cell, .column-label-hit, .circular-column-label-hit, .circular-branch-hit, .circular-node-hit, .circular-labels, .rectangular-tree-event-surface, .rectangular-row-hit, .rectangular-node-hit, .rectangular-strip-hit, .cart-drawer, .instrument-drawer")) return;
    const viewport = viewerScrollRef.current;
    if (!viewport) return;
    const canPan = true;
    panDraftRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewportController.getSnapshot().offset.x,
      originY: viewportController.getSnapshot().offset.y,
      moved: false,
      canPan,
    };
    setIsPanning(true);
    viewport.setPointerCapture(event.pointerId);
  }

  function moveViewerPan(event: ReactPointerEvent<HTMLDivElement>) {
    const draft = panDraftRef.current;
    if (!draft) return;
    if (draft.pointerId !== event.pointerId) return;
    const dx = event.clientX - draft.startX;
    const dy = event.clientY - draft.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) draft.moved = true;
    if (!draft.canPan) return;
    setViewOffset({ x: draft.originX + dx, y: draft.originY + dy });
    if (panAnimationFrameRef.current !== null) return;
    panAnimationFrameRef.current = window.requestAnimationFrame(() => {
      panAnimationFrameRef.current = null;
      const nextOffset = viewportController.getSnapshot().offset;
      const content = viewerContentRef.current;
      if (content) {
        content.style.transform = treeViewMode === "circular"
          ? `translate(${nextOffset.x - draft.originX}px, ${nextOffset.y - draft.originY}px)`
          : `translate(${nextOffset.x}px, ${nextOffset.y}px) scale(${viewportController.getSnapshot().zoom})`;
      }
      const legend = heatmapLegendRef.current;
      if (legend && heatmapLegend?.open) {
        legend.style.left = `${nextOffset.x + heatmapLegend.x * viewportController.getSnapshot().zoom}px`;
        legend.style.top = `${nextOffset.y + heatmapLegend.y * viewportController.getSnapshot().zoom}px`;
      }
      const annotation = taxonAnnotationRef.current;
      if (annotation && taxonAnnotation?.open) {
        annotation.style.left = `${nextOffset.x + taxonAnnotation.x * viewportController.getSnapshot().zoom}px`;
        annotation.style.top = `${nextOffset.y + taxonAnnotation.y * viewportController.getSnapshot().zoom}px`;
      }
    });
  }

  function finishViewerPan(event: ReactPointerEvent<HTMLDivElement>) {
    const draft = panDraftRef.current;
    const scrollNode = viewerScrollRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    panDraftRef.current = null;
    if (panAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(panAnimationFrameRef.current);
      panAnimationFrameRef.current = null;
    }
    if (treeViewMode === "circular" && viewerContentRef.current) {
      viewerContentRef.current.style.transform = "";
    }
    setViewOffset(viewportController.getSnapshot().offset);
    setIsPanning(false);
    if (scrollNode?.hasPointerCapture(event.pointerId)) scrollNode.releasePointerCapture(event.pointerId);
  }

  function openColumnMenu(event: ReactMouseEvent<SVGGraphicsElement>, column: DisplayColumn) {
    event.preventDefault();
    event.stopPropagation();
    setColumnMenu({ open: true, x: event.clientX, y: event.clientY, targetValue: normalizeColumnKey(column) });
  }

  function startColumnDrag(event: ReactMouseEvent<SVGGraphicsElement>, column: DisplayColumn) {
    if (event.button !== 0) return;
    if (event.ctrlKey) return;
    event.stopPropagation();
    const draft = {
      value: normalizeColumnKey(column),
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      moved: false,
    };
    columnDragDraftRef.current = draft;
    setColumnDragDraft(draft);
  }

  function resolveColumnDropSlotIndex(draft: ColumnDragDraft) {
    if (treeViewMode === "circular") {
      const circularSurface = document.querySelector<HTMLElement>(".circular-tree-event-surface, .circular-tree-svg");
      if (!circularSurface) return null;
      const rect = circularSurface.getBoundingClientRect();
      const innerRadius = circularSceneGeometry.radialLayout.heatmapInnerRadius;
      const ringWidth = effectiveCircularHeatmapRingWidth;
      const ringGap = circularSceneGeometry.radialLayout.ringGap;
      const surfaceZoom = viewZoom;
      const surfaceOffsetX = viewOffset.x;
      const surfaceOffsetY = viewOffset.y;
      if (!Number.isFinite(innerRadius) || !Number.isFinite(ringWidth) || ringWidth <= 0) return null;
      const localX = (draft.currentX - rect.left - surfaceOffsetX) / surfaceZoom;
      const localY = (draft.currentY - rect.top - surfaceOffsetY) / surfaceZoom;
      const radius = Math.hypot(localX - circularSize / 2, localY - circularSize / 2);
      const stride = ringWidth + (Number.isFinite(ringGap) ? ringGap : 0);
      if (radius < innerRadius - Math.max(1, stride) / 2) return null;
      return Math.max(0, Math.floor((radius - innerRadius) / Math.max(1, stride)));
    }

    const svg = document.querySelector<HTMLElement>(".heatmap-svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (draft.currentX < rect.left || draft.currentY < rect.top || draft.currentY > rect.bottom) return null;
    const localX = (draft.currentX - rect.left) / viewZoom;
    return Math.max(0, Math.floor((localX - 20) / heatmapColumnWidth));
  }

  function finishColumnDrag() {
    const draft = columnDragDraftRef.current;
    if (!draft) return;
    columnDragDraftRef.current = null;
    setColumnDragDraft(null);
    if (!draft.moved || !resultSession) return;

    suppressColumnClickRef.current = draft.value;
    window.setTimeout(() => {
      if (suppressColumnClickRef.current === draft.value) {
        suppressColumnClickRef.current = null;
      }
    }, 0);

    const targetSlotIndex = resolveColumnDropSlotIndex(draft);
    if (targetSlotIndex === null) return;
    const visibleColumnKeys = new Set(
      resultSession.columns
        .filter((column) => (showModuleCompleteness || !isModuleCompletenessColumn(column)) && (showModuleDetail || !isModuleDetailColumn(column)))
        .map(normalizeColumnKey),
    );
    executeQueryCommand({
      type: "move-column",
      columnKey: draft.value,
      targetIndex: targetSlotIndex,
      visibleColumnKeys: [...visibleColumnKeys],
    });
  }

  function handleColumnPrimaryAction(column: DisplayColumn) {
    if (suppressColumnClickRef.current === normalizeColumnKey(column)) {
      suppressColumnClickRef.current = null;
      return;
    }
    if (!isHeatmapStyleSelecting) return;
    selectColumns([normalizeColumnKey(column)]);
  }

  function selectColumns(columnKeys: string[]) {
    applyHeatmapSelectionTargets(columnKeys);
    setColumnMenu(emptyColumnMenu());
  }

  function deleteColumn() {
    if (!columnMenu.targetValue) return;
    removeSearchColumnByKey(columnMenu.targetValue);
    setColumnMenu(emptyColumnMenu());
  }

  function removeSearchColumnByKey(columnKey: string) {
    if (!resultSession) return false;
    const result = executeQueryCommand({ type: "remove-column", columnKey });
    if (!result?.accepted) return false;
    setSelectedCells((current) => {
      const next = new Set<string>();
      current.forEach((key) => {
        if (splitCellKeyParts(key)?.columnKey !== columnKey) next.add(key);
      });
      return next;
    });
    setHeatmapStyles((current) => removeHeatmapColumnStyles(current, columnKey));
    return true;
  }

  function openInsertDialog(side: "left" | "right") {
    if (!columnMenu.targetValue) return;
    startTransition(() => setInsertDialog({ open: true, side, targetValue: columnMenu.targetValue, type: "cog", value: "", selected: null }));
    setColumnMenu(emptyColumnMenu());
  }

  function insertSearchColumn(
    column: SearchColumn,
    options: { targetValue?: string | null; side?: "left" | "right" } = {},
  ) {
    if (!resultSession) return false;
    const visibleColumnKeys = [...resultSession.columns, column]
      .filter((item) => (showModuleCompleteness || !isModuleCompletenessColumn(item)) && (showModuleDetail || !isModuleDetailColumn(item)))
      .map(normalizeColumnKey);
    const result = executeQueryCommand({
      type: "insert-column",
      column,
      targetColumnKey: options.targetValue,
      side: options.side,
      visibleColumnKeys,
    });
    return Boolean(result?.accepted);
  }

  async function confirmInsertColumn() {
    if (!activeDataset || !resultSession || !insertDialog.targetValue) return;
    const trimmedValue = insertDialog.value.trim();
    let selected = insertDialog.selected;
    if (!selected && trimmedValue) {
      const candidates = insertSuggestions.length ? insertSuggestions : await fetchSuggestions(insertDialog.type, trimmedValue);
      const normalized = trimmedValue.toLowerCase();
      const exact = candidates.filter(
        (item) =>
          item.value.toLowerCase() === normalized ||
          item.short_name?.toLowerCase() === normalized ||
          item.full_name?.toLowerCase() === normalized,
      );
      if (exact.length === 1) selected = exact[0];
      else if (candidates.length === 1) selected = candidates[0];
      else if (candidates.length > 1) {
        setError("Multiple annotations matched. Pick one suggestion first.");
        return;
      }
    }
    const condition: AnnotationCondition = {
      id: `insert-${Date.now()}`,
      type: selected?.type ?? insertDialog.type,
      value: selected?.value ?? insertDialog.value,
      selected,
    };
    const baseRevision = workbenchController.getSnapshot().revision;
    try {
      const result = await searchAnnotationColumns(activeDataset.species_tree, activeDataset.genome_database, [condition]);
      if (baseRevision !== workbenchController.getSnapshot().revision) {
        setError("The query changed while the annotation was resolving. Insert it again.");
        return;
      }
      if (result.columns.length !== 1) {
        setError(localizedText(language, "当前每次只能插入一个标准功能注释列。", "Insert currently supports a single standard annotation column."));
        return;
      }
      if (!insertSearchColumn(result.columns[0], { targetValue: insertDialog.targetValue, side: insertDialog.side })) return;
      setInsertDialog(emptyInsertDialog());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to insert annotation column.");
    }
  }

  async function addHeatmapColumn(batchConditions?: AnnotationCondition[]) {
    if (!activeDataset || !resultSession) return;
    const queryConditions = batchConditions ?? heatmapQueryConditions.filter((condition) => condition.value.trim());
    if (!queryConditions.length) {
      setError(localizedText(language, "请至少添加一条要追加的查询。", "Add at least one query to append."));
      return;
    }

    const preparation = prepareAnnotationSearchConditions(
      queryConditions,
      heatmapQuerySuggestionsById,
      heatmapModuleSuggestionsById,
    );
    if (preparation.ambiguity) {
      setHeatmapQueryActiveSuggestionId(preparation.ambiguity.conditionId);
      setError(localizedText(
        language,
        preparation.ambiguity.kind === "module" ? "多个 Module 匹配，请先选择一个候选项。" : "多个注释匹配，请先选择一个候选项。",
        preparation.ambiguity.kind === "module" ? "Multiple modules matched. Pick one suggestion first." : "Multiple annotations matched. Pick one suggestion first.",
      ));
      return;
    }

    const baseRevision = workbenchController.getSnapshot().revision;
    try {
      setIsAppendingHeatmapQueries(true);
      const searchedColumns = await searchAnnotationColumns(activeDataset.species_tree, activeDataset.genome_database, preparation.conditions);
      if (baseRevision !== workbenchController.getSnapshot().revision) {
        setError("The query changed while columns were resolving. Add them again.");
        return;
      }
      const guarded = await executeQueryColumnAddition(
        workbenchController.getSnapshot().resultSession,
        searchedColumns,
        "append",
        () => {
          const result = executeQueryCommand({ type: "append", result: searchedColumns });
          return { status: result?.accepted ? "accepted" : "rejected", result } as const;
        },
      );
      if (guarded.status === "cancelled") return;
      if (guarded.status === "rejected") {
        setError(localizedText(language, "这些查询列已存在于当前热图中。", "These query columns are already present in the current heatmap."));
        return;
      }
      if (batchConditions) resetHeatmapBatchQueryDialog();
      else resetHeatmapQueryDialog();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to append annotation column.");
    } finally {
      setIsAppendingHeatmapQueries(false);
    }
  }

  function toggleCellByKey(key: string) {
    const [rowId, columnKey] = key.split("::");
    const row = visibleRows.find((item) => item.id === rowId);
    const column = resultSession?.columns.find((item) => normalizeColumnKey(item) === columnKey);
    if (!row || !column) return;
    setSelectedCells((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCell(row: Pick<VisibleRow, "id">, column: SearchColumn, _count: number) {
    toggleCellByKey(rowCellKey(row, column));
  }

  function resolveHeatmapCellKeyAtPoint(clientX: number, clientY: number) {
    const heatmapRect = getHeatmapBodyRect();
    if (!heatmapRect) return null;
    return hitHeatmapCellKeyAtPoint({
      clientX,
      clientY,
      heatmapBodyRect: heatmapRect,
      viewZoom,
      visibleRows,
      columns: displayColumns,
      rowCounts,
      geometry: {
        heatmapColumnWidth,
        rowHeight,
        terminalBands,
        heatmapLeftOffset: 20,
      },
    });
  }

  function toggleHeatmapCellAtPoint(event: ReactMouseEvent<SVGGraphicsElement>) {
    if (!shouldHandleHeatmapCellClick({ isStyleSelecting: isHeatmapStyleSelecting, ctrlKey: event.ctrlKey })) return;
    const key = resolveHeatmapCellKeyAtPoint(event.clientX, event.clientY);
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    toggleCellByKey(key);
  }

  function hoverHeatmapCellAtPoint(event: ReactMouseEvent<SVGGraphicsElement>) {
    setHoveredCellKey(resolveHeatmapCellKeyAtPoint(event.clientX, event.clientY));
    setHoveredColumnKey(null);
  }

  function startMarquee(event: ReactMouseEvent<HTMLDivElement>) {
    if (!shouldStartHeatmapMarquee({ isStyleSelecting: isHeatmapStyleSelecting, button: event.button, ctrlKey: event.ctrlKey })) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, .context-menu, .modal-card, .heatmap-legend-box")) return;
    event.preventDefault();
    const draft = { active: true, mode: "heatmap" as const, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY };
    selectionDraftRef.current = draft;
    setSelectionDraft(draft);
    scheduleMarqueeBoxRender();
  }

  function pointInRect(x: number, y: number, rect: ScreenRect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getHeatmapBodyRect(): ScreenRect | null {
    const svg = document.querySelector<HTMLElement>(".heatmap-svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top + headerHeight * viewZoom,
      bottom: rect.bottom,
    };
  }

  function hitCircularCellKeysInRect(selectionRect: ScreenRect) {
    const circularSurface = document.querySelector<HTMLElement>(".circular-tree-event-surface, .circular-tree-svg");
    if (!circularSurface || !displayColumns.length || !visibleRows.length) return [];
    const rect = circularSurface.getBoundingClientRect();
    const innerRadius = circularSceneGeometry.radialLayout.heatmapInnerRadius;
    const ringWidth = effectiveCircularHeatmapRingWidth;
    const ringGap = circularSceneGeometry.radialLayout.ringGap;
    const surfaceZoom = viewZoom;
    const surfaceOffsetX = viewOffset.x;
    const surfaceOffsetY = viewOffset.y;
    if (!rect.width || !rect.height || !Number.isFinite(innerRadius) || !Number.isFinite(ringWidth) || ringWidth <= 0) return [];

    const { startAngle, leafStep } = circularSceneGeometry.angular;
    const stride = ringWidth + (Number.isFinite(ringGap) ? ringGap : 0);
    const center = circularSize / 2;
    const hitKeys: string[] = [];

    visibleRows.forEach((row, rowIndex) => {
      const angle = startAngle + rowIndex * leafStep + leafStep / 2;
      displayColumns.forEach((column) => {
        const radius = innerRadius + column.slotIndex * stride + ringWidth / 2;
        const screenX = rect.left + surfaceOffsetX + (center + Math.cos(angle) * radius) * surfaceZoom;
        const screenY = rect.top + surfaceOffsetY + (center + Math.sin(angle) * radius) * surfaceZoom;
        if (!pointInRect(screenX, screenY, selectionRect)) return;
        const key = rowCellKey(row, column);
        hitKeys.push(key);
      });
    });

    return hitKeys;
  }

  function resolveSelectableHeatmapCellKeys(columnKeys: string[], directCellKeys: string[] = []) {
    const resolvedKeys = new Set(directCellKeys);
    if (!resultSession || !columnKeys.length) {
      return Array.from(resolvedKeys);
    }
    const columnsByKey = columnByKey(resultSession.columns);
    columnKeys.forEach((columnKey) => {
      const column = columnsByKey.get(columnKey);
      if (!column) return;
      heatmapCellKeysForRows(visibleRows, [column]).forEach((key) => resolvedKeys.add(key));
    });
    return Array.from(resolvedKeys);
  }

  function applyHeatmapSelectionTargets(columnKeys: string[], directCellKeys: string[] = []) {
    const targetCellKeys = resolveSelectableHeatmapCellKeys(columnKeys, directCellKeys);
    if (!targetCellKeys.length) return;
    setSelectedCells((current) => {
      const next = new Set(current);
      const shouldSelect = targetCellKeys.some((key) => !next.has(key));
      targetCellKeys.forEach((key) => {
        if (shouldSelect) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }

  function finishMarqueeSelection() {
    const draft = selectionDraftRef.current;
    if (!draft?.active) {
      setSelectionDraft(null);
      return;
    }
    const left = Math.min(draft.startX, draft.currentX);
    const right = Math.max(draft.startX, draft.currentX);
    const top = Math.min(draft.startY, draft.currentY);
    const bottom = Math.max(draft.startY, draft.currentY);
    selectionDraftRef.current = null;
    clearMarqueeFrame();
    if (Math.abs(right - left) < 4 || Math.abs(bottom - top) < 4) {
      setSelectionDraft(null);
      return;
    }
    const selectionRect = { left, right, top, bottom };
    const hitCellKeys = treeViewMode === "circular"
      ? hitCircularCellKeysInRect(selectionRect)
      : (() => {
        const heatmapRect = getHeatmapBodyRect();
        return heatmapRect ? hitHeatmapCellKeysInRect({
          selectionRect,
          heatmapBodyRect: heatmapRect,
          viewZoom,
          visibleRows,
          columns: displayColumns,
          rowCounts,
          geometry: {
            heatmapColumnWidth,
            rowHeight,
            terminalBands,
            heatmapLeftOffset: 20,
          },
        }) : [];
      })();
    applyHeatmapSelectionTargets([], hitCellKeys);
    setSelectionDraft(null);
  }

  function selectedHeatmapLeafKeys() {
    const rowById = new Map(visibleRows.map((row) => [row.id, row]));
    const columnsByKey = columnByKey(resultSession?.columns ?? []);
    const leafKeys: string[] = [];
    selectedCells.forEach((key) => {
      const parsed = splitCellKeyParts(key);
      if (!parsed) return;
      const row = rowById.get(parsed.rowId);
      const column = columnsByKey.get(parsed.columnKey);
      if (!row || !column) return;
      row.ownedLeafNodeIds.forEach((leafNodeId) => {
        leafKeys.push(leafCellKey(leafNodeId, column));
      });
    });
    return leafKeys;
  }

  function openHeatmapStyleDialogFromSelection() {
    const leafKeys = selectedHeatmapLeafKeys();
    if (!leafKeys.length) return;
    startTransition(() => setHeatmapStyleDialog({
        open: true,
        paletteId: fallbackHeatmapStyle.paletteId,
        shape: fallbackHeatmapStyle.shape || fallbackShapeForMode(treeViewMode),
        name: "",
        colorScales: colorScalesForStyle(fallbackHeatmapStyle),
        metric: heatmapMetric,
      }));
  }

  function createHeatmapStyleFromDialog() {
    const leafKeys = selectedHeatmapLeafKeys();
    if (!leafKeys.length) return;
    const nextHeatmapStyles = createStyleFromLeafKeys({
      styles: heatmapStyles,
      treeViewMode,
      leafCellKeys: leafKeys,
      paletteId: heatmapStyleDialog.paletteId,
      colorScales: heatmapStyleDialog.colorScales,
      shape: heatmapStyleDialog.shape,
      name: heatmapStyleDialog.name.trim(),
    });
    executeHeatmapCommand({ type: "replace-styles", styles: nextHeatmapStyles });
    setSelectedCells(new Set());
    setIsHeatmapStyleSelecting(false);
    setHeatmapStyleDialog((current) => ({ ...current, open: false, name: "" }));
  }

  function clearCurrentTreeHeatmapStyles() {
    const nextHeatmapStyles = resetHeatmapStylesForMode(heatmapStyles, treeViewMode);
    setHeatmapStyles(nextHeatmapStyles);
  }

  function updateCurrentHeatmapStyle(styleId: string, patch: Partial<Pick<HeatmapStyleRecord, "paletteId" | "colorScales" | "shape" | "borderMode" | "name">>) {
    executeHeatmapCommand({ type: "update-style", styleId, patch });
  }

  function removeCurrentHeatmapStyle(styleId: string) {
    setHeatmapStyles((current) => removeHeatmapStyle(current, styleId));
    if (editingHeatmapStyleId === styleId) setEditingHeatmapStyleId(null);
  }

  function treeStyleSnapshot(nodeId: number) {
    if (!treeModel) return [nodeId];
    const nodeIds = new Set<number>([nodeId]);
    const aliveLeafNodeIdSet = new Set(currentAliveLeafNodeScope);
    treeModel.forEachLeafNodeId(nodeId, (leafNodeId) => {
      if (!aliveLeafNodeIdSet.has(leafNodeId)) return;
      treeModel.nodePathBetween(nodeId, leafNodeId).forEach((nodeId) => nodeIds.add(nodeId));
    });
    return Array.from(nodeIds).sort((left, right) => treeModel.runtime.nodeIn[left] - treeModel.runtime.nodeIn[right]);
  }

  function canAddTreeStyle(nodeId: number | null) {
    return nodeId !== null && Boolean(treeModel?.childrenOf(nodeId).length);
  }

  function openTreeStyleDialog(nodeId: number) {
    if (!canAddTreeStyle(nodeId)) return;
    setTreeStyleDialog({ open: true, nodeId, kind: defaultTreeStyleKindForNode("internal"), color: "#D32F2F" });
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
  }

  function createTreeStyleFromDialog() {
    const nodeId = treeStyleDialog.nodeId;
    const color = normalizeTreeStyleColor(treeStyleDialog.color);
    if (nodeId === null || !canAddTreeStyle(nodeId)) {
      setError(localizedText(language, "当前节点不能应用颜色样式。", "The current node cannot receive a color style."));
      return;
    }
    if (!color) {
      setError(localizedText(language, "请输入 6 位十六进制颜色，例如 #1A73E8。", "Enter a 6-digit hexadecimal color such as #1A73E8."));
      return;
    }
    const nextTreeStyles = appendTreeStyleWithCoveragePruning(treeStyles, {
      id: createTreeStyleId(),
      createdOrder: treeStyles.reduce((max, style) => Math.max(max, style.createdOrder), -1) + 1,
      kind: treeStyleDialog.kind,
      color,
      name: nextTreeStyleName(treeStyles),
      nodeId,
      nodeIds: treeStyleSnapshot(nodeId),
    });
    setTreeStyles(nextTreeStyles);
    setTreeStyleDialog({ open: false, nodeId: null, kind: "label", color: "#D32F2F" });
    setError(null);
  }

  function updateCurrentTreeStyle(styleId: string, patch: Partial<Pick<TreeStyleRecord, "kind" | "color" | "name">>) {
    if (patch.color !== undefined) {
      const color = normalizeTreeStyleColor(patch.color);
      if (!color) {
        setError(localizedText(language, "请输入 6 位十六进制颜色，例如 #1A73E8。", "Enter a 6-digit hexadecimal color such as #1A73E8."));
        return false;
      }
      const nextTreeStyles = updateTreeStyle(treeStyles, styleId, { ...patch, color });
      setTreeStyles(nextTreeStyles);
      setError(null);
      return true;
    }
    const nextTreeStyles = updateTreeStyle(treeStyles, styleId, patch);
    setTreeStyles(nextTreeStyles);
    return true;
  }

  function removeCurrentTreeStyle(styleId: string) {
    const nextTreeStyles = treeStyles.filter((style) => style.id !== styleId);
    setTreeStyles(nextTreeStyles);
  }

  function clearCurrentTreeStyles() {
    if (!treeStyles.length) return;
    setTreeStyles([]);
  }

  function createDefaultHeatmapLegendState(): HeatmapLegendState {
    const workbenchRect = workbenchRef.current?.getBoundingClientRect();
    const screenWidth = 460;
    const screenHeight = 150;
    const safeZoom = Math.max(0.01, viewportController.getSnapshot().zoom);
    const currentOffset = viewportController.getSnapshot().offset;
    const drawerWidth = drawerOpen ? controlDrawerWidth : 52;
    const visibleCanvasRight = workbenchRect
      ? workbenchRect.width - Math.min(drawerWidth, Math.max(0, workbenchRect.width - 24))
      : undefined;
    const screenX = visibleCanvasRight !== undefined
      ? Math.max(24, visibleCanvasRight - screenWidth - 24)
      : 64;
    const screenY = 72;
    return {
      open: true,
      x: (screenX - currentOffset.x) / safeZoom,
      y: (screenY - currentOffset.y) / safeZoom,
      width: screenWidth,
      height: screenHeight,
    };
  }

  function setHeatmapLegendVisible(visible: boolean) {
    setHeatmapLegend((current) => {
      if (visible) {
        return current ? { ...current, open: true } : createDefaultHeatmapLegendState();
      }
      return current ? { ...current, open: false } : current;
    });
  }

  function startFloatingLegendInteraction(
    event: ReactPointerEvent<HTMLDivElement>,
    mode: FloatingLegendInteractionMode,
    state: HeatmapLegendState | null,
    draftRef: { current: FloatingLegendInteractionDraft | null },
  ) {
    if (!state || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draftRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startZoom: viewportController.getSnapshot().zoom,
      startSizeScale: viewportController.getSnapshot().zoom / Math.max(0.0001, treeViewMode === "circular" ? viewportController.getSnapshot().circular.fitScale ?? 1 : viewportController.getSnapshot().rectangular.fitScale),
      originX: state.x,
      originY: state.y,
      originWidth: state.width,
      originHeight: state.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveFloatingLegend(
    event: ReactPointerEvent<HTMLDivElement>,
    draftRef: { current: FloatingLegendInteractionDraft | null },
    setState: Dispatch<SetStateAction<HeatmapLegendState | null>>,
  ) {
    const draft = draftRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setState((current) => current
      ? updateFloatingLegendInteraction(current, draft, event.clientX, event.clientY)
      : current);
  }

  function finishFloatingLegendInteraction(
    event: ReactPointerEvent<HTMLDivElement>,
    draftRef: { current: FloatingLegendInteractionDraft | null },
  ) {
    const draft = draftRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    draftRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function createDefaultTaxonAnnotationState(): HeatmapLegendState {
    const workbenchRect = workbenchRef.current?.getBoundingClientRect();
    const screenWidth = 420;
    const screenHeight = 180;
    const safeZoom = Math.max(0.01, viewportController.getSnapshot().zoom);
    const currentOffset = viewportController.getSnapshot().offset;
    const drawerWidth = drawerOpen ? controlDrawerWidth : 52;
    const visibleCanvasRight = workbenchRect
      ? workbenchRect.width - Math.min(drawerWidth, Math.max(0, workbenchRect.width - 24))
      : undefined;
    const screenX = treeViewMode === "rectangular"
      ? RECTANGULAR_FIT_PADDING + RECTANGULAR_TAXON_ANNOTATION_INSET
      : visibleCanvasRight !== undefined
        ? Math.max(24, visibleCanvasRight - screenWidth - 24)
        : 64;
    const screenY = heatmapLegend?.open ? 246 : 72;
    return {
      open: true,
      x: (screenX - currentOffset.x) / safeZoom,
      y: (screenY - currentOffset.y) / safeZoom,
      width: screenWidth,
      height: screenHeight,
    };
  }

  useEffect(() => {
    const key = `${showStrip}:${taxonNameDisplayMode}:${activeStripRank}`;
    if (taxonAnnotationRestoreKeyRef.current === key) return;
    taxonAnnotationRestoreKeyRef.current = null;
    const visible = showStrip && taxonNameDisplayMode === "annotation" && activeStripRank !== "none";
    setTaxonAnnotation((current) => {
      if (visible) return current ? { ...current, open: true } : createDefaultTaxonAnnotationState();
      return current?.open ? { ...current, open: false } : current;
    });
  }, [activeStripRank, showStrip, taxonNameDisplayMode]);

  function changeTreeSpacingScale(value: number) {
    const nextSpacingScale = clamp(value, 1, 10);
    executeAppearanceCommand({ type: "set-scale", key: "spacingScale", value: nextSpacingScale });
  }

  function toggleHeatmapRowsForNode(nodeId: number) {
    applyHeatmapSelectionTargets([], [...heatmapCellKeysForRenderNode(renderSnapshot, nodeId)]);
  }

  function beginHeatmapStyleSelection() {
    setSelectedCells(new Set());
    setColumnMenu(emptyColumnMenu());
    setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
    setIsHeatmapStyleSelecting(true);
  }

  function cancelHeatmapStyleSelection() {
    selectionDraftRef.current = null;
    clearMarqueeFrame();
    setSelectionDraft(null);
    setSelectedCells(new Set());
    setIsHeatmapStyleSelecting(false);
  }

  function confirmHeatmapStyleSelection() {
    if (!selectedCells.size) return;
    setIsHeatmapStyleSelecting(false);
    openHeatmapStyleDialogFromSelection();
  }

  function dismissHeatmapStyleDialog() {
    setHeatmapStyleDialog((current) => ({ ...current, open: false, name: "" }));
    setSelectedCells(new Set());
  }

  function setModuleDetailVisibility(value: boolean) {
    if (value && !showModuleDetail && resultSession) {
      setColumnSlots((current) => placeModuleDetailsBeforeCompleteness(
        normalizeHeatmapColumnSlots(current, resultSession.columns),
        resultSession.module_groups,
      ));
    }
    executeHeatmapCommand({ type: "set-module-view", showDetail: value });
  }

  function rerootSpecForNodeMenu(menu: NodeMenuState) {
    if (menu.nodeId === null || !canvasTreeRuntime) return null;
    const layoutNode = menuTreeLayoutNode(menu);
    if (!layoutNode || layoutNode.parent === null || layoutNode.nodePath.length < 2) return null;
    try {
      return createRerootSpecForCanvasPath(canvasTreeRuntime, layoutNode.nodePath);
    } catch {
      return null;
    }
  }

  function canSwapVisibleBranch(nodeId: number) {
    if (!treeModel) return false;
    const layoutNode = treeLayoutNodes.find((node) => node.nodeId === nodeId);
    return layoutNode?.kind === "internal"
      && layoutNode.children.length === 2
      && treeModel.childrenOf(nodeId).length === 2;
  }

  function currentSwappedBranchNodeIds() {
    if (!rawTreeModel || !canvasTreeRuntime) return [];
    return swappedBranchNodeIdsFromAliveTree(rawTreeModel.runtime, canvasTreeRuntime);
  }

  function swapVisibleBranch(nodeId: number) {
    if (!canvasTreeRuntime || !rawTreeModel || !treeModel || !canSwapVisibleBranch(nodeId)) return;
    executeTreeCommand({ type: "swap-branches", nodeId });
  }

  function performCanvasReroot(nextRerootSpec: AliveTreeRuntime["rerootSpec"]) {
    if (!treeModel || !rawTreeModel || !canvasTreeRuntime || !effectiveAliveBitset) return;
    if (viewRoot !== null) {
      setError(localizedText(language, "请先重置当前视图根，再进行重新定根。", "Reset the current view root before rerooting."));
      return;
    }
    if (rerootSpecsEqual(canvasTreeRuntime.rerootSpec, nextRerootSpec) && !currentSwappedBranchNodeIds().length) {
      setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
      return;
    }
    const result = executeTreeCommand({ type: "reroot", rerootSpec: nextRerootSpec });
    if (!result?.accepted) return;
    applyBranchPruneStateSnapshot({ status: "idle", errorCode: null, errorDetail: null, summary: null });
    setBranchPrunePreviewNodeIds(new Set());
    setTreeSearchPickedItem(null);
    setDetailRankPickedItem(null);
    setRenderNotice(localizedText(
      language,
      treeStyles.length ? "物种树已重新定根，原树样式已清除。" : "物种树已重新定根。",
      treeStyles.length ? "The tree was rerooted and previous tree styles were cleared." : "The tree was rerooted.",
    ));
    window.setTimeout(() => setRenderNotice(""), 1200);
  }

  function rerootFromNodeMenu() {
    const rerootSpec = rerootSpecForNodeMenu(nodeMenu);
    if (rerootSpec) performCanvasReroot(rerootSpec);
  }

  function changeHeatmapColumnWidth(value: number) {
    if (treeViewMode === "rectangular" && rectangularHeatmapUsesSquareCells) return;
    if (!Number.isFinite(value)) return;
    const nextColumnWidth = Math.round(Math.max(value, treeViewMode === "circular" ? 4 : 8));
    executeAppearanceCommand({
      type: "set-scale",
      key: treeViewMode === "rectangular" ? "rectangularHeatmapColumnWidth" : "circularHeatmapRingWidth",
      value: nextColumnWidth,
    });
  }

  const selectedCellKeys = selectedCells;
  const effectiveSelectedCount = selectedCellKeys.size;
  async function executeDownload(downloadMode: "all" | "representative", headerFields: string[]) {
    if (!activeDataset) return;
    if (!accountEmail) {
      setError(localizedText(language, "请先登录后再下载序列。", "Sign in before downloading sequences."));
      return;
    }
    if (!rawTreeModel || !aliveBitset) {
      setError(localizedText(language, "当前没有可下载的查询范围。", "There is no active query scope to download."));
      return;
    }
    if (!downloadColumns.length) {
      setError(localizedText(language, "当前结果中没有可下载的功能注释列。", "There are no downloadable annotation columns in the current result."));
      return;
    }

    const activeLeafNodeIds = leafNodeIdsFromAliveBitset(rawTreeModel, aliveBitset);
    const branchScopes = downloadMode === "all"
      ? [{ branchId: "alive-scope", branchLabel: localizedText(language, "当前查询范围", "Current query scope"), branchRank: null, leafCount: activeLeafNodeIds.length, leafNodeIds: activeLeafNodeIds }]
      : (() => {
        const seen = new Set<number>();
        const scopes = terminalNodeTable
          .map((row) => ({ ...row, ownedLeafNodeIds: row.ownedLeafNodeIds.filter((id) => aliveBitset[id] === 1) }))
          .filter((row) => row.ownedLeafNodeIds.length)
          .map((row) => {
            row.ownedLeafNodeIds.forEach((id) => seen.add(id));
            return { branchId: `terminal-${row.nodeId}`, branchLabel: row.label, branchRank: row.rank, nodeId: row.nodeId, leafCount: row.ownedLeafNodeIds.length, leafNodeIds: row.ownedLeafNodeIds };
          });
        activeLeafNodeIds.filter((id) => !seen.has(id)).forEach((id) => scopes.push({ branchId: `leaf-${id}`, branchLabel: rawTreeModel.sourceLabel(id, "species"), branchRank: "species", nodeId: id, leafCount: 1, leafNodeIds: [id] }));
        return scopes;
      })();
    if (!branchScopes.length) {
      setError(localizedText(language, "下载列表中没有仍然存活的末端。", "The download list has no retained tips to download."));
      return;
    }
    const columnScopes = downloadColumns.map((column) => ({
      columnId: column.column_id ?? null,
      annotationType: column.type,
      annotationValue: column.value,
      annotationId: column.annotation_id ?? null,
      annotationLabel: column.displayLabel,
      moduleId: column.module_id ?? null,
      moduleName: column.module_name ?? null,
      stepId: column.step_id ?? null,
      stepLabel: column.step_label ?? null,
    }));

    setError(null);
    setIsPreparingDownload(true);
    setDownloadTaskProgress(null);
    try {
      const task = await downloadSequences(
        activeDataset.species_tree,
        activeDataset.genome_database,
        branchScopes,
        columnScopes,
        headerFields,
        downloadMode,
      );
      setDownloadTaskProgress({
        task_id: task.task_id,
        status: "queued",
        stage: "queued",
        completed_files: 0,
        total_files: columnScopes.length,
      });
      const result = await waitForSequenceDownload(task, setDownloadTaskProgress, 1000, accountEmail);
      const downloadLink = document.createElement("a");
      downloadLink.href = result.download_url;
      downloadLink.download = "";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : localizedText(language, "下载失败", "Download failed"));
    } finally {
      setIsPreparingDownload(false);
      setDownloadTaskProgress(null);
      setDownloadHeaderDialog((current) => ({ ...current, open: false }));
    }
  }

  function openDownloadDialog() {
    if (!aliveBitset || !rawTreeModel || !leafNodeIdsFromAliveBitset(rawTreeModel, aliveBitset).length) {
      setError(localizedText(language, "当前没有可下载的查询范围。", "There is no active query scope to download."));
      return;
    }
    if (!downloadColumns.length) {
      setError(localizedText(language, "当前结果中没有可下载的功能注释列。", "There are no downloadable annotation columns in the current result."));
      return;
    }
    startTransition(() => setDownloadHeaderDialog((current) => ({
        open: true,
        mode: current.mode,
        fields: current.fields.length ? current.fields : ["protein_name"],
      })));
    setIsPreparingDownload(false);
    setDownloadTaskProgress(null);
  }

  function captureCurrentCamera(): SavedCamera {
    const snapshot = viewportController.getSnapshot();
    const documentScale = Math.max(0.0001, snapshot.zoom);
    return {
      cameraSchemaVersion: 3,
      interactionScale: snapshot.interactionZoom,
      anchor: {
        x: (snapshot.viewport.width / 2 - snapshot.offset.x) / documentScale,
        y: (snapshot.viewport.height / 2 - snapshot.offset.y) / documentScale,
      },
      viewport: { ...snapshot.viewport },
    };
  }

  function applySavedCamera(saved: SavedCamera) {
    const camera = migrateLegacyCamera(saved);
    setInteractionZoom(camera.interactionScale);
    setResetCircularFitReference(false);
    resetViewerFitConvergence();
    const fitted = fitViewerToViewport();
    const snapshot = viewportController.getSnapshot();
    if (fitted) {
      const offset = cameraOffsetForViewport(camera, snapshot.viewport, snapshot.zoom);
      setViewOffset(offset);
      setPendingFit(false);
      setFitSettled(true);
    }
    restoredCameraActiveRef.current = true;
  }

  async function saveCurrentQuery(asNew = false) {
    if (!activeDataset || !rawTreeModel || savingWorkspaceRef.current) return;
    if (restoringWorkspaceRef.current || isSearching || isAppendingHeatmapQueries || isPanning || activeResizeTarget || columnDragDraft || selectionDraft) {
      setError(localizedText(language, "请先完成当前画布操作再保存。", "Finish the current canvas operation before saving.")); return;
    }
    const title = savedQueryTitle.trim();
    if (!title) { setError(localizedText(language, "请输入记录名称。", "Enter a record name.")); return; }
    savingWorkspaceRef.current = true; setIsSavingWorkspace(true);
    try {
      const pending = pendingSaveAttemptRef.current;
      let attempt = pending?.session === workspaceSessionRef.current && (!asNew || pending.target === null) ? pending : null;
      if (!attempt) {
        const state = workbenchController.getSnapshot();
        const cameras = { ...cameraByModeRef.current, [state.treeViewMode]: captureCurrentCamera() };
        const snapshot = captureWorkspaceDocument(rawTreeModel.runtime, state, {
          cameras, heatmapLegend, taxonAnnotation, drawerPanel, drawerOpen, controlDrawerWidth, selectedNodeId,
          scroll: { left: viewerScrollRef.current?.scrollLeft ?? 0, top: viewerScrollRef.current?.scrollTop ?? 0 },
          controlPanelScrollTop: resultPanelMode === "controls" ? controlPanelRef.current?.scrollTop ?? controlPanelScrollTop : controlPanelScrollTop,
        }, {
          queryMode, conditions, batchQueryText, branchPruneDraft, treeSearch, treeSearchRank, treeSearchPickedItem,
          detailRankSearch, detailRankSearchRank, detailRankTargetRank, heatmapQueryConditions, heatmapBatchQueryText,
          resultScopeSearch, resultScopeSearchRank, resultScopeExpandRank, customNameDraft,
          nameTarget: { nodeId: pendingNameNodeId, collapseRank: pendingNameCollapseRank },
          heatmapStyle: { open: heatmapStyleDialog.open, paletteId: heatmapStyleDialog.paletteId, shape: heatmapStyleDialog.shape, name: heatmapStyleDialog.name, colorScales: heatmapStyleDialog.colorScales, metric: heatmapStyleDialog.metric, editingId: editingHeatmapStyleId },
          treeStyle: { open: treeStyleDialog.open, nodeId: treeStyleDialog.nodeId, kind: treeStyleDialog.kind, color: treeStyleDialog.color },
        });
        const target = asNew ? null : restoredRecord;
        const payload = { title, category_id: savedQueryCategoryId, species_tree: activeDataset.species_tree,
          genome_database: activeDataset.genome_database, dataset_revision: activeDataset.dataset_revision ?? "unversioned",
          request_id: crypto.randomUUID(), expected_record_version: target?.record_version ?? null, snapshot };
        const token = workspaceChangeTokenRef.current, session = workspaceSessionRef.current;
        attempt = { payload, encoded: await runWorkspaceCodec<string>("encode", payload), target: target?.id ?? null, token, session };
        pendingSaveAttemptRef.current = attempt;
      }
      const result = attempt.target !== null ? await updateSavedQuery(attempt.target, attempt.payload, attempt.encoded) : await createSavedQuery(attempt.payload, attempt.encoded);
      pendingSaveAttemptRef.current = null;
      if (attempt.session === workspaceSessionRef.current) {
        setRestoredRecord({ ...result, title: attempt.payload.title, category_id: attempt.payload.category_id });
        setSavedWorkspaceToken(attempt.token);
      }
      setSaveDialogOpen(false);
      showNotice("success", localizedText(language, "画布已保存。", "Canvas saved."));
    } catch (reason) {
      // Definite rejection is safe to correct; ambiguous failures must reuse the request ID.
      if (reason instanceof ApiError && [400, 404, 413, 415, 422].includes(reason.status)) pendingSaveAttemptRef.current = null;
      setError(reason instanceof Error ? reason.message : "Could not save canvas.");
    }
    finally { savingWorkspaceRef.current = false; setIsSavingWorkspace(false); }
  }

  async function openSaveQueryDialog() {
    try {
      const categories = await listSavedQueryCategories();
      setSavedQueryCategories(categories.items);
      setSavedQueryTitle(restoredRecord?.title ?? ""); setSavedQueryCategoryId(restoredRecord?.category_id ?? null);
      setSaveDialogOpen(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load categories."); }
  }

  async function openSavedQueries() {
    try {
      const [records, categories] = await Promise.all([listSavedQueries(), listSavedQueryCategories()]);
      setSavedQueries(records.items);
      setSavedQueriesHasMore(records.items.length === 100);
      setSavedQueryCategories(categories.items);
      setSavedQueriesOpen(false);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : localizedText(language, "无法加载已保存的查询。", "Could not load saved queries."));
      return false;
    }
  }

  async function loadMoreSavedQueries() {
    if (savedQueriesLoadingMore) return;
    setSavedQueriesLoadingMore(true);
    try {
      const next = await listSavedQueries(savedQueries.length);
      setSavedQueries((current) => [...current, ...next.items.filter((item) => !current.some((record) => record.id === item.id))]);
      setSavedQueriesHasMore(next.items.length === 100);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load archives."); }
    finally { setSavedQueriesLoadingMore(false); }
  }

  async function refreshSavedQueries() { await openSavedQueries(); }

  async function createQueryCategory() {
    const name = window.prompt(localizedText(language, "分类名称", "Category name"))?.trim();
    if (!name) return;
    try { await createSavedQueryCategory(name); await refreshSavedQueries(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : localizedText(language, "无法创建分类。", "Could not create category.")); }
  }

  async function createSaveDialogCategory() {
    const name = saveCategoryName.trim();
    if (!name) return;
    try {
      const result = await createSavedQueryCategory(name);
      setSavedQueryCategories((categories) => [...categories, { id: result.id, name, sort_order: 0 }]);
      setSavedQueryCategoryId(result.id);
      setSaveCategoryName("");
      setSaveCategoryDraftOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : localizedText(language, "无法创建分类。", "Could not create the category."));
    }
  }

  async function confirmSavedQueryAction() {
    if (!savedQueryAction) return;
    try {
      if (savedQueryAction.kind === "record") await deleteSavedQuery(savedQueryAction.id);
      else await deleteSavedQueryCategory(savedQueryAction.id);
      setSavedQueryAction(null); await refreshSavedQueries();
    } catch (reason) { setError(reason instanceof Error ? reason.message : localizedText(language, "无法更新已保存的查询。", "Could not update saved queries.")); }
  }

  async function restoreSavedQuery(recordId: number) {
    if (savingWorkspaceRef.current) {
      setError(localizedText(language, "请先完成当前画布操作。", "Finish the current canvas operation first.")); return;
    }
    restoringWorkspaceRef.current?.abort();
    const controller = new AbortController(); restoringWorkspaceRef.current = controller;
    setIsRestoringWorkspace(true);
    const baseRevision = workbenchController.getSnapshot().revision;
    try {
      const record = await getSavedQuery(recordId);
      const dataset = datasets?.datasets.find((item) => item.species_tree === record.species_tree && item.genome_database === record.genome_database);
      if (!dataset || record.dataset_revision !== (dataset.dataset_revision ?? "unversioned")) throw new Error(localizedText(language, "存档的数据集不可用或版本已改变，无法精确恢复。", "The saved dataset is unavailable or its version changed."));
      const document = decodeWorkspaceDocument(record.snapshot);
      let load: Extract<TreeCoreLoadState, { status: "ready" }>;
      if (treeCoreLoadState.status === "ready" && treeCoreLoadState.session.rawTree.dataset.species_tree === dataset.species_tree
        && treeCoreLoadState.session.rawTree.dataset.genome_database === dataset.genome_database
        && treeCoreLoadState.session.rawTree.dataset.dataset_revision === dataset.dataset_revision) load = treeCoreLoadState;
      else {
        const summary = await fetchTreeCoreSummary(dataset.species_tree, dataset.genome_database);
        const archive = await fetchTreeCoreFile(summary.tree_core_download_url);
        load = { status: "ready", dataset, error: null, session: await createTreeCoreSession(dataset, summary, archive) };
      }
      if (controller.signal.aborted) return;
      const prepared = await runWorkspaceCodec<ReturnType<typeof prepareWorkspaceRestore>>("prepare", {
        raw: load.session.rawTree, document, revision: baseRevision + 1,
      });
      if (controller.signal.aborted) return;
      const input = {
        speciesTree: dataset.species_tree, genomeDatabase: dataset.genome_database, datasetRevision: dataset.dataset_revision ?? "unversioned",
        terminalRows: prepared.state.terminalNodeTable,
        terminalRowsKey: createTerminalCutSnapshot(prepared.state.terminalNodeTable).aggregationRowsKey,
        annotationColumns: document.query.resultSession.columns.map((column) => ({ annotation_id: column.annotation_id ?? null, type: column.type, value: column.value })),
        moduleCompletenessThreshold: document.query.resultSession.module_groups.length ? Number(document.heatmap.moduleCompletenessThreshold) : null,
      };
      const aggregate = input.terminalRows.length && input.annotationColumns.length
        ? await aggregateHeatmap(input.speciesTree, input.genomeDatabase, input.terminalRows, input.annotationColumns, input.moduleCompletenessThreshold, controller.signal) : null;
      await globalThis.document.fonts.ready;
      if (controller.signal.aborted) return;
      if (workbenchController.getSnapshot().revision !== baseRevision) throw new Error(localizedText(language, "恢复期间画布发生了变化，请重新打开存档。", "The canvas changed during restore. Open the archive again."));
      // Commit once. No query initialization or Cart application lifecycle actions.
      initializedTreeRuntimeRef.current = load.session.rawTree;
      preserveTerminalTableRuntimeRef.current = prepared.state.canvasTreeRuntime;
      heatmapAggregateRequestIdRef.current += 1;
      heatmapAggregateCacheRef.current = [];
      if (aggregate) rememberHeatmapAggregate(makeHeatmapAggregateCacheEntry(input, aggregate));
      setPreparedTreeLoad(load); setActiveDataset(dataset);
      workbenchController.replace(prepared.state);
      setStandardHeatmapAggregate(aggregate);
      appliedDefaultAnnotationRankRef.current = defaultAnnotationRankForLocalRules(prepared.state.displayRank, prepared.state.localRankRules);
      previousTreeViewModeRef.current = prepared.state.treeViewMode;
      previousDisplayRankRef.current = prepared.state.displayRank;
      previousRenderDatasetRef.current = `${dataset.species_tree}:${dataset.genome_database}`;
      setPreviousCircularSize(null);
      cameraByModeRef.current = document.view.cameras;
      pendingCameraRestoreRef.current = document.view.cameras[prepared.state.treeViewMode];
      setPendingFit(false); restoredCameraActiveRef.current = true;
      taxonAnnotationRestoreKeyRef.current = `${prepared.state.showStrip}:${prepared.state.taxonNameDisplayMode}:${prepared.state.showStrip ? prepared.state.stripRank : "none"}`;
      setHeatmapLegend(document.view.heatmapLegend); setTaxonAnnotation(document.view.taxonAnnotation);
      setDrawerPanel(document.view.drawerPanel); setDrawerOpen(document.view.drawerOpen); setControlDrawerWidth(document.view.controlDrawerWidth);
      setSelectedNodeId(document.view.selectedNodeId); setHoveredNodeId(null); setPendingCenterNodeId(null);
      setSelectionDraft(null); setColumnDragDraft(null); setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
      setBranchPrunePreviewNodeIds(new Set()); setBranchPruneStatus("idle"); setBranchPruneSummary(null);
      const draft = document.drafts;
      setQueryMode(draft.queryMode); setConditions(draft.conditions); setBatchQueryText(draft.batchQueryText);
      setBranchPruneDraft(draft.branchPruneDraft); setTreeSearch(draft.treeSearch); setTreeSearchRank(draft.treeSearchRank); setTreeSearchPickedItem(draft.treeSearchPickedItem);
      setDetailRankSearch(draft.detailRankSearch); setDetailRankSearchRank(draft.detailRankSearchRank); setDetailRankTargetRank(draft.detailRankTargetRank);
      setHeatmapQueryConditions(draft.heatmapQueryConditions); setHeatmapBatchQueryText(draft.heatmapBatchQueryText);
      setResultScopeSearch(draft.resultScopeSearch); setResultScopeSearchRank(draft.resultScopeSearchRank); setResultScopeExpandRank(draft.resultScopeExpandRank); setCustomNameDraft(draft.customNameDraft);
      setRestoredRecord({ id: record.id, record_version: record.record_version, title: record.title, category_id: record.category_id });
      workspaceSessionRef.current += 1; pendingSaveAttemptRef.current = null; restoreCleanFramesRef.current = true;
      setActivePage("result"); resultPageEntryRef.current = true;
      window.history.pushState({ page: "result" }, "", window.location.href);
      setControlPanelScrollTop(document.view.controlPanelScrollTop);
      const { editingId, ...heatmapDraft } = draft.heatmapStyle;
      setHeatmapStyleDialog(heatmapDraft); setEditingHeatmapStyleId(editingId);
      setTreeStyleDialog(draft.treeStyle);
      setPendingNameNodeId(draft.nameTarget.nodeId); setPendingNameCollapseRank(draft.nameTarget.collapseRank);
      window.requestAnimationFrame(() => {
        viewerScrollRef.current?.scrollTo(document.view.scroll.left, document.view.scroll.top);
        if (resultPanelMode === "controls") controlPanelRef.current?.scrollTo(0, document.view.controlPanelScrollTop);
      });
      setError(null);
      // Keep the loading cover until layout effects have applied the saved camera.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not restore canvas.");
    } finally {
      if (restoringWorkspaceRef.current === controller) { restoringWorkspaceRef.current = null; setIsRestoringWorkspace(false); }
    }
  }

  function exportCurrentPlotData() {
    exportPlotDataArchive({
      searchResult: resultSession,
      activeDataset,
      displayColumns,
      visibleRows,
      treeLayoutNodes,
      cellValues,
      heatmapMetric,
      treeViewMode,
      circularRotationDegrees,
    });
  }

  async function exportFigure(format: "svg" | "png" | "pdf" = "svg") {
    if (!visibleRows.length) return;
    const scene = scenePlanStore.get(treeViewMode);
    if (!scene) {
      setError(localizedText(language, "当前图形尚未准备完成，请稍后重试。", "The figure is not ready yet. Please try again shortly."));
      return;
    }
    const legend: LegendFigureData = {
      heatmap: heatmapLegend ? {
        state: heatmapLegend,
        title: localizedText(language, "热图图注", "Heatmap legend"),
        itemFontSize: heatmapLegendFontSize,
        items: activeHeatmapStyles.map((style) => {
          const stops = colorScalesForStyle(style)[heatmapMetric].stops;
          return { label: style.name, color: stops[stops.length - 1]?.color ?? "#6A0624", marker: style.shape };
        }),
      } : null,
      taxon: taxonAnnotation ? {
        state: taxonAnnotation,
        title: localizedText(language, "分类注释", "Taxonomic Annotation"),
        itemFontSize: taxonLegendFontSize,
        items: taxonLegendItems.map((item) => ({ ...item, marker: "swatch" as const })),
      } : null,
    };
    const request = { format, includeLegend: true };
    const base = sanitizeFilePart(`${activeDataset?.genome_database ?? "figure"}_${treeViewMode}`);
    try {
      const frame = compileExportFrame(scene, request, legend);
      const blob = await exportScene(frame, request, {
        png: (svg) => svgToPngBlob(svg),
        pdf: (svg) => svgToPdfBlob(svg),
      });
      downloadBlob(blob, `${base}.${format}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : localizedText(language, "图形导出失败。", "Figure export failed."));
    }
  }

  const marqueeStyle = selectionDraft?.active && workbenchRef.current
    ? {
        left: selectionDraft.startX - workbenchRef.current.getBoundingClientRect().left,
        top: selectionDraft.startY - workbenchRef.current.getBoundingClientRect().top,
        width: 0,
        height: 0,
      }
    : null;
  const floatingLegendScale = viewZoom;
  const heatmapLegendTypographyStyle = {
    "--heatmap-legend-item-font-size": `${heatmapLegendFontSize}px`,
    "--heatmap-legend-title-font-size": `${heatmapLegendFontSize}px`,
  } as CSSProperties;
  const taxonLegendTypographyStyle = {
    "--heatmap-legend-item-font-size": `${taxonLegendFontSize}px`,
    "--heatmap-legend-title-font-size": `${taxonLegendFontSize}px`,
    "--taxon-annotation-marker-size": `${Math.max(16, taxonLegendFontSize * 0.72)}px`,
  } as CSSProperties;
  const heatmapLegendBoxStyle = heatmapLegend?.open
    ? {
        left: viewOffset.x + heatmapLegend.x * viewZoom,
        top: viewOffset.y + heatmapLegend.y * viewZoom,
        width: heatmapLegend.width,
        height: heatmapLegend.height,
        transform: `scale(${floatingLegendScale})`,
        transformOrigin: "top left",
      }
    : null;
  const taxonAnnotationBoxStyle = taxonAnnotation?.open
    ? {
        left: viewOffset.x + taxonAnnotation.x * viewZoom,
        top: viewOffset.y + taxonAnnotation.y * viewZoom,
        width: taxonAnnotation.width,
        height: taxonAnnotation.height,
        transform: `scale(${floatingLegendScale})`,
        transformOrigin: "top left",
      }
    : null;
  function heatmapLegendStylePreview(style: HeatmapStyleRecord) {
    const scaleStops = colorScalesForStyle(style)[heatmapMetric].stops;
    const fill = scaleStops[scaleStops.length - 1]?.color ?? "#6A0624";
    if (style.shape === "fill") {
      return (
        <svg className="heatmap-legend-style-svg" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M5 26 A12 12 0 0 1 27 8 L16 16 Z" fill={fill} stroke="rgba(17,17,17,0.38)" strokeWidth="1.4" />
        </svg>
      );
    }
    return (
      <svg className="heatmap-legend-style-svg" viewBox="0 0 32 32" aria-hidden="true">
        {style.shape === "circle" ? <circle cx="16" cy="16" r="9.5" fill={fill} stroke="rgba(17,17,17,0.38)" strokeWidth="1.4" /> : null}
        {style.shape === "square" ? <rect x="7" y="7" width="18" height="18" rx="2.5" fill={fill} stroke="rgba(17,17,17,0.38)" strokeWidth="1.4" /> : null}
        {style.shape === "triangle" ? <path d="M16 5 L27 26 H5 Z" fill={fill} stroke="rgba(17,17,17,0.38)" strokeWidth="1.4" /> : null}
      </svg>
    );
  }
  const resultPreparationNotice = activePage === "result" && resultSession
    ? treeCoreLoadState.status === "loading"
      ? localizedText(language, "正在加载 tree_core 结果树...", "Loading the tree_core result tree...")
      : heatmapAggregateRequest && !standardHeatmapAggregate && !notice
        ? localizedText(language, "正在聚合热图结果...", "Aggregating the heatmap result...")
        : ""
    : "";
  const shortcutGuardCopy = useMemo(() => {
    if (!pendingShortcutGuard) {
      return null;
    }
    if (pendingShortcutGuard.kind === "reload") {
      return {
        title: localizedText(language, "重新加载此页面？", "Reload this page?"),
        description: localizedText(
          language,
          "重新加载会中断当前工作台，并丢弃本次会话中的临时查询、结果和筛选状态。是否继续？",
          "Reloading will interrupt the current workspace and discard the temporary query, result, and filter state from this session. Continue?",
        ),
        cancelText: localizedText(language, "取消", "Cancel"),
        confirmText: localizedText(language, "重新加载", "Reload"),
      };
    }
    return {
      title: localizedText(language, "返回首页？", "Return to the home page?"),
      description: localizedText(
        language,
        "返回首页会离开当前工作台，并清除当前结果视图、物种树范围和下载列表等临时状态。是否继续？",
        "Returning home will leave the current workspace and clear temporary state such as the current result view, tree scope, and carts. Continue?",
      ),
      cancelText: localizedText(language, "取消", "Cancel"),
      confirmText: localizedText(language, "返回首页", "Return Home"),
    };
  }, [language, pendingShortcutGuard]);

  return (
    <div className="app-page" onClick={handleAppClick}>
      {activePage !== "result" && activePage !== "landing" ? (
        <TopMenu
          activePage={activePage}
          language={language}
          text={uiText}
          onNavigate={handleTopMenuNavigate}
          onLanguageChange={setLanguage}
          onOpenSavedQueries={() => { void openSavedQueries().then((opened) => { if (opened) setActivePage("saved-queries"); }); }}
          localMode
        />
      ) : null}
      {activePage === "landing" ? <LandingPage language={language} onStart={() => setActivePage("home")} /> : null}
      {savedQueriesOpen ? (
        <div className="modal-overlay"><div className="modal-card saved-query-library" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><h2>{localizedText(language, "我的查询记录", "My saved queries")}</h2><button type="button" className="icon-button modal-close" aria-label={localizedText(language, "关闭", "Close")} onClick={() => setSavedQueriesOpen(false)}><X size={16} /></button></div>
          {[...savedQueryCategories.map((category) => ({ id: category.id, name: category.name })), { id: null, name: localizedText(language, "未分类", "Uncategorized") }].map((category) => {
            const records = savedQueries.filter((record) => record.category_id === category.id);
            return <details key={category.id ?? "uncategorized"} className="saved-query-category" open><summary>{category.name}<span>{records.length}</span></summary>{records.length ? records.map((record) => <div key={record.id} className="saved-query-row"><strong>{record.title}</strong><small>{record.genome_database} / {record.species_tree} · {new Date(record.updated_at).toLocaleString()}</small></div>) : <p className="muted">{localizedText(language, "此分类中还没有查询记录。", "No saved queries in this category.")}</p>}</details>;
          })}
        </div></div>
      ) : null}

      {shortcutGuardCopy ? (
        <ActionConfirmDialog
          open
          title={shortcutGuardCopy.title}
          description={shortcutGuardCopy.description}
          cancelText={shortcutGuardCopy.cancelText}
          confirmText={shortcutGuardCopy.confirmText}
          onCancel={cancelShortcutGuard}
          onConfirm={confirmShortcutGuard}
        />
      ) : null}
      {notice ? (
        <NoticeBanner
          key={notice.id}
          kind={notice.kind}
          title={localizedText(
            language,
            notice.kind === "error" ? "操作出错" : notice.kind === "success" ? "操作完成" : "提示",
            notice.kind === "error" ? "Error" : notice.kind === "success" ? "Completed" : "Notice",
          )}
          message={notice.message}
          closeLabel={localizedText(language, "关闭通知", "Close notification")}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
      {isRestoringWorkspace || isSearching || renderNotice || resultPreparationNotice ? (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <span className="loading-spinner" />
            <p>{isRestoringWorkspace ? localizedText(language, "正在恢复画布…", "Restoring canvas…") : renderNotice || resultPreparationNotice || uiText.preparingText}</p>
            {isRestoringWorkspace ? <button type="button" className="button subtle" onClick={() => { restoringWorkspaceRef.current?.abort(); restoringWorkspaceRef.current = null; setIsRestoringWorkspace(false); }}>{localizedText(language, "取消", "Cancel")}</button> : null}
          </div>
        </div>
      ) : null}
      {activePage === "home" || activePage === "query" || activePage === "examples" ? (
        <HomePage
          language={language}
          homeBackgroundRgb={homeBackgroundRgb}
          datasets={datasets}
          activeDataset={activeDataset}
          activeSection={activePage === "examples" ? "examples" : "query"}
          conditions={conditions}
          queryMode={queryMode}
          batchQueryText={batchQueryText}
          suggestions={suggestions}
          moduleSuggestions={moduleSuggestions}
          activeSuggestionId={activeSuggestionId}
          isSearching={isSearching}
          onDatasetChange={selectDataset}
          onQueryModeChange={setQueryMode}
          onUpdateCondition={updateCondition}
          onAddCondition={addCondition}
          onRemoveCondition={removeCondition}
          onBatchQueryChange={setBatchQueryText}
          onActiveSuggestionChange={setActiveSuggestionId}
          onSuggestionApply={applySuggestion}
          onModuleSuggestionApply={applyModuleSuggestion}
          onSearch={submitHomeSearch}
          queryScopeSelection={homeScopeSelection}
          queryScopeOptions={homeScopeOptions}
          queryScopeOptionsLoading={homeScopeOptionsLoading}
          queryScopeLeafCount={homeScopeLeafCount}
          queryScopeCustomCount={homeScopeRecords.length}
          onQueryScopeSelect={replaceHomeScopeFromPreset}
          onOpenCustomQueryScope={openHomeCustomScope}
          onStart={() => {
            document.getElementById("query")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      ) : null}
      {homeScopeDialogOpen && (activePage === "home" || activePage === "query") ? (
        <Suspense fallback={null}>
          <QueryScopeDialog
        open
        language={language}
        query={homeScopeSearch}
        rank={homeScopeSearchRank}
        expandRank={homeScopeExpandRank}
        candidates={homeScopeCandidates}
        pickedItem={homeScopePickedItem}
        records={homeScopeRecords}
        leafCount={homeScopeLeafCount}
        onQueryChange={(value) => {
          setHomeScopeSearch(value);
          setHomeScopePickedItem(null);
        }}
        onRankChange={(value) => {
          setHomeScopeSearchRank(value);
          setHomeScopePickedItem(null);
        }}
        onExpandRankChange={setHomeScopeExpandRank}
        onPick={pickHomeCustomTaxon}
        onAdd={addHomeCustomTaxon}
        onRecordRankChange={updateHomeCustomTaxonRank}
        onDelete={deleteHomeCustomTaxon}
        onClear={clearHomeCustomScope}
        onCancel={cancelHomeCustomScope}
        onConfirm={confirmHomeCustomScope}
          />
        </Suspense>
      ) : null}
      {resultScopeDialogOpen && activePage === "result" ? (
        <Suspense fallback={null}>
          <QueryScopeDialog
        open
        language={language}
        query={resultScopeSearch}
        rank={resultScopeSearchRank}
        expandRank={resultScopeExpandRank}
        candidates={resultScopeCandidates}
        pickedItem={resultScopePickedItem}
        records={resultScopeRecords}
        leafCount={resultScopeLeafCount}
        onQueryChange={(value) => { setResultScopeSearch(value); setResultScopePickedItem(null); }}
        onRankChange={(value) => { setResultScopeSearchRank(value); setResultScopePickedItem(null); }}
        onExpandRankChange={setResultScopeExpandRank}
        onPick={(item) => { setResultScopePickedItem(item); setResultScopeExpandRank(defaultQueryScopeExpansionRank([item.rank])); }}
        onAdd={() => {
          if (!resultScopePickedItem) return;
          if (addSourceNodeToBranchCart(resultScopePickedItem.id, resultScopeExpandRank)) {
            setResultScopeSearch("");
            setResultScopePickedItem(null);
            setResultScopeVersion((value) => value + 1);
          }
        }}
        onRecordRankChange={(recordId, rank) => {
          const result = executeCartCommand({ type: "update-record-rank", recordId, rank });
          if (result?.accepted) setResultScopeVersion((value) => value + 1);
        }}
        onDelete={(recordId) => { executeCartCommand({ type: "remove-record", recordId }); setResultScopeVersion((value) => value + 1); }}
        onClear={() => { executeCartCommand({ type: "clear" }); setResultScopeVersion((value) => value + 1); }}
        onCancel={cancelResultQueryScope}
        onReplace={() => applyResultQueryScope("replace")}
        onAppend={() => applyResultQueryScope("append")}
          />
        </Suspense>
      ) : null}
      {activePage === "about" ? <Suspense fallback={null}><AboutPage language={language} /></Suspense> : null}

      {activePage === "result" && resultSession ? (
        <main className="result-shell">
          <section className="result-workbench" ref={workbenchRef} onMouseDown={startMarquee}>
            {!visibleRows.length ? (
              <div className="view-empty-state">
                <strong>
                  {treeCoreLoadState.status === "error"
                    ? localizedText(language, "物种树核心数据加载失败", "Failed to load the tree core")
                    : uiText.emptyTitle}
                </strong>
                <p>
                  {treeCoreLoadState.status === "error"
                    ? treeCoreLoadState.error ?? localizedText(language, "请刷新页面后重试。", "Refresh the page and try again.")
                    : uiText.emptyText}
                </p>
              </div>
            ) : null}
            <div
              className={["viewer-scroll", isPanning ? "panning" : "", ctrlDown ? "ctrl-ready" : ""].join(" ")}
              ref={viewerScrollRef}
              onWheel={handleViewerWheel}
              onPointerDown={startViewerPan}
              onPointerMove={moveViewerPan}
              onPointerUp={finishViewerPan}
              onPointerCancel={finishViewerPan}
              onPointerLeave={finishViewerPan}
            >
              <div className="viewer-zoom-surface" style={treeViewMode === "circular" ? undefined : { width: activeViewerWidth * viewZoom, height: activeViewerHeight * viewZoom }}>
                <Suspense fallback={null}>
                  {treeViewMode === "rectangular" ? (
                  <div
                    ref={viewerContentRef}
                    className="viewer-grid"
                    style={{
                      width: viewerWidth,
                      height: contentHeight,
                      gridTemplateColumns: `${treeLayout.treeWidth}px ${heatmapWidth}px`,
                      transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewZoom})`,
                    }}
                  >
                    <div className="tree-pane" style={{ paddingTop: headerHeight }}>
                      <RectangularTreeView
                        renderSnapshot={renderSnapshot}
                        treeLayoutNodes={renderSnapshot.treeNodes}
                        visibleRows={renderSnapshot.rows}
                        activeStripRank={activeStripRank}
                        taxonDisplayStyle={taxonDisplayStyle}
                        taxonNameDisplayMode={taxonNameDisplayMode}
                        stripMinimumLeafCount={stripMinimumLeafCount}
                        showStripLabels={effectiveShowStripLabels}
                        showBranchLabels={effectiveShowBranchLabels}
                        showSpeciesLayer={showSpeciesLayer}
                        showSpeciesCount={effectiveShowSpeciesCount}
                        branchStrokeWidth={branchStrokeWidth}
                        showInternalNodes={showInternalNodes}
                        showBranchGuides={showBranchGuides}
                        showBranchLengths={showBranchLengths}
                        branchScale={branchScale}
                        branchLabelFontSize={treeLabelFontSize}
                        branchMetricFontSize={branchMetricFontSize}
                        speciesCountFontSize={speciesFontSize}
                        stripNameFontSize={stripLabelFontSize}
                        rowHeight={rowHeight}
                        width={treeLayout.treeWidth}
                        height={rectangularTreeHeight}
                        worldTop={headerHeight}
                        viewZoom={viewZoom}
                        viewOffset={viewOffset}
                        layout={treeLayout}
                        columns={displayColumns}
                        moduleQuery={showModuleDetail ? moduleQueryInfo : null}
                        fallbackHeatmapStyle={fallbackHeatmapStyle}
                        showNumbers={showNumbers}
                        showModuleNames={showModuleNames}
                        showModuleFullName={showModuleFullName}
                        heatmapColumnWidth={heatmapColumnWidth}
                        headerHeight={headerHeight}
                        contentHeight={contentHeight}
                        heatmapShapeSize={heatmapShapeSize}
                        heatmapValueFontSize={heatmapValueFontSize}
                        columnLabelFontSize={columnLabelFontSize}
                        moduleLabelFontSize={moduleLabelFontSize}
                        exportBounds={rectangularExportBounds}
                        onScenePlan={publishScenePlan}
                        hoveredNodeId={hoveredRenderNodeId}
                        selectedNodeId={selectedRenderNodeId}
                        deletionPreviewNodeIds={prunePreviewNodeIds}
                        treeStyles={renderSnapshot.treeStyles}
                        renderRevision={renderSnapshot.revision}
                        selectionMode={isHeatmapStyleSelecting}
                        onHoverSource={setHoveredNodeId}
                        onOpenNode={(nodeId, kind, event) => {
                          if (isHeatmapStyleSelecting) {
                            toggleHeatmapRowsForNode(nodeId);
                            return;
                          }
                          setSelectedNodeId(nodeId);
                          setNodeMenu({ open: true, x: event.clientX, y: event.clientY, nodeId, kind });
                        }}
                        onSelectSource={(nodeId) => {
                          if (isHeatmapStyleSelecting) {
                            toggleHeatmapRowsForNode(nodeId);
                            return;
                          }
                          setSelectedNodeId(nodeId);
                          setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
                          setError(null);
                        }}
                      />
                    </div>
                    <HeatmapSvg
                      renderSnapshot={renderSnapshot}
                      columns={displayColumns}
                      moduleQuery={showModuleDetail ? moduleQueryInfo : null}
                      activeModuleId={activeModuleId}
                      showModuleNames={showModuleNames}
                      showModuleFullName={showModuleFullName}
                      selectedCellKeys={isHeatmapStyleSelecting ? selectedCellKeys : EMPTY_SELECTED_CELL_KEYS}
                      columnDragDraft={columnDragDraft}
                      hoveredCellKey={hoveredCellKey}
                      hoveredColumnKey={hoveredColumnKey}
                      searchColumns={resultSession.columns}
                      height={contentHeight}
                      headerHeight={headerHeight}
                      rowHeight={rowHeight}
                      terminalBands={terminalBands}
                      heatmapColumnWidth={heatmapColumnWidth}
                      cellSize={heatmapShapeSize}
                      columnLabelFontSize={columnLabelFontSize}
                      moduleLabelFontSize={moduleLabelFontSize}
                      valueFontSize={heatmapValueFontSize}
                      onColumnMenu={isHeatmapStyleSelecting ? () => {} : openColumnMenu}
                      onColumnPrimaryAction={handleColumnPrimaryAction}
                      onColumnDrag={isHeatmapStyleSelecting ? () => {} : startColumnDrag}
                      onHeatmapBodyClick={isHeatmapStyleSelecting ? toggleHeatmapCellAtPoint : () => {}}
                      onHeatmapBodyMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
                      onHeatmapBodyMove={hoverHeatmapCellAtPoint}
                      onHeatmapBodyLeave={() => setHoveredCellKey(null)}
                      showNumbers={showNumbers}
                      viewZoom={viewZoom}
                      viewOffset={viewOffset}
                      worldLeft={treeLayout.treeWidth}
                    />
                  </div>
                  ) : (
                  <div
                    ref={viewerContentRef}
                    className="viewer-circular-layer"
                    style={{
                      width: "100%",
                      height: "100%",
                    }}
                  >
                      <CircularTreeView
                        renderSnapshot={renderSnapshot}
                        presentationGeometry={circularSceneGeometry}
                        treeLayoutNodes={renderSnapshot.treeNodes}
                        visibleRows={renderSnapshot.rows}
                      columns={displayColumns}
                      moduleQuery={showModuleDetail ? moduleQueryInfo : null}
                      activeModuleId={activeModuleId}
                      showModuleNames={showModuleNames}
                      showModuleFullName={showModuleFullName}
                      selectedCellKeys={isHeatmapStyleSelecting ? selectedCellKeys : EMPTY_SELECTED_CELL_KEYS}
                      columnDragDraft={columnDragDraft}
                      hoveredCellKey={hoveredCellKey}
                      hoveredColumnKey={hoveredColumnKey}
                      activeStripRank={activeStripRank}
                      showStrip={showStrip}
                      taxonDisplayStyle={taxonDisplayStyle}
                      taxonNameDisplayMode={taxonNameDisplayMode}
                      showStripLabels={effectiveShowStripLabels}
                      stripMinimumLeafCount={stripMinimumLeafCount}
                      stripColumnWidth={circularStripRingWidthWorld}
                      showSpeciesLayer={showSpeciesLayer}
                      showSpeciesCount={effectiveShowSpeciesCount}
                      showBranchLabels={effectiveShowBranchLabels}
                      branchStrokeWidth={circularBranchStrokeWidth}
                      showInternalNodes={showInternalNodes}
                      showBranchGuides={showBranchGuides}
                      showBranchLengths={showBranchLengths}
                      branchScale={circularBranchScale}
                      spacingScale={spacingScale}
                      circularArcDegrees={circularArcDegrees}
                      circularRotationDegrees={circularRotationDegrees}
                      branchLabelFontSize={branchLabelFontSize}
                      branchMetricFontSize={branchMetricFontSize}
                      columnLabelFontSize={columnLabelFontSize}
                      moduleLabelFontSize={moduleLabelFontSize}
                      speciesCountFontSize={speciesCountFontSize}
                      stripNameFontSize={stripNameFontSize}
                      heatmapRingWidth={effectiveCircularHeatmapRingWidth}
                      heatmapMarkerSize={heatmapShapeSize}
                      heatmapValueFontSize={heatmapValueFontSize}
                      showHeatmapNumbers={showNumbers}
                      size={circularSize}
                      minimumTreePartitionRadius={circularMinimumTreePartitionRadius}
                      viewZoom={viewZoom}
                      viewOffset={viewOffset}
                      hoveredNodeId={hoveredRenderNodeId}
                      selectedNodeId={selectedRenderNodeId}
                      deletionPreviewNodeIds={prunePreviewNodeIds}
                      treeStyles={renderSnapshot.treeStyles}
                      selectionMode={isHeatmapStyleSelecting}
                      onScenePlan={publishScenePlan}
                      onColumnMenu={isHeatmapStyleSelecting ? () => {} : openColumnMenu}
                      onColumnPrimaryAction={handleColumnPrimaryAction}
                      onColumnDrag={isHeatmapStyleSelecting ? () => {} : startColumnDrag}
                      onToggleCell={isHeatmapStyleSelecting ? toggleCell : () => {}}
                      onCellMenu={() => {}}
                      onHoverSource={setHoveredNodeId}
                      onHoverCellKey={setHoveredCellKey}
                      onHoverColumnKey={setHoveredColumnKey}
                      onOpenNode={(nodeId, kind, event) => {
                        if (isHeatmapStyleSelecting) {
                          toggleHeatmapRowsForNode(nodeId);
                          return;
                        }
                        setSelectedNodeId(nodeId);
                        setNodeMenu({ open: true, x: event.clientX, y: event.clientY, nodeId, kind });
                      }}
                    />
                  </div>
                  )}
                </Suspense>
              </div>
            </div>
            <div className="viewer-tool-group">
            <TreeLayoutToggle
              language={language}
              currentMode={treeViewMode}
              onChange={(mode) => { executeAppearanceCommand({ type: "set-tree-view-mode", mode }); }}
            />
            <button
              type="button"
              className="viewer-locate-button"
              aria-label={localizedText(language, "使物种树和热图适应视图", "Fit tree and heatmap to view")}
              title={localizedText(language, "使物种树和热图适应视图", "Fit tree and heatmap to view")}
              onClick={() => requestViewerFit()}
            >
              <LocateFixed size={18} />
            </button>
            <button
              type="button"
              className="viewer-locate-button"
              title={localizedText(language, "重置视图", "Reset view")}
              aria-label={localizedText(language, "重置视图", "Reset view")}
              onClick={() => setResetViewConfirmOpen(true)}
            >
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="viewer-locate-button"
              title={localizedText(language, "保存当前查询", "Save current query")}
              aria-label={localizedText(language, "保存当前查询", "Save current query")}
              onClick={() => { void openSaveQueryDialog(); }}
            >
              <Save size={18} />
            </button>
            <DropdownMenu.Root open={viewerDownloadMenuOpen} onOpenChange={setViewerDownloadMenuOpen}>
              <div className="viewer-download-menu">
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={`viewer-locate-button${viewerDownloadMenuOpen ? " active" : ""}`}
                    title={localizedText(language, "下载与导出", "Download and export")}
                    aria-label={localizedText(language, "下载与导出", "Download and export")}
                  >
                    <Download size={18} aria-hidden="true" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="viewer-download-menu-popover" side="right" align="start" sideOffset={10} collisionPadding={8}>
                    <DropdownMenu.Item asChild>
                      <button type="button" onClick={openDownloadDialog}>
                        <FileDown size={16} aria-hidden="true" />
                        {localizedText(language, "下载序列", "Download sequences")}
                      </button>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <button type="button" onClick={() => { void exportFigure(); }}>
                        <FileImage size={16} aria-hidden="true" />
                        {localizedText(language, "导出 SVG", "Export SVG")}
                      </button>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <button type="button" onClick={() => { void exportFigure("png"); }}>
                        <FileImage size={16} aria-hidden="true" />
                        {localizedText(language, "导出 PNG", "Export PNG")}
                      </button>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <button type="button" onClick={() => { void exportFigure("pdf"); }}>
                        <FileText size={16} aria-hidden="true" />
                        {localizedText(language, "导出 PDF", "Export PDF")}
                      </button>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <button type="button" onClick={exportCurrentPlotData}>
                        <FileText size={16} aria-hidden="true" />
                        {localizedText(language, "导出绘图数据", "Export plot data")}
                      </button>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </div>
            </DropdownMenu.Root>
            <button
              type="button"
              className="viewer-locate-button"
              title={localizedText(language, "查询范围", "Query scope")}
              aria-label={localizedText(language, "查询范围", "Query scope")}
              onClick={openResultQueryScope}
            >
              <ListTree size={18} aria-hidden="true" />
            </button>
            <Suspense fallback={null}>
              <TreeSearchTool
                language={language}
                open={treeSearchOpen}
                query={treeSearch}
                rank={treeSearchRank}
                results={treeSearchResults}
                pickedItem={treeSearchPickedItem}
                onOpenChange={setTreeSearchOpen}
                onQueryChange={(value) => {
                  setTreeSearch(value);
                  setTreeSearchPickedItem(null);
                }}
                onRankChange={(value) => {
                  setTreeSearchRank(value);
                  setTreeSearchPickedItem(null);
                }}
                onPick={(item) => {
                  setTreeSearchPickedItem(item);
                  setTreeSearch(item.label);
                }}
                onSearch={runTreeSearch}
              />
            </Suspense>
            </div>
            <div className="zoom-badge">{Math.round(viewZoom * 100)}%</div>
            {heatmapLegendBoxStyle ? (
              <div
                ref={heatmapLegendRef}
                className="heatmap-legend-box"
                style={heatmapLegendBoxStyle ? { ...heatmapLegendBoxStyle, ...heatmapLegendTypographyStyle } : undefined}
                onPointerDown={(event) => startFloatingLegendInteraction(event, "move", heatmapLegend, heatmapLegendDraftRef)}
                onPointerMove={(event) => moveFloatingLegend(event, heatmapLegendDraftRef, setHeatmapLegend)}
                onPointerUp={(event) => finishFloatingLegendInteraction(event, heatmapLegendDraftRef)}
                onPointerCancel={(event) => finishFloatingLegendInteraction(event, heatmapLegendDraftRef)}
              >
                <div className="heatmap-legend-title">{localizedText(language, "热图图注", "Heatmap legend")}</div>
                <button
                  type="button"
                  className="heatmap-legend-close"
                  aria-label={localizedText(language, "关闭热图图注", "Close heatmap legend")}
                  title={localizedText(language, "关闭", "Close")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setHeatmapLegend(closeFloatingLegend)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
                <div className="heatmap-legend-records">
                  {activeHeatmapStyles.map((style) => (
                    <div className="heatmap-legend-record" key={style.id}>
                      {heatmapLegendStylePreview(style)}
                      <span>{style.name}</span>
                    </div>
                  ))}
                </div>
                <div className="heatmap-legend-edge north" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-n", heatmapLegend, heatmapLegendDraftRef)} />
                <div className="heatmap-legend-edge east" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-e", heatmapLegend, heatmapLegendDraftRef)} />
                <div className="heatmap-legend-edge south" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-s", heatmapLegend, heatmapLegendDraftRef)} />
                <div className="heatmap-legend-edge west" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-w", heatmapLegend, heatmapLegendDraftRef)} />
              </div>
            ) : null}
            {taxonAnnotationBoxStyle ? (
              <div
                ref={taxonAnnotationRef}
                className="heatmap-legend-box taxon-annotation-box"
                style={taxonAnnotationBoxStyle ? { ...taxonAnnotationBoxStyle, ...taxonLegendTypographyStyle } : undefined}
                role="group"
                aria-label={localizedText(language, "分类注释图注", "Taxonomic annotation legend")}
                onPointerDown={(event) => startFloatingLegendInteraction(event, "move", taxonAnnotation, taxonAnnotationDraftRef)}
                onPointerMove={(event) => moveFloatingLegend(event, taxonAnnotationDraftRef, setTaxonAnnotation)}
                onPointerUp={(event) => finishFloatingLegendInteraction(event, taxonAnnotationDraftRef)}
                onPointerCancel={(event) => finishFloatingLegendInteraction(event, taxonAnnotationDraftRef)}
              >
                <div className="heatmap-legend-title">{localizedText(language, "分类注释", "Taxonomic Annotation")}</div>
                <button
                  type="button"
                  className="heatmap-legend-close"
                  aria-label={localizedText(language, "关闭分类注释图注", "Close taxonomic annotation legend")}
                  title={localizedText(language, "关闭", "Close")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setTaxonAnnotation(closeFloatingLegend)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
                <div className="heatmap-legend-records">
                  {taxonLegendItems.length ? taxonLegendItems.map((item) => (
                    <div className="heatmap-legend-record" key={item.label}>
                      <span className="taxon-annotation-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
                      <span title={item.label}>{item.label}</span>
                    </div>
                  )) : (
                    <div className="taxon-annotation-empty">
                      {localizedText(language, "当前层级没有符合最小分支数的 Taxon。", "No taxa at this rank meet the minimum branch count.")}
                    </div>
                  )}
                </div>
                <div className="heatmap-legend-edge north" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-n", taxonAnnotation, taxonAnnotationDraftRef)} />
                <div className="heatmap-legend-edge east" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-e", taxonAnnotation, taxonAnnotationDraftRef)} />
                <div className="heatmap-legend-edge south" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-s", taxonAnnotation, taxonAnnotationDraftRef)} />
                <div className="heatmap-legend-edge west" aria-hidden="true" onPointerDown={(event) => startFloatingLegendInteraction(event, "resize-w", taxonAnnotation, taxonAnnotationDraftRef)} />
              </div>
            ) : null}
            {marqueeStyle ? <div ref={marqueeBoxRef} className="marquee-box" style={marqueeStyle} /> : null}
            {isHeatmapStyleSelecting ? (
              <div className="heatmap-style-selection-banner" role="status" aria-live="polite">
                <div className="heatmap-style-selection-copy">
                  <div className="heatmap-style-selection-heading">
                    <strong>{localizedText(language, "请选择热图单元格范围", "Select a heatmap cell range")}</strong>
                    <span>{localizedText(language, `已选 ${effectiveSelectedCount} 个单元格`, `${effectiveSelectedCount} cells selected`)}</span>
                  </div>
                  <p>{localizedText(language, "已选单元格以深色边框标识；创建后，新样式只会应用到这些单元格。", "Selected cells have a dark outline; the new style will apply to these cells only.")}</p>
                  <ol className="heatmap-style-selection-methods">
                    <li>{localizedText(language, "单击单元格", "Click a cell")}</li>
                    <li>{localizedText(language, "单击列标题", "Click a column label")}</li>
                    <li>{localizedText(language, "单击内部节点或分支", "Click an internal node or branch")}</li>
                    <li>{localizedText(language, "按住 Control + 左键框选", "Hold Control and drag with the left mouse button to select a range")}</li>
                  </ol>
                </div>
                <div className="heatmap-style-selection-actions">
                  <button type="button" className="button subtle" onClick={cancelHeatmapStyleSelection}>{localizedText(language, "取消", "Cancel")}</button>
                  <button type="button" className="button primary" disabled={!effectiveSelectedCount} onClick={confirmHeatmapStyleSelection}>{localizedText(language, "确定", "Confirm")}</button>
                </div>
              </div>
            ) : null}
          </section>

          <aside
            className={["instrument-drawer", drawerOpen ? "open" : "closed"].join(" ")}
            style={drawerOpen ? { width: controlDrawerWidth, maxWidth: "calc(100vw - 24px)" } : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            {drawerOpen ? (
              <div
                className="panel-resizer panel-resizer-control"
                onPointerDown={(event) => {
                  resizeDraftRef.current = { target: "control", startX: event.clientX, startWidth: controlDrawerWidth };
                  setActiveResizeTarget("control");
                }}
              />
            ) : null}
            <div className="drawer-rail" role="tablist" aria-label={localizedText(language, "控制面板标签页", "Control panel tabs")}>
              <button
                type="button"
                className={resultPanelMode === "controls" && drawerPanel === "tree" ? "active" : ""}
                aria-label={uiText.drawer.tree}
                onClick={() => {
                  startTransition(() => {
                    setResultPanelMode("controls");
                    setDrawerPanel("tree");
                    setDrawerOpen(true);
                  });
                }}
              >
                <RectangularTreeIcon />
              </button>
              <button
                type="button"
                className={resultPanelMode === "controls" && drawerPanel === "heatmap" ? "active" : ""}
                aria-label={uiText.drawer.heatmap}
                onClick={() => {
                  startTransition(() => {
                    setResultPanelMode("controls");
                    setDrawerPanel("heatmap");
                    setDrawerOpen(true);
                  });
                }}
              >
                <LayoutGrid size={19} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="drawer-rail-collapse"
                aria-label={drawerOpen ? localizedText(language, "收起控制面板", "Collapse control panel") : localizedText(language, "展开控制面板", "Expand control panel")}
                onClick={() => setDrawerOpen((current) => !current)}
              >
                {drawerOpen ? <ChevronsRight size={19} aria-hidden="true" /> : <ChevronsLeft size={19} aria-hidden="true" />}
              </button>
            </div>
            {drawerOpen ? (
              <div className="instrument-drawer-body" ref={controlPanelRef} onScroll={(event) => { if (resultPanelMode === "controls") setControlPanelScrollTop(event.currentTarget.scrollTop); }}>
                {resultPanelMode === "controls" && drawerPanel === "tree" ? (
                  <Suspense fallback={null}>
                    <TreePanel
                      language={language}
                      resultSession={resultSession}
                      treeViewMode={treeViewMode}
                      displayRank={displayRank}
                      stripRank={stripRank}
                      showStrip={showStrip}
                      taxonDisplayStyle={taxonDisplayStyle}
                      taxonNameDisplayMode={taxonNameDisplayMode}
                      stripColumnWidth={activeStripWidth}
                      stripColumnWidthMax={stripWidthMax}
                      branchScale={branchScale}
                      spacingScale={spacingScale}
                      stripMinimumLeafCount={stripMinimumLeafCount}
                      showSpeciesCount={showSpeciesCount}
                      showBranchLabels={showBranchLabels}
                      effectiveShowBranchLabels={effectiveShowBranchLabels}
                      effectiveShowSpeciesCount={effectiveShowSpeciesCount}
                      branchLabelDense={circularDensity.branchLabels}
                      speciesCountDense={circularDensity.speciesNumbers}
                      branchStrokeWidth={branchStrokeWidth}
                      branchLabelFontSize={activeFontProfile.branchLabel}
                      branchLabelFontSizeMax={branchNameFontMax}
                      branchLengthFontSize={activeFontProfile.branchLength}
                      branchLengthFontSizeMax={activeResolvedFonts.branchLength.maxPx}
                      speciesCountFontSize={activeFontProfile.speciesCount}
                      speciesCountFontSizeMax={speciesCountFontMax}
                      stripNameFontSize={activeFontProfile.stripLabel}
                      stripNameFontSizeMax={activeResolvedFonts.stripLabel.maxPx}
                      taxonLegendFontSize={taxonLegendFontSize}
                      showInternalNodes={showInternalNodes}
                      showBranchGuides={showBranchGuides}
                      showBranchLengths={showBranchLengths}
                      circularArcDegrees={circularArcDegrees}
                      circularRotationDegrees={circularRotationDegrees}
                      detailRankSearch={detailRankSearch}
                      detailRankSearchRank={detailRankSearchRank}
                      detailRankPickedItem={detailRankPickedItem}
                      detailRankResults={detailRankCandidates}
                      detailRankTargetRank={detailRankTargetRank}
                      localRankRules={localRankTableRows}
                      detailRankAddOpen={detailRankAddOpen}
                      visibleRows={visibleRows}
                      branchCount={visibleRows.length}
                      stripGroupCount={stripGroupCount}
                      treeStyles={treeStyles}
                      branchPrune={{
                        draft: branchPruneDraft,
                        active: branchPruneActive,
                        status: branchPruneStatus,
                        feedback: branchPruneFeedback,
                        currentScopeLeafCount: visibleScopeLeafNodeIds.length,
                        previewSourceCount: prunePreviewNodeIds.size,
                      }}
                      onTreeViewModeChange={(mode) => { executeAppearanceCommand({ type: "set-tree-view-mode", mode }); }}
                      onDisplayRankChange={changeDisplayRank}
                      onStripRankChange={changeStripRank}
                      onShowStripChange={(visible) => { executeAppearanceCommand({ type: "set-visibility", key: "showStrip", visible }); }}
                      onTaxonDisplayStyleChange={(style: TaxonDisplayStyle) => { executeAppearanceCommand({ type: "set-taxon-display", style }); }}
                      onTaxonNameDisplayModeChange={(nameMode: TaxonNameDisplayMode) => { executeAppearanceCommand({ type: "set-taxon-display", nameMode }); }}
                      onStripColumnWidthChange={(value) => { executeAppearanceCommand({
                        type: "set-scale",
                        key: treeViewMode === "rectangular" ? "rectangularStripColumnWidth" : "circularStripRingWidth",
                        value: clamp(value, treeViewMode === "rectangular" ? 8 : 4, stripWidthMax),
                      }); }}
                      onBranchScaleChange={(value) => { executeAppearanceCommand({ type: "set-scale", key: "branchScale", value: clamp(value, 10, 40) }); }}
                      onSpacingScaleChange={changeTreeSpacingScale}
                      onStripMinimumLeafCountChange={(value) => { executeAppearanceCommand({ type: "set-strip-minimum", leafCount: value }); }}
                      onShowSpeciesCountChange={(value) => updateDenseTextVisibility(value, circularDensity.speciesNumbers, localizedText(language, "物种数量", "species counts"), "showSpeciesCount", "forceShowSpeciesCount")}
                      onShowBranchLabelsChange={(value) => updateDenseTextVisibility(value, circularDensity.branchLabels, localizedText(language, "分支标签", "branch labels"), "showBranchLabels", "forceShowBranchLabels")}
                      onBranchStrokeWidthChange={(value) => { executeAppearanceCommand({ type: "set-scale", key: "branchStrokeWidth", value: Math.max(0.1, value || 0.1) }); }}
                      onBranchLabelFontSizeChange={setBranchLabelFontSize}
                      onBranchLengthFontSizeChange={setBranchLengthFontSize}
                      onSpeciesCountFontSizeChange={setSpeciesCountFontSize}
                      onStripNameFontSizeChange={setStripNameFontSize}
                      onTaxonLegendFontSizeChange={(value) => { executeAppearanceCommand({ type: "set-legend-font-size", legend: "taxon", value }); }}
                      onShowInternalNodesChange={(visible) => { executeAppearanceCommand({ type: "set-visibility", key: "showInternalNodes", visible }); }}
                      onShowBranchGuidesChange={(visible) => { executeAppearanceCommand({ type: "set-visibility", key: "showBranchGuides", visible }); }}
                      onShowBranchLengthsChange={(visible) => { executeAppearanceCommand({ type: "set-visibility", key: "showBranchLengths", visible }); }}
                      onCircularArcDegreesChange={(arcDegrees) => { executeAppearanceCommand({ type: "set-circular-geometry", arcDegrees }); }}
                      onCircularRotationDegreesChange={(rotationDegrees) => { executeAppearanceCommand({ type: "set-circular-geometry", rotationDegrees }); }}
                      onCircularTreeLayoutPresetChange={applyCircularTreeLayoutPreset}
                      onDetailRankSearchChange={(value) => {
                        setDetailRankSearch(value);
                        setDetailRankPickedItem(null);
                      }}
                      onDetailRankSearchRankChange={(value) => {
                        setDetailRankSearchRank(value);
                        setDetailRankPickedItem(null);
                      }}
                      onPickDetailRankItem={(item) => {
                        setDetailRankPickedItem(item);
                        setDetailRankSearch(item.label);
                      }}
                      onDetailRankTargetRankChange={setDetailRankTargetRank}
                      onToggleDetailRankAdd={toggleDetailRankAdd}
                      onConfirmDetailRankRule={confirmDetailRankRule}
                      onDetailRankRuleRankChange={updateDetailRankRuleRank}
                      onDetailRankRuleEnabledChange={updateDetailRankRuleEnabled}
                      onRemoveDetailRankRule={removeDetailRankRule}
                      onApplyDetailRankRules={applyDetailRankRules}
                      onClearDetailRankRules={clearAllDetailRankRules}
                      onBranchPruneDraftChange={(patch) => {
                        setBranchPruneDraft((current) => ({ ...current, ...patch }));
                      }}
                      onPreviewBranchPrune={() => {
                        void previewBranchPrune();
                      }}
                      onApplyBranchPrune={() => {
                        void applyBranchPrune();
                      }}
                      onTreeStyleChange={updateCurrentTreeStyle}
                      onTreeStyleColorCommit={(styleId, color) => updateCurrentTreeStyle(styleId, { color })}
                      onRemoveTreeStyle={removeCurrentTreeStyle}
                      onResetTreeStyles={() => setTreeStyleResetConfirmOpen(true)}
                    />
                  </Suspense>
                ) : null}
                {resultPanelMode === "controls" && drawerPanel === "heatmap" ? (
                  <Suspense fallback={null}>
                    <HeatmapPanel
                    language={language}
                    treeViewMode={treeViewMode}
                    columns={displayColumns}
                    moduleQuery={moduleQueryInfo}
                    activeModuleId={activeModuleId}
                    showModuleNames={showModuleNames}
                    showModuleFullName={showModuleFullName}
                    showModuleCompleteness={showModuleCompleteness}
                    showModuleDetail={showModuleDetail}
                    moduleNameFontSize={activeFontProfile.moduleLabel}
                    moduleCompletenessAvailable={Boolean(activeModule?.completeness_column_id)}
                    moduleCompletenessThreshold={moduleCompletenessThreshold}
                    showNumbers={showNumbers}
                    ratioDisplayMode={ratioDisplayMode}
                    valueFontSize={activeFontProfile.heatmapValue}
                    valueFontSizeMax={activeResolvedFonts.heatmapValue.maxPx}
                    heatmapColumnWidth={activeHeatmapColumnWidthPx}
                    heatmapColumnWidthMax={heatmapColumnWidthMax}
                    heatmapColumnWidthLocked={treeViewMode === "rectangular" && rectangularHeatmapUsesSquareCells}
                    columnLabelFontSize={activeFontProfile.heatmapColumnLabel}
                    columnLabelFontSizeMax={columnLabelFontMax}
                    heatmapMetric={heatmapMetric}
                    heatmapStyles={activeHeatmapStyles}
                    heatmapShapeSize={heatmapShapeSize}
                    showHeatmapLegend={Boolean(heatmapLegend?.open)}
                    heatmapLegendFontSize={heatmapLegendFontSize}
                    columnLabelParts={columnLabelParts}
                    onActiveModuleChange={(activeModuleId) => { executeHeatmapCommand({ type: "set-module-view", activeModuleId }); }}
                    onOpenModuleDiagram={(moduleId) => window.open(`https://www.genome.jp/entry/${moduleId}`, "_blank", "noopener,noreferrer")}
                    onOpenQueryDialog={() => {
                      startTransition(() => setHeatmapQueryDialogOpen(true));
                    }}
                    batchQueryDialogOpen={heatmapBatchQueryDialogOpen}
                    onOpenBatchQueryDialog={() => {
                      startTransition(() => setHeatmapBatchQueryDialogOpen(true));
                    }}
                    onRemoveColumn={removeSearchColumnByKey}
                    onShowModuleNamesChange={(showNames) => { executeHeatmapCommand({ type: "set-module-view", showNames }); }}
                    onShowModuleFullNameChange={(showFullName) => { executeHeatmapCommand({ type: "set-module-view", showFullName }); }}
                    onShowModuleCompletenessChange={(showCompleteness) => { executeHeatmapCommand({ type: "set-module-view", showCompleteness }); }}
                    onShowModuleDetailChange={setModuleDetailVisibility}
                    onModuleNameFontSizeChange={(value) => { updateActiveFontProfile({ moduleLabel: Math.max(1, value || 1) }); }}
                    onModuleCompletenessThresholdChange={updateModuleCompletenessThreshold}
                    onShowNumbersChange={(visible) => { executeHeatmapCommand({ type: "set-show-numbers", visible }); }}
                    onRatioDisplayModeChange={(mode) => { executeHeatmapCommand({ type: "set-ratio-display", mode }); }}
                    onValueFontSizeChange={setHeatmapNumberFontSize}
                    onHeatmapColumnWidthChange={changeHeatmapColumnWidth}
                    onColumnLabelFontSizeChange={setColumnLabelFontSize}
                    onHeatmapMetricChange={(metric) => { executeHeatmapCommand({ type: "set-metric", metric }); }}
                    onHeatmapStyleChange={updateCurrentHeatmapStyle}
                    onRemoveHeatmapStyle={removeCurrentHeatmapStyle}
                    onOpenHeatmapColorScale={(styleId) => { startTransition(() => setEditingHeatmapStyleId(styleId)); }}
                    onHeatmapShapeSizeChange={(size) => { executeHeatmapCommand({ type: "set-shape-size", size }); }}
                    onColumnLabelPartsChange={(parts) => { executeHeatmapCommand({ type: "set-column-label-parts", parts }); }}
                    onStartHeatmapStyleSelection={beginHeatmapStyleSelection}
                    onClearHeatmapStyles={clearCurrentTreeHeatmapStyles}
                    onShowHeatmapLegendChange={setHeatmapLegendVisible}
                    onHeatmapLegendFontSizeChange={(value) => { executeAppearanceCommand({ type: "set-legend-font-size", legend: "heatmap", value }); }}
                    />
                  </Suspense>
                ) : null}
              </div>
            ) : null}
          </aside>
        </main>
      ) : null}

      {columnMenu.open ? (
        <ViewportFloatingLayer
          anchorRect={{ top: columnMenu.y, right: columnMenu.x, bottom: columnMenu.y, left: columnMenu.x }}
          className="context-menu"
          role="menu"
          maxHeight={400}
          onClick={(event) => event.stopPropagation()}
        >
          {columnMenu.targetValue ? (
            <>
              <button type="button" role="menuitem" onClick={() => openInsertDialog("left")}>{localizedText(language, "在左侧插入功能注释", "Insert Annotation Left")}</button>
              <button type="button" role="menuitem" onClick={() => openInsertDialog("right")}>{localizedText(language, "在右侧插入功能注释", "Insert Annotation Right")}</button>
              <button type="button" role="menuitem" onClick={deleteColumn}>{localizedText(language, "删除列", "Delete Column")}</button>
            </>
          ) : (
            <button type="button" role="menuitem" disabled>{localizedText(language, "当前没有可用的列操作", "No column actions available")}</button>
          )}
        </ViewportFloatingLayer>
      ) : null}

      {nodeMenu.open && nodeMenu.nodeId !== null ? (
        <ViewportFloatingLayer
          anchorRect={{ top: nodeMenu.y, right: nodeMenu.x, bottom: nodeMenu.y, left: nodeMenu.x }}
          className="context-menu"
          role="menu"
          maxHeight={400}
          onClick={(event) => event.stopPropagation()}
        >
          {rerootSpecForNodeMenu(nodeMenu) ? (
            <button
              type="button"
              role="menuitem"
              disabled={viewRoot !== null}
              title={viewRoot !== null ? localizedText(language, "请先重置当前视图根", "Reset the current view root first") : undefined}
              onClick={rerootFromNodeMenu}
            >
              {localizedText(language, "在此分支重新定根", "Reroot on This Branch")}
            </button>
          ) : null}
          {canAddTreeStyle(nodeMenu.nodeId) ? <button type="button" role="menuitem" onClick={() => openTreeStyleDialog(nodeMenu.nodeId!)}>{localizedText(language, "添加颜色", "Add Color")}</button> : null}
          {nodeMenu.kind === "internal" ? (
            <>
              <button type="button" role="menuitem" disabled={!canSwapVisibleBranch(nodeMenu.nodeId)} onClick={() => swapVisibleBranch(nodeMenu.nodeId!)}>{localizedText(language, "交换左右子分支", "Swap Child Branches")}</button>
              <button type="button" role="menuitem" disabled={isCanvasRerooted} onClick={() => {
                if (addCanvasNodeToBranchCart(nodeMenu.nodeId!)) setNodeMenu({ open: false, x: 0, y: 0, nodeId: null, kind: null });
              }}>{localizedText(language, "将当前子树加入下载列表", "Add Current Subtree To Download List")}</button>
              <button type="button" role="menuitem" onClick={() => collapseInternalNode(nodeMenu.nodeId!)}>{localizedText(language, "折叠子树", "Collapse Subtree")}</button>
              <button type="button" role="menuitem" onClick={() => selectSubtree(nodeMenu.nodeId!)}>{localizedText(language, "选择子树", "Select Subtree")}</button>
              <button type="button" role="menuitem" onClick={() => deleteBranch(nodeMenu.nodeId!)}>{localizedText(language, "删除分支", "Delete Branch")}</button>
            </>
          ) : nodeMenu.kind === "terminal" ? (
            <>
              <button type="button" role="menuitem" disabled={isCanvasRerooted} onClick={() => addCurrentBranchToCart(nodeMenu.nodeId!)}>{localizedText(language, "将当前末端节点加入下载列表", "Add Current Terminal Node To Download List")}</button>
              <button type="button" role="menuitem" disabled={!canExpandBranch(nodeMenu)} onClick={() => expandBranch(nodeMenu)}>{localizedText(language, "展开子树", "Expand Subtree")}</button>
              <button type="button" role="menuitem" onClick={() => selectSubtree(nodeMenu.nodeId!)}>{localizedText(language, "选择子树", "Select Subtree")}</button>
              <button type="button" role="menuitem" onClick={() => deleteBranch(nodeMenu.nodeId!)}>{localizedText(language, "删除分支", "Delete Branch")}</button>
            </>
          ) : null}
        </ViewportFloatingLayer>
      ) : null}

      {heatmapStyleDialog.open ? (
        <div className="modal-overlay">
          <div className="modal-card heatmap-style-modal-card heatmap-style-create-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{localizedText(language, "创建热图样式", "Create Heatmap Style")}</h2>
              <button
                type="button"
                className="icon-button modal-close"
                aria-label={localizedText(language, "关闭", "Close")}
                onClick={dismissHeatmapStyleDialog}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="heatmap-style-modal-grid">
              <label className="field">
                <span>{localizedText(language, "形状", "Shape")}</span>
                <select
                  value={heatmapStyleDialog.shape}
                  onChange={(event) => setHeatmapStyleDialog((current) => ({ ...current, shape: event.target.value as PartitionShape }))}
                >
                  {(treeViewMode === "rectangular" ? RECTANGULAR_HEATMAP_SHAPES : CIRCULAR_HEATMAP_SHAPES).map((shape) => (
                    <option key={shape.value} value={shape.value}>{shapeLabel(shape, language)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>{localizedText(language, "名称", "Name")}</span>
              <input
                value={heatmapStyleDialog.name}
                placeholder={localizedText(language, "可选", "Optional")}
                onChange={(event) => setHeatmapStyleDialog((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="heatmap-style-create-scale">
              <div className="heatmap-scale-metric-tabs">
                <span>{localizedText(language, "颜色尺度", "Color Scale")}</span>
                <small>{localizedText(language, "默认继承当前默认样式，可以在创建前调整。", "Starts from the current default style and can be adjusted before creation.")}</small>
              </div>
              <div className="heatmap-style-create-metric-switch" role="tablist" aria-label={localizedText(language, "颜色尺度指标", "Color scale metric")}>
                <button type="button" role="tab" aria-selected={heatmapStyleDialog.metric === "count"} className={heatmapStyleDialog.metric === "count" ? "active" : undefined} onClick={() => setHeatmapStyleDialog((current) => ({ ...current, metric: "count" }))}>
                  {localizedText(language, "基因计数", "Gene Count")}
                </button>
                <button type="button" role="tab" aria-selected={heatmapStyleDialog.metric === "ratio"} className={heatmapStyleDialog.metric === "ratio" ? "active" : undefined} onClick={() => setHeatmapStyleDialog((current) => ({ ...current, metric: "ratio" }))}>
                  {localizedText(language, "物种比例", "Species Ratio")}
                </button>
              </div>
              <Suspense fallback={null}>
                <HeatmapColorScaleEditor
                  language={language}
                  metric={heatmapStyleDialog.metric}
                  style={{
                    id: "heatmap-style-draft",
                    role: "selection",
                    treeViewMode,
                    paletteId: heatmapStyleDialog.paletteId,
                    colorScales: heatmapStyleDialog.colorScales,
                    shape: heatmapStyleDialog.shape,
                    borderMode: "none",
                    name: heatmapStyleDialog.name,
                    leafCellKeys: [],
                  }}
                  onChange={(colorScales) => setHeatmapStyleDialog((current) => ({ ...current, colorScales: colorScales ?? current.colorScales }))}
                  onPaletteChange={(paletteId, colorScales) => setHeatmapStyleDialog((current) => ({ ...current, paletteId, colorScales: colorScales ?? current.colorScales }))}
                />
              </Suspense>
            </div>
            <div className="modal-actions">
              <button type="button" className="button subtle" onClick={dismissHeatmapStyleDialog}>
                {localizedText(language, "取消", "Cancel")}
              </button>
              <button type="button" className="button primary" onClick={createHeatmapStyleFromDialog}>
                {localizedText(language, "创建", "Create")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingHeatmapStyle ? (
        <div className="modal-overlay">
          <div className="modal-card heatmap-scale-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{localizedText(language, "热图颜色尺度", "Heatmap Color Scale")}</h2>
              <button type="button" className="icon-button modal-close" aria-label={localizedText(language, "关闭", "Close")} onClick={() => setEditingHeatmapStyleId(null)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="heatmap-scale-metric-tabs" role="tablist" aria-label={localizedText(language, "颜色尺度指标", "Color scale metric")}>
              <span>{heatmapMetric === "count" ? localizedText(language, "基因计数", "Gene Count") : localizedText(language, "物种比例", "Species Ratio")}</span>
              <small>{localizedText(language, "切换指标时保留各自区间，色阶数量统一应用。", "Metric-specific bounds are retained; level count applies to both.")}</small>
            </div>
            <Suspense fallback={null}>
              <HeatmapColorScaleEditor
                language={language}
                metric={heatmapMetric}
                style={editingHeatmapStyle}
                onChange={(colorScales) => updateCurrentHeatmapStyle(editingHeatmapStyle.id, { colorScales })}
                onPaletteChange={(paletteId, colorScales) => updateCurrentHeatmapStyle(editingHeatmapStyle.id, { paletteId, colorScales })}
              />
            </Suspense>
            <div className="modal-actions">
              <button type="button" className="button primary" onClick={() => setEditingHeatmapStyleId(null)}>{localizedText(language, "完成", "Done")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {treeStyleDialog.open ? (
        <div className="modal-overlay">
          <div className="modal-card heatmap-style-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{localizedText(language, "添加颜色", "Add Color")}</h2>
              <button
                type="button"
                className="icon-button modal-close"
                aria-label={localizedText(language, "关闭", "Close")}
                onClick={() => setTreeStyleDialog({ open: false, nodeId: null, kind: "label", color: "#D32F2F" })}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="heatmap-style-modal-grid">
              <label className="field">
                <span>{localizedText(language, "样式", "Style")}</span>
                <select value={treeStyleDialog.kind} onChange={(event) => setTreeStyleDialog((current) => ({ ...current, kind: event.target.value as TreeStyleKind }))}>
                  <option value="label">{localizedText(language, "标签", "Label")}</option>
                  <option value="branch">{localizedText(language, "分支", "Branch")}</option>
                  <option value="background">{localizedText(language, "背景", "Background")}</option>
                  <option value="strip">{localizedText(language, "条带", "Strip")}</option>
                </select>
              </label>
              <label className="field">
                <span>{localizedText(language, "颜色", "Color")}</span>
                <div className="tree-style-color-field">
                  <input type="color" value={normalizeTreeStyleColor(treeStyleDialog.color) ?? "#D32F2F"} onChange={(event) => setTreeStyleDialog((current) => ({ ...current, color: event.target.value.toUpperCase() }))} />
                  <input value={treeStyleDialog.color} placeholder="#D32F2F" onChange={(event) => setTreeStyleDialog((current) => ({ ...current, color: event.target.value }))} />
                </div>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="button subtle" onClick={() => setTreeStyleDialog({ open: false, nodeId: null, kind: "label", color: "#D32F2F" })}>{localizedText(language, "取消", "Cancel")}</button>
              <button type="button" className="button primary" onClick={createTreeStyleFromDialog}>{localizedText(language, "确认", "Confirm")}</button>
            </div>
          </div>
        </div>
      ) : null}

      <ActionConfirmDialog
        open={resetViewConfirmOpen}
        title={localizedText(language, "重置视图？", "Reset view?")}
        description={localizedText(
          language,
          "将恢复最近一次应用购物车范围后的物种树。当前购物车、查询列、布局和样式会保留。",
          "This restores the species tree recorded after the latest applied Cart scope. The current Cart, query columns, layout, and styles are kept.",
        )}
        cancelText={localizedText(language, "取消", "Cancel")}
        confirmText={localizedText(language, "确认重置", "Reset View")}
        onCancel={() => setResetViewConfirmOpen(false)}
        onConfirm={() => {
          resetToInitialSpeciesTree();
          setResetViewConfirmOpen(false);
        }}
      />

      <ActionConfirmDialog
        open={treeStyleResetConfirmOpen}
        title={localizedText(language, "恢复默认样式", "Restore Default Styles")}
        description={localizedText(language, "所有物种树颜色样式都将被移除，且无法撤销。", "All species-tree color styles will be removed. This cannot be undone.")}
        cancelText={localizedText(language, "取消", "Cancel")}
        confirmText={localizedText(language, "全部清除", "Clear All")}
        onCancel={() => setTreeStyleResetConfirmOpen(false)}
        onConfirm={() => {
          clearCurrentTreeStyles();
          setTreeStyleResetConfirmOpen(false);
        }}
      />

      {downloadHeaderDialog.open ? (
        <Suspense fallback={null}>
          <DownloadHeaderDialog
        language={language}
        open
        mode={downloadHeaderDialog.mode}
        selectedFields={downloadHeaderDialog.fields}
        isPreparing={isPreparingDownload}
        progress={downloadTaskProgress}
        onModeChange={(mode) => setDownloadHeaderDialog((current) => ({ ...current, mode }))}
        onToggleField={(field) => {
          setDownloadHeaderDialog((current) => ({
            ...current,
            fields: current.fields.includes(field)
              ? current.fields.filter((item) => item !== field)
              : [...current.fields, field],
          }));
        }}
        onCancel={() => setDownloadHeaderDialog((current) => ({ ...current, open: false }))}
        onConfirm={async () => {
          const mode = downloadHeaderDialog.mode;
          const fields = [...downloadHeaderDialog.fields];
          await executeDownload(mode, fields);
        }}
          />
        </Suspense>
      ) : null}

      {heatmapQueryDialogOpen ? (
        <Suspense fallback={null}>
          <HeatmapQueryDialog
        open
        language={language}
        conditions={heatmapQueryConditions}
        annotationTypes={Array.from(
          new Set(
            [...(datasets?.annotation_types.length ? datasets.annotation_types : ["cog", "kegg", "pfam"]), "module"]
              .filter((type) => type !== "keggmodule"),
          ),
        )}
        activeSuggestionId={heatmapQueryActiveSuggestionId}
        suggestions={heatmapQuerySuggestionsById}
        moduleSuggestions={heatmapModuleSuggestionsById}
        isSubmitting={isAppendingHeatmapQueries}
        onUpdateCondition={updateHeatmapQueryCondition}
        onAddCondition={addHeatmapQueryCondition}
        onRemoveCondition={removeHeatmapQueryCondition}
        onActiveSuggestionChange={setHeatmapQueryActiveSuggestionId}
        onSuggestionApply={applyHeatmapQuerySuggestion}
        onModuleSuggestionApply={applyHeatmapModuleSuggestion}
        onCancel={resetHeatmapQueryDialog}
        onConfirm={() => {
          void addHeatmapColumn();
        }}
          />
        </Suspense>
      ) : null}

      {heatmapBatchQueryDialogOpen ? (
        <Suspense fallback={null}>
          <HeatmapBatchQueryDialog
        open
        language={language}
        value={heatmapBatchQueryText}
        isSubmitting={isAppendingHeatmapQueries}
        onChange={setHeatmapBatchQueryText}
        onCancel={resetHeatmapBatchQueryDialog}
        onConfirm={() => {
          void addHeatmapColumn(parseBatchQuery(heatmapBatchQueryText));
        }}
          />
        </Suspense>
      ) : null}

      {insertDialog.open ? (
        <Suspense fallback={null}>
          <InsertColumnDialog
            language={language}
            state={insertDialog}
            suggestions={insertSuggestions}
            annotationTypes={(datasets?.annotation_types ?? ["cog", "kegg", "pfam"]).filter((type) => type !== "keggmodule" && type !== "module")}
            onChange={setInsertDialog}
            onCancel={() => setInsertDialog(emptyInsertDialog())}
            onConfirm={confirmInsertColumn}
          />
        </Suspense>
      ) : null}

      {candidateConditionId ? (
        <Suspense fallback={null}>
          <CandidateDialog
            language={language}
            items={suggestions[candidateConditionId] ?? []}
            onPick={(item) => {
              applySuggestion(candidateConditionId, item);
              setCandidateConditionId(null);
              setError(null);
            }}
            onCancel={() => setCandidateConditionId(null)}
          />
        </Suspense>
      ) : null}
      {activePage === "saved-queries" ? (
        <Suspense fallback={null}>
          <SavedQueriesPage hasMore={savedQueriesHasMore} loadingMore={savedQueriesLoadingMore} onLoadMore={() => { void loadMoreSavedQueries(); }} language={language} categories={savedQueryCategories} records={savedQueries} onCreateCategory={() => { void createQueryCategory(); }} onDeleteCategory={(id) => setSavedQueryAction({ kind: "category", id })} onDeleteRecord={(id) => setSavedQueryAction({ kind: "record", id })} onRestore={(id) => { void restoreSavedQuery(id); }} />
        </Suspense>
      ) : null}

      <ActionConfirmDialog open={savedQueryAction !== null} title={savedQueryAction?.kind === "category" ? localizedText(language, "删除分类？", "Delete category?") : localizedText(language, "删除查询记录？", "Delete saved query?")} description={savedQueryAction?.kind === "category" ? localizedText(language, "该分类中的记录会移到未分类。", "Records in this category will be moved to Uncategorized.") : localizedText(language, "该查询记录将被永久删除。", "This saved query will be permanently deleted.")} cancelText={localizedText(language, "取消", "Cancel")} confirmText={localizedText(language, "删除", "Delete")} onCancel={() => setSavedQueryAction(null)} onConfirm={() => { void confirmSavedQueryAction(); }} />

      {saveDialogOpen ? (
        <div className="modal-overlay">
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{localizedText(language, "保存查询", "Save query")}</h2>
              <button type="button" className="icon-button modal-close" aria-label={localizedText(language, "关闭", "Close")} onClick={() => setSaveDialogOpen(false)}><X size={16} /></button>
            </div>
            <label className="field"><span>{localizedText(language, "记录名称", "Record name")}</span><input autoFocus value={savedQueryTitle} onChange={(event) => setSavedQueryTitle(event.target.value)} /></label>
            <div className="save-query-category-field">
              <label className="field"><span>{localizedText(language, "保存到分类", "Save to category")}</span><select value={savedQueryCategoryId ?? ""} onChange={(event) => setSavedQueryCategoryId(event.target.value ? Number(event.target.value) : null)}><option value="">{localizedText(language, "未分类", "Uncategorized")}</option>{savedQueryCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <button type="button" className="icon-button" title={localizedText(language, "新建分类", "New category")} aria-label={localizedText(language, "新建分类", "New category")} onClick={() => setSaveCategoryDraftOpen((open) => !open)}><FolderPlus size={16} /></button>
            </div>
            {saveCategoryDraftOpen ? <div className="save-query-category-create"><input placeholder={localizedText(language, "分类名称", "Category name")} value={saveCategoryName} onChange={(event) => setSaveCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createSaveDialogCategory(); } }} /><button type="button" className="button subtle" onClick={() => { void createSaveDialogCategory(); }}>{localizedText(language, "创建", "Create")}</button></div> : null}
            <p className="muted" role="status">{savedWorkspaceToken === workspaceChangeToken ? localizedText(language, "当前画布已保存。", "Current canvas is saved.") : localizedText(language, "有未保存的画布修改。", "Canvas has unsaved changes.")}{pendingSaveAttemptRef.current ? localizedText(language, "再次保存将重试上一次保存；成功后可继续保存新的修改。", "Saving again retries the previous request; then save any newer edits.") : ""}</p>
            <div className="modal-actions">{restoredRecord ? <button type="button" disabled={isSavingWorkspace} className="button subtle" onClick={() => { void saveCurrentQuery(true); }}>{localizedText(language, "另存为新记录", "Save as new")}</button> : null}<button type="button" className="button subtle" onClick={() => setSaveDialogOpen(false)}>{localizedText(language, "取消", "Cancel")}</button><button type="button" disabled={isSavingWorkspace} className="button primary" onClick={() => { void saveCurrentQuery(); }}>{localizedText(language, "保存", "Save")}</button></div>
          </div>
        </div>
      ) : null}

      {pendingNameNodeId !== null ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h2>{localizedText(language, "命名末端节点", "Name Terminal Node")}</h2>
              <button type="button" className="icon-button modal-close" aria-label={localizedText(language, "关闭命名对话框", "Close naming dialog")} onClick={() => {
                setPendingNameNodeId(null);
                setPendingNameCollapseRank(null);
              }}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p>{localizedText(language, "此内部节点没有明确的分类单元名称。请输入折叠后显示的标签。", "This internal node has no clear taxon name. Enter the label to show after collapsing.")}</p>
            <input value={customNameDraft} onChange={(event) => setCustomNameDraft(event.target.value)} autoFocus />
            <div className="modal-actions">
              <button type="button" className="button subtle" onClick={() => {
                setPendingNameNodeId(null);
                setPendingNameCollapseRank(null);
              }}>{localizedText(language, "取消", "Cancel")}</button>
              <button type="button" className="button primary" onClick={confirmCustomName}>{localizedText(language, "确认", "Confirm")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;

