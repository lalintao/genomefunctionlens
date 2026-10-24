import type { TreeViewMode } from "../resultTypes";
import { CIRCULAR_BRANCH_RENDER_MULTIPLIER, RECT_ROOT_STEM_LENGTH } from "../resultVisualConstants";
import { buildCanvasPartitionLayout, type CanvasPartitionLayout, type PartitionLayoutInput } from "./canvasLayout";
import type { TreeLayoutNode } from "../resultTypes";
import { createScenePlanMetadata, type SceneBounds, type ScenePlanMetadata, type ScenePoint } from "../rendering/scenePlan";
export type { SceneBounds, ScenePoint } from "../rendering/scenePlan";
import type { SceneRevision } from "../rendering/renderContracts";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface TreeCamera {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface DensityVisibility {
  branchLabels: boolean;
  stripLabels: boolean;
  speciesNumbers: boolean;
}

export interface RootAnchor {
  x: number;
  y: number;
}

export type TreeHitTargetKind = "node" | "branch" | "cell" | "column" | "strip";

export interface CanvasSceneInput {
  mode: TreeViewMode;
  rootAnchor: RootAnchor;
  bounds: SceneBounds;
  terminalCount: number;
  partition: PartitionLayoutInput;
  /** Revision is supplied by the compiler; defaults keep the legacy adapter safe. */
  revision?: Partial<SceneRevision>;
  semanticKeyParts?: readonly unknown[];
  layoutKeyParts?: readonly unknown[];
  frameKeyParts?: readonly unknown[];
}

export interface CanvasScene {
  readonly plan: ScenePlanMetadata;
  mode: TreeViewMode;
  rootAnchor: RootAnchor;
  bounds: SceneBounds;
  partitions: CanvasPartitionLayout;
  density: DensityVisibility;
}

export function buildCanvasScene(input: CanvasSceneInput): CanvasScene {
  const plan = createScenePlanMetadata({
    semantic: input.semanticKeyParts ?? [input.mode, input.terminalCount],
    layout: input.layoutKeyParts ?? [input.mode, input.bounds, input.partition],
    frame: input.frameKeyParts ?? [input.bounds],
    revision: input.revision,
  });
  return Object.freeze({
    plan,
    mode: input.mode,
    rootAnchor: input.rootAnchor,
    bounds: input.bounds,
    partitions: buildCanvasPartitionLayout(input.partition),
    density: initialDensityVisibility(input.terminalCount),
  });
}

export function cameraChanged(
  previous: TreeCamera,
  next: TreeCamera,
  tolerance = 0.0001,
) {
  const safeTolerance = Math.max(0, tolerance);
  return Math.abs(previous.zoom - next.zoom) > safeTolerance
    || Math.abs(previous.offsetX - next.offsetX) > safeTolerance
    || Math.abs(previous.offsetY - next.offsetY) > safeTolerance;
}

export function rectangularFitFrame(
  viewportWidth: number,
  padding: number,
  annotationWidth = 0,
  annotationGap = 24,
  annotationInset = 0,
) {
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safePadding = Math.max(0, padding);
  const requestedLeftReservation = Math.max(0, annotationWidth) > 0
    ? Math.max(0, annotationInset) + Math.max(0, annotationWidth) + Math.max(0, annotationGap)
    : 0;
  const maxLeftReservation = Math.max(0, safeViewportWidth - safePadding * 2 - 1);
  const reservedLeft = Math.min(requestedLeftReservation, maxLeftReservation);
  return {
    viewportWidth: Math.max(1, safeViewportWidth - reservedLeft),
    offsetX: safePadding + reservedLeft,
    reservedLeft,
  };
}

export function shouldAutomaticallyFitTreeMutation(input: {
  mode: TreeViewMode;
  fitRequested: boolean;
  reset: boolean;
}) {
  return input.fitRequested;
}

export function shouldAutomaticallyFitLayoutTransition(input: {
  modeChanged: boolean;
  rankChanged: boolean;
  datasetChanged: boolean;
}) {
  return input.modeChanged || input.rankChanged || input.datasetChanged;
}

export function scheduleFitWhenStable(
  isReady: () => boolean,
  layoutKey: () => string,
  fit: () => void,
  requestFrame: (callback: () => void) => number,
  maxAttempts = 30,
  requiredStableFrames = 2,
) {
  let cancelled = false;
  let attempts = 0;
  let previousLayoutKey: string | null = null;
  let stableFrames = 0;

  const attemptFit = () => {
    if (cancelled) return;
    attempts += 1;
    if (!isReady()) {
      previousLayoutKey = null;
      stableFrames = 0;
    } else {
      const nextLayoutKey = layoutKey();
      if (nextLayoutKey === previousLayoutKey) {
        stableFrames += 1;
      } else {
        previousLayoutKey = nextLayoutKey;
        stableFrames = 1;
      }
      if (stableFrames >= requiredStableFrames) {
        fit();
        return;
      }
    }
    if (attempts >= maxAttempts) return;
    requestFrame(attemptFit);
  };

  requestFrame(attemptFit);
  return () => {
    cancelled = true;
  };
}

export interface ViewerFitConvergenceState {
  iteration: number;
  lastLayoutKey: string | null;
  lastZoom: number | null;
}

export const MIN_VIEW_ZOOM = 0.0001;

/**
 * A fit can change the geometry that determines its own zoom. Keep the normal
 * two-frame convergence check, but make alternating layouts finite so a small
 * rounding oscillation cannot run forever.
 */
export function advanceViewerFitConvergence(
  state: ViewerFitConvergenceState,
  layoutKey: string,
  nextZoom: number,
  maxIterations = 4,
  zoomTolerance = 0.0001,
) {
  const iteration = state.iteration + 1;
  const sameLayout = state.lastLayoutKey === layoutKey;
  const zoomStable = state.lastZoom !== null
    && Math.abs(state.lastZoom - nextZoom) <= Math.max(0.000001, Math.abs(nextZoom) * zoomTolerance);
  return {
    state: { iteration, lastLayoutKey: layoutKey, lastZoom: nextZoom },
    settled: (sameLayout && zoomStable) || iteration >= Math.max(1, maxIterations),
  };
}

export function preserveRootAnchor(before: CanvasScene, after: CanvasScene, camera: TreeCamera): TreeCamera {
  return {
    ...camera,
    offsetX: camera.offsetX + (before.rootAnchor.x - after.rootAnchor.x) * camera.zoom,
    offsetY: camera.offsetY + (before.rootAnchor.y - after.rootAnchor.y) * camera.zoom,
  };
}

export interface SpeciesTreeRenderer {
  buildDrawPlan(input: CanvasSceneInput): CanvasScene;
}

export const speciesTreeRenderer: SpeciesTreeRenderer = {
  buildDrawPlan: buildCanvasScene,
};

export function initialDensityVisibility(terminalCount: number): DensityVisibility {
  return {
    branchLabels: terminalCount <= 1600,
    stripLabels: terminalCount <= 2200,
    speciesNumbers: terminalCount <= 2600,
  };
}

export function circularStripLabelsVisible(input: {
  terminalCount: number;
  showStrip: boolean;
  embedded: boolean;
  forceVisible: boolean;
}) {
  return input.showStrip
    && input.embedded
    && (initialDensityVisibility(input.terminalCount).stripLabels || input.forceVisible);
}

export function resolveCanvasBackingSize(viewport: ViewportSize, requestedPixelRatio: number) {
  const pixelRatio = Math.min(2, Math.max(1, requestedPixelRatio || 1));
  return { width: Math.max(1, Math.ceil(viewport.width * pixelRatio)), height: Math.max(1, Math.ceil(viewport.height * pixelRatio)), pixelRatio };
}

export function resolveCounterProjectedCanvas(viewport: ViewportSize, camera: TreeCamera, worldOrigin: RootAnchor) {
  const zoom = Math.max(0.0001, camera.zoom);
  return { left: -camera.offsetX / zoom - worldOrigin.x, top: -camera.offsetY / zoom - worldOrigin.y, width: viewport.width / zoom, height: viewport.height / zoom };
}

export function scaleBranchCoordinate(rootCoordinate: number, nodeCoordinate: number, branchScale: number) {
  return rootCoordinate + (nodeCoordinate - rootCoordinate) * branchScale;
}

export function polarPoint(cx: number, cy: number, radius: number, angle: number): ScenePoint {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

export function initialResultFitIsReady(
  viewport: ViewportSize,
  content: ViewportSize,
  visibleRowCount: number,
) {
  return visibleRowCount > 0
    && viewport.width > 0
    && viewport.height > 0
    && content.width > 0
    && content.height > 0;
}

function branchOwnerAtProgress<T>(parent: T, child: T, progress: number, parentShare = 0.2): T {
  return progress <= parentShare ? parent : child;
}

export function resolveBranchHitOwner<T>(
  parent: T,
  child: T,
  hit: { parentDistance: number; childDistance: number; childProgress: number; tolerance: number },
): T | null {
  const parentHit = hit.parentDistance <= hit.tolerance;
  const childHit = hit.childDistance <= hit.tolerance;
  if (childHit && (!parentHit || hit.childDistance < hit.parentDistance)) {
    return branchOwnerAtProgress(parent, child, hit.childProgress);
  }
  if (parentHit) return parent;
  return childHit ? branchOwnerAtProgress(parent, child, hit.childProgress) : null;
}

export function progressAlongSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) return 0;
  return Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
}

