import type { AnnotationCondition, AnnotationColumnSearchResult, TreeNodeSearchItem } from "../../types";
import type { DrawerPanel, HeatmapLegendState, TreeViewMode, HeatmapColorScales, PartitionShape, HeatmapMetric } from "../result/resultTypes";
import type { BranchPruneDraft } from "../result/branchPrune";
import type { TreeStyleRecord, TreeStyleKind } from "../result/treeStyleModel";
import type { TreeCoreRuntime, TreeRerootSpec } from "../tree-core/treeCoreTypes";
import { createTreeCoreViewModel } from "../tree-core/treeCoreView";
import { aliveBitsetFromLeafNodeIds } from "../tree-core/treeBitmapState";
import { rebuildAliveTreeWithSwappedBranches, swappedBranchNodeIdsFromAliveTree } from "../tree-core/aliveTreeRuntime";
import type { TreeWorkspaceResetBaseline } from "../workbench/treeWorkspace";
import type { WorkbenchSnapshot } from "../workbench/workbenchCommandFacade";
import { captureSnapshot, createWorkbenchReactState, projectWorkbenchSnapshot, type WorkbenchReactState } from "../workbench/workbenchReactBridge";
import { createWorkbenchAppearance } from "../workbench/workbenchAppearance";
import { ensureDefaultHeatmapStyles } from "../result/heatmapStyleModel";
import { normalizeColumnKey } from "../result/resultVisualUtils";

export const WORKSPACE_DOCUMENT_VERSION = 3;
export const WORKSPACE_RENDERER_VERSION = 2;

export type TreeDocument = Omit<TreeWorkspaceResetBaseline, "runtime" | "aliveBitset" | "customTerminalLabels"> & {
  rerootSpec: TreeRerootSpec;
  swappedBranchNodeIds: number[];
  aliveLeafNodeIds: number[];
  customTerminalLabels: Array<[number, string]>;
};

export interface SavedCamera {
  cameraSchemaVersion: 3;
  interactionScale: number;
  anchor: { x: number; y: number };
  viewport: { width: number; height: number };
}

export interface LegacySavedCamera {
  documentScale?: number;
  zoom: number;
  interactionZoom?: number;
  offset: { x: number; y: number };
  viewport: { width: number; height: number };
  autoFitZoom?: number;
  referenceFitZoom?: number;
}

export function migrateLegacyCamera(camera: SavedCamera | LegacySavedCamera): SavedCamera {
  if ("cameraSchemaVersion" in camera && camera.cameraSchemaVersion === 3) {
    return {
      cameraSchemaVersion: 3,
      interactionScale: Math.max(0.0001, camera.interactionScale),
      anchor: { ...camera.anchor },
      viewport: { ...camera.viewport },
    };
  }
  const legacy = camera as LegacySavedCamera;
  const documentScale = Math.max(0.0001, legacy.documentScale ?? legacy.zoom);
  const interactionScale = Number.isFinite(legacy.interactionZoom) && (legacy.interactionZoom ?? 0) > 0
    ? legacy.interactionZoom!
    : Math.max(0.0001, documentScale / Math.max(0.0001, legacy.autoFitZoom ?? 1));
  return {
    cameraSchemaVersion: 3,
    interactionScale,
    anchor: {
      x: (legacy.viewport.width / 2 - legacy.offset.x) / documentScale,
      y: (legacy.viewport.height / 2 - legacy.offset.y) / documentScale,
    },
    viewport: { ...legacy.viewport },
  };
}

export function cameraOffsetForViewport(
  camera: SavedCamera,
  viewport: SavedCamera["viewport"],
  documentScale: number,
): { x: number; y: number } {
  const scale = Math.max(0.0001, documentScale);
  return {
    x: viewport.width / 2 - camera.anchor.x * scale,
    y: viewport.height / 2 - camera.anchor.y * scale,
  };
}

export interface WorkspaceViewDocument {
  cameras: Record<TreeViewMode, SavedCamera | null>;
  heatmapLegend: HeatmapLegendState | null;
  taxonAnnotation: HeatmapLegendState | null;
  drawerPanel: DrawerPanel;
  drawerOpen: boolean;
  controlDrawerWidth: number;
  selectedNodeId: number | null;
  scroll: { left: number; top: number };
  controlPanelScrollTop: number;
}

export interface WorkspaceDraftsDocument {
  queryMode: "manual" | "batch";
  conditions: AnnotationCondition[];
  batchQueryText: string;
  branchPruneDraft: BranchPruneDraft;
  treeSearch: string;
  treeSearchRank: string;
  treeSearchPickedItem: TreeNodeSearchItem | null;
  detailRankSearch: string;
  detailRankSearchRank: string;
  detailRankTargetRank: string;
  heatmapQueryConditions: AnnotationCondition[];
  heatmapBatchQueryText: string;
  resultScopeSearch: string;
  resultScopeSearchRank: string;
  resultScopeExpandRank: string;
  customNameDraft: string;
  nameTarget: { nodeId: number | null; collapseRank: string | null };
  heatmapStyle: { open: boolean; paletteId: string; shape: PartitionShape; name: string; colorScales: HeatmapColorScales; metric: HeatmapMetric; editingId: string | null };
  treeStyle: { open: boolean; nodeId: number | null; kind: TreeStyleKind; color: string };

}

export interface WorkspaceDocument {
  schemaVersion: 3;
  rendererVersion: 2;
  dataset: WorkbenchSnapshot["datasetIdentity"];
  tree: TreeDocument;
  resetBaseline: TreeDocument | null;
  query: WorkbenchSnapshot["query"] & { resultSession: AnnotationColumnSearchResult };
  cart: Omit<WorkbenchSnapshot["cart"], "aliveBitset"> & { aliveLeafNodeIds: number[] };
  treeStyles: TreeStyleRecord[];
  heatmap: Omit<WorkbenchSnapshot["heatmap"], "selectedCellKeys"> & { selectedCellKeys: string[] };
  appearance: WorkbenchSnapshot["appearance"];
  view: WorkspaceViewDocument;
  drafts: WorkspaceDraftsDocument;
}

function collectAliveLeaves(runtime: TreeCoreRuntime, bitset: Uint8Array): number[] {
  const leaves: number[] = [];
  for (let id = 0; id < runtime.nodeCount; id += 1) if (runtime.isLeaf[id] === 1 && bitset[id] === 1) leaves.push(id);
  return leaves;
}

function captureTree(raw: TreeCoreRuntime, tree: TreeWorkspaceResetBaseline): TreeDocument {
  const { runtime, aliveBitset, customTerminalLabels, ...settings } = tree;
  return {
    ...settings,
    rerootSpec: { ...runtime.rerootSpec },
    swappedBranchNodeIds: swappedBranchNodeIdsFromAliveTree(raw, runtime),
    aliveLeafNodeIds: collectAliveLeaves(runtime, aliveBitset),
    customTerminalLabels: [...customTerminalLabels],
  };
}

/** Only committed user state crosses this boundary; runtime arrays and Chat never do. */
export function captureWorkspaceDocument(raw: TreeCoreRuntime, state: WorkbenchReactState, view: WorkspaceViewDocument, drafts: WorkspaceDraftsDocument): WorkspaceDocument {
  if (!state.aliveBitset || !state.cartAliveBitset || !state.resultSession) throw new Error("The canvas is not ready to save.");
  const snapshot = captureSnapshot(raw, state, state.aliveBitset, state.revision);
  if (!snapshot) throw new Error("The canvas is not ready to save.");
  const { resetBaseline, ...tree } = snapshot.tree;
  return {
    schemaVersion: WORKSPACE_DOCUMENT_VERSION,
    rendererVersion: WORKSPACE_RENDERER_VERSION,
    dataset: snapshot.datasetIdentity,
    tree: captureTree(raw, tree),
    resetBaseline: resetBaseline ? captureTree(raw, resetBaseline) : null,
    query: { ...snapshot.query, resultSession: state.resultSession },
    cart: { records: snapshot.cart.records, batches: snapshot.cart.batches, aliveLeafNodeIds: collectAliveLeaves(raw, snapshot.cart.aliveBitset) },
    treeStyles: state.treeStyles,
    heatmap: { ...snapshot.heatmap, styles: ensureDefaultHeatmapStyles(snapshot.heatmap.styles), selectedCellKeys: [...snapshot.heatmap.selectedCellKeys] },
    appearance: snapshot.appearance,
    view,
    drafts,
  };
}