export function distanceToSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint) {
  const projection = progressAlongSegment(point, start, end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

export function circularBranchBounds(cx: number, cy: number, parentRadius: number, parentAngle: number, childRadius: number, childAngle: number): SceneBounds {
  const points = [polarPoint(cx, cy, parentRadius, parentAngle), polarPoint(cx, cy, parentRadius, childAngle), polarPoint(cx, cy, childRadius, childAngle)];
  const start = Math.min(parentAngle, childAngle);
  const normalizedEnd = normalizeAngleFrom(Math.max(parentAngle, childAngle), start);
  [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((angle) => {
    const normalized = normalizeAngleFrom(angle, start);
    if (normalized <= normalizedEnd + 0.0001) points.push(polarPoint(cx, cy, parentRadius, angle));
  });
  return { left: Math.min(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)), right: Math.max(...points.map((point) => point.x)), bottom: Math.max(...points.map((point) => point.y)) };
}


export function resolveCircularHoverOuterRadius(bounds: { labelOuterRadius: number; [key: string]: number }) { return bounds.labelOuterRadius; }
export function resolveCircularHoverInnerRadius(nodeRadius: number, _nodeHitRadius?: number) { return Math.max(0, nodeRadius); }
export function shouldCaptureCircularPointer(targetKind: string | null | undefined) { return targetKind !== null && targetKind !== undefined; }

export function hitCircularCell(input: {
  x: number; y: number; cx: number; cy: number; startAngle: number; availableArc: number;
  terminalCount: number; heatmapInnerRadius: number; ringStride: number; ringCount: number;
}) {
  if (input.terminalCount <= 0 || input.ringStride <= 0) return null;
  const radius = Math.hypot(input.x - input.cx, input.y - input.cy);
  const ringIndex = Math.floor((radius - input.heatmapInnerRadius) / input.ringStride);
  if (ringIndex < 0 || ringIndex >= input.ringCount) return null;
  let angle = Math.atan2(input.y - input.cy, input.x - input.cx);
  while (angle < input.startAngle) angle += Math.PI * 2;
  while (angle >= input.startAngle + Math.PI * 2) angle -= Math.PI * 2;
  const offset = angle - input.startAngle;
  if (offset < 0 || offset > input.availableArc) return null;
  const rowIndex = Math.floor(offset / (input.availableArc / input.terminalCount));
  return rowIndex >= 0 && rowIndex < input.terminalCount ? { rowIndex, ringIndex } : null;
}

export interface TreeHighlightScope {
  nodeIds: Set<number>;
  activeNodeIds: Set<number>;
  terminalNodes: TreeLayoutNode[];
  directNode: TreeLayoutNode | null;
  syntheticNodeId: number | null;
}

export interface TreeRenderPlan {
  rootNode: TreeLayoutNode;
  nodeById: Map<number, TreeLayoutNode>;
  nodeByNodeId: Map<number, TreeLayoutNode>;
  terminalNodeByNodeId: Map<number, TreeLayoutNode>;
}

export function buildTreeRenderPlan(treeLayoutNodes: readonly TreeLayoutNode[]): TreeRenderPlan {
  const nodeById = new Map(treeLayoutNodes.map((node) => [node.id, node]));
  const nodeByNodeId = new Map(treeLayoutNodes.map((node) => [node.nodeId, node]));
  const terminalNodeByNodeId = new Map(treeLayoutNodes.filter((node) => node.kind !== "internal").map((node) => [node.nodeId, node]));
  return {
    rootNode: treeLayoutNodes.find((node) => node.parent === null) ?? treeLayoutNodes[0],
    nodeById,
    nodeByNodeId,
    terminalNodeByNodeId,
  };
}

export function rectangularNodeX(node: TreeLayoutNode, rootNode: TreeLayoutNode, branchScale: number) {
  return scaleBranchCoordinate(rootNode.x, node.x, branchScale);
}

export function rectangularBackgroundRange(rootX: number, treeRightX: number) {
  return { startX: rootX, width: Math.max(1, treeRightX - rootX) };
}

export function rectangularRootStem(rootX: number, rootY: number, length = RECT_ROOT_STEM_LENGTH) {
  return { startX: rootX - Math.max(0, length), endX: rootX, y: rootY };
}

export function circularBranchRenderValue(value: number) {
  return value * CIRCULAR_BRANCH_RENDER_MULTIPLIER;
}

export function resolveTreeHighlightScope(treeLayoutNodes: readonly TreeLayoutNode[], highlightedNodeId: number | null): TreeHighlightScope {
  const emptyScope: TreeHighlightScope = { nodeIds: new Set(), activeNodeIds: new Set(), terminalNodes: [], directNode: null, syntheticNodeId: null };
  if (highlightedNodeId === null) return emptyScope;
  const directNode = treeLayoutNodes.find((node) => node.nodeId === highlightedNodeId) ?? null;
  const scopeNodes = directNode
    ? collectTreeLayoutSubtree(treeLayoutNodes, directNode)
    : treeLayoutNodes.filter((node) => node.nodePath.includes(highlightedNodeId));
  const terminalNodes = scopeNodes.filter((node) => node.kind !== "internal");
  const visibleTerminalNodes = terminalNodes;
  const nodeIds = new Set(scopeNodes.map((node) => node.nodeId));
  visibleTerminalNodes.forEach((node) => nodeIds.add(node.nodeId));
  const activeNodeIds = new Set<number>();
  if (directNode) activeNodeIds.add(directNode.nodeId);
  else {
    scopeNodes.filter((node) => node.nodePath.includes(highlightedNodeId)).forEach((node) => activeNodeIds.add(node.nodeId));
    if (!activeNodeIds.size) visibleTerminalNodes.forEach((node) => activeNodeIds.add(node.nodeId));
  }
  return { nodeIds, activeNodeIds, terminalNodes: visibleTerminalNodes, directNode, syntheticNodeId: directNode || !visibleTerminalNodes.length ? null : highlightedNodeId };
}

function collectTreeLayoutSubtree(treeLayoutNodes: readonly TreeLayoutNode[], root: TreeLayoutNode) {
  const nodes: TreeLayoutNode[] = [];
  const stack = [root.id];
  while (stack.length) {
    const renderId = stack.pop();
    if (renderId === undefined) continue;
    const node = treeLayoutNodes[renderId];
    if (!node) continue;
    nodes.push(node);
    stack.push(...node.children);
  }
  return nodes;
}

export function normalizeAngleFrom(angle: number, startAngle: number) {
  let normalized = angle;
  while (normalized < startAngle) normalized += Math.PI * 2;
  while (normalized >= startAngle + Math.PI * 2) normalized -= Math.PI * 2;
  return normalized;
}

export function angleFallsOnArc(angle: number, start: number, end: number) {
  const normalizedStart = Math.min(start, end);
  return normalizeAngleFrom(angle, normalizedStart) <= normalizeAngleFrom(Math.max(start, end), normalizedStart) + 0.0001;
}