function invalid(message: string): never { throw new Error(`Invalid canvas archive: ${message}`); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected an object");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalid("expected an array"); return value; }
function string(value: unknown) { if (typeof value !== "string") invalid("expected text"); }
function finite(value: unknown) { if (typeof value !== "number" || !Number.isFinite(value)) invalid("expected a finite number"); }
function ids(value: unknown) {
  const values = array(value);
  if (values.some((id) => !Number.isSafeInteger(id) || Number(id) < 0) || new Set(values).size !== values.length) invalid("invalid or duplicate node ids");
}
function like(value: unknown, template: unknown): void {
  if (typeof template === "number") { finite(value); return; }
  if (typeof template === "string") { string(value); return; }
  if (typeof template === "boolean") { if (typeof value !== "boolean") invalid("expected a boolean"); return; }
  const candidate = object(value);
  for (const [key, child] of Object.entries(object(template))) like(candidate[key], child);
}
function checkTree(value: unknown) {
  const tree = object(value);
  like(tree.rerootSpec, { edgeNodeIdA: 0, edgeNodeIdB: 0, position: 0.5 });
  ids(tree.swappedBranchNodeIds); ids(tree.aliveLeafNodeIds);
  string(tree.displayRank); string(tree.stripRank);
  array(tree.localRankRules); array(tree.localRankConstraints); array(tree.customTerminalLabels);
  const nodeIds: unknown[] = [];
  for (const entry of array(tree.terminalNodeTable)) {
    const row = object(entry); nodeIds.push(row.nodeId); ids(row.ownedLeafNodeIds);
    string(row.rank); string(row.label); string(row.collapseCeilingRank);
  }
  ids(nodeIds);
}

/** Validate current state, then normalize supported V1/V2 cameras to V3. */
export function decodeWorkspaceDocument(value: unknown): WorkspaceDocument {
  const doc = object(value);
  const sourceSchema = Number(doc.schemaVersion);
  const sourceRenderer = Number(doc.rendererVersion);
  if (![[1, 1], [2, 1], [WORKSPACE_DOCUMENT_VERSION, WORKSPACE_RENDERER_VERSION]].some(
    ([schema, renderer]) => sourceSchema === schema && sourceRenderer === renderer,
  )) invalid("unsupported version");
  like(doc.dataset, { speciesTree: "", genomeDatabase: "", datasetRevision: "" });
  checkTree(doc.tree);
  if (doc.resetBaseline !== null) checkTree(doc.resetBaseline);
  like(doc.appearance, createWorkbenchAppearance());
  const appearance = object(doc.appearance);
  if (!["rectangular", "circular"].includes(String(appearance.treeViewMode))) invalid("tree mode");
  const query = object(doc.query), result = object(query.resultSession);
  string(result.species_tree); string(result.genome_database); array(result.columns); array(result.module_groups); array(query.columnSlots);
  const cart = object(doc.cart); ids(cart.aliveLeafNodeIds); array(cart.records); array(cart.batches);
  array(doc.treeStyles);
  const heatmap = object(doc.heatmap);
  like(heatmap, { metric: "", ratioDisplayMode: "", showNumbers: false, shapeSize: 1, activeModuleId: "", showModuleNames: false, showModuleFullName: false, showModuleCompleteness: false, showModuleDetail: false, moduleCompletenessThreshold: "" });
  array(heatmap.styles); array(heatmap.selectedCellKeys); array(heatmap.columnLabelParts);
  const view = object(doc.view);
  like(view, { drawerPanel: "", drawerOpen: true, controlDrawerWidth: 1, controlPanelScrollTop: 0, scroll: { left: 0, top: 0 } });
  const cameras = object(view.cameras);
  for (const mode of ["rectangular", "circular"]) {
    if (cameras[mode] === null) continue;
    const camera = object(cameras[mode]);
    if (camera.cameraSchemaVersion === 3) {
      like(camera, { cameraSchemaVersion: 3, interactionScale: 1, anchor: { x: 0, y: 0 }, viewport: { width: 1, height: 1 } });
      const viewport = object(camera.viewport);
      if (Number(camera.interactionScale) <= 0 || Number(viewport.width) <= 0 || Number(viewport.height) <= 0) invalid("camera scale");
      cameras[mode] = migrateLegacyCamera(camera as unknown as SavedCamera);
    } else {
      like(camera, { zoom: 1, offset: { x: 0, y: 0 }, viewport: { width: 1, height: 1 } });
      const viewport = object(camera.viewport);
      if (Number(camera.zoom) <= 0 || Number(viewport.width) <= 0 || Number(viewport.height) <= 0) invalid("camera scale");
      cameras[mode] = migrateLegacyCamera(camera as unknown as LegacySavedCamera);
    }
  }
  if (cameras[String(appearance.treeViewMode)] === null) invalid("missing active camera");
  for (const key of ["heatmapLegend", "taxonAnnotation"]) if (view[key] !== null) like(view[key], { open: false, x: 0, y: 0, width: 1, height: 1 });
  const drafts = object(doc.drafts);
  like(drafts, { queryMode: "", batchQueryText: "", treeSearch: "", treeSearchRank: "", detailRankSearch: "", detailRankSearchRank: "", detailRankTargetRank: "", heatmapBatchQueryText: "", resultScopeSearch: "", resultScopeSearchRank: "", resultScopeExpandRank: "", customNameDraft: "" });
  array(drafts.conditions); array(drafts.heatmapQueryConditions); object(drafts.branchPruneDraft);
  object(drafts.nameTarget); object(drafts.heatmapStyle); object(drafts.treeStyle);
  doc.schemaVersion = WORKSPACE_DOCUMENT_VERSION;
  doc.rendererVersion = WORKSPACE_RENDERER_VERSION;
  return doc as unknown as WorkspaceDocument;
}

function prepareTree(raw: TreeCoreRuntime, saved: TreeDocument): TreeWorkspaceResetBaseline {
  const runtime = rebuildAliveTreeWithSwappedBranches(raw, saved.rerootSpec, saved.swappedBranchNodeIds);
  const tree = createTreeCoreViewModel(runtime);
  const exists = (id: number) => Number.isInteger(id) && id >= 0 && id < raw.nodeCount;
  const alive = new Set(saved.aliveLeafNodeIds);
  if (saved.aliveLeafNodeIds.some((id) => !exists(id) || raw.isLeaf[id] !== 1)) invalid("scope contains an unknown leaf");
  if (saved.viewRootNodeId !== null && !exists(saved.viewRootNodeId)) invalid("unknown view root");
  const expected = new Set(saved.aliveLeafNodeIds.filter((id) => saved.viewRootNodeId === null || tree.isAncestorOf(saved.viewRootNodeId, id)));
  const owned = new Set<number>();
  for (const row of saved.terminalNodeTable) {
    if (!exists(row.nodeId) || !row.ownedLeafNodeIds.length) invalid("terminal node");
    for (const leaf of row.ownedLeafNodeIds) {
      if (!alive.has(leaf) || !expected.has(leaf) || owned.has(leaf) || !tree.isAncestorOf(row.nodeId, leaf)) invalid("terminal ownership");
      owned.add(leaf);
    }
  }
  if (owned.size !== expected.size) invalid("terminal cut does not cover its scope");
  for (const rule of [...saved.localRankRules, ...saved.localRankConstraints]) if (!exists(rule.nodeId)) invalid("local rank node");
  for (const [nodeId, label] of saved.customTerminalLabels) if (!exists(nodeId) || typeof label !== "string") invalid("custom label");
  return {
    runtime, aliveBitset: aliveBitsetFromLeafNodeIds(tree, saved.aliveLeafNodeIds),
    displayRank: saved.displayRank, stripRank: saved.stripRank,
    localRankRules: saved.localRankRules, localRankConstraints: saved.localRankConstraints,
    terminalNodeTable: saved.terminalNodeTable, customTerminalLabels: new Map(saved.customTerminalLabels), viewRootNodeId: saved.viewRootNodeId,
  };
}

/** Builds an isolated replacement, never invoking editing commands that clear styles. */
export function prepareWorkspaceRestore(raw: TreeCoreRuntime, value: unknown, revision: number): { state: WorkbenchReactState; document: WorkspaceDocument } {
  const document = decodeWorkspaceDocument(value);
  if (document.dataset.speciesTree !== raw.dataset.species_tree || document.dataset.genomeDatabase !== raw.dataset.genome_database
    || document.dataset.datasetRevision !== (raw.dataset.dataset_revision ?? "unversioned")) invalid("dataset version changed");
  if (document.query.resultSession.species_tree !== raw.dataset.species_tree || document.query.resultSession.genome_database !== raw.dataset.genome_database) invalid("query dataset");
  const nodeExists = (id: number) => Number.isInteger(id) && id >= 0 && id < raw.nodeCount;
  const columns = new Set(document.query.resultSession.columns.map(normalizeColumnKey));
  if (columns.size !== document.query.resultSession.columns.length) invalid("duplicate query column");
  for (const slot of document.query.columnSlots) if (!columns.has(slot.columnKey)) invalid("column slot");
  for (const style of document.treeStyles) if (!nodeExists(style.nodeId) || style.nodeIds.some((id) => !nodeExists(id))) invalid("tree style target");
  const selectedRows = new Set(document.tree.terminalNodeTable.map((row) => `terminal-${row.nodeId}-${row.rank || "node"}`));
  const checkCell = (key: string, leaf: boolean) => {
    const separator = key.indexOf("::");
    if (separator < 1 || !columns.has(key.slice(separator + 2))) invalid("heatmap target column");
    const target = key.slice(0, separator);
    if (leaf ? !/^\d+$/.test(target) || !nodeExists(Number(target)) || raw.isLeaf[Number(target)] !== 1 : !selectedRows.has(target)) invalid("heatmap target row");
  };
  for (const style of document.heatmap.styles) for (const key of style.leafCellKeys) checkCell(key, true);
  for (const key of document.heatmap.selectedCellKeys) checkCell(key, false);
  for (const id of document.cart.aliveLeafNodeIds) if (!nodeExists(id) || raw.isLeaf[id] !== 1) invalid("Cart leaf");
  for (const record of document.cart.records) if (!nodeExists(record.nodeId) || record.leafNodeIds.some((id) => !nodeExists(id) || raw.isLeaf[id] !== 1)) invalid("Cart record");
  if (document.view.selectedNodeId !== null && !nodeExists(document.view.selectedNodeId)) invalid("selected node");
  for (const id of [document.drafts.nameTarget.nodeId, document.drafts.treeStyle.nodeId]) if (id !== null && !nodeExists(id)) invalid("draft node");
  const tree = prepareTree(raw, document.tree);
  const resetBaseline = document.resetBaseline ? prepareTree(raw, document.resetBaseline) : null;
  const state = projectWorkbenchSnapshot(createWorkbenchReactState(), {
    revision, datasetIdentity: document.dataset, tree: { ...tree, resetBaseline },
    query: document.query,
    cart: { records: document.cart.records, batches: document.cart.batches, aliveBitset: aliveBitsetFromLeafNodeIds(createTreeCoreViewModel(raw), document.cart.aliveLeafNodeIds) },
    heatmap: { ...document.heatmap, selectedCellKeys: new Set(document.heatmap.selectedCellKeys) },
    appearance: document.appearance,
  });
  return { state: { ...state, treeStyles: document.treeStyles }, document };
}
