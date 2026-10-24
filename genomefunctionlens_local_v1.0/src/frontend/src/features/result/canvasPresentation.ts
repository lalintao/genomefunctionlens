import {
  circularHeatmapFitBounds,
  circularHeatmapOuterRadius,
  resolveCircularRadialLayout,
  type CircularAngularLayout,
  type CircularRadialLayout,
} from "./circularRadialLayout";
export type CanvasPresentationMode = "rectangular" | "circular";
export type CanvasPresentationPurpose = "display" | "export";

export interface CanvasPresentationViewport {
  width: number;
  height: number;
}

export interface CanvasPresentationInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CanvasPresentationBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasPresentationInput {
  mode: CanvasPresentationMode;
  viewport: CanvasPresentationViewport;
  bounds: CanvasPresentationBounds;
  purpose?: CanvasPresentationPurpose;
  padding?: number;
  insets?: Partial<CanvasPresentationInsets>;
  referenceViewport?: CanvasPresentationViewport;
  minimumScale?: number;
  maximumScale?: number;
  interactionZoom?: number;
}

export interface CanvasPresentation {
  camera: {
    zoom: number;
    offsetX: number;
    offsetY: number;
  };
  fitZoom: number;
  presentationScale: number;
  interactionZoom: number;
  usableViewport: CanvasPresentationViewport;
  overflow: {
    x: boolean;
    y: boolean;
  };
  worldVisualPx: (preferredPx: number) => number;
  screenVisualPx: (preferredPx: number) => number;
  screenLength: (worldLength: number) => number;
}
export interface CircularPresentationGeometryInput {
  layoutSize: number;
  radialLayout: Omit<Parameters<typeof resolveCircularRadialLayout>[0], "size">;
  heatmapSlotSpan: number;
  heatmapRingWidth: number;
  outerLabelBudget: number;
  outerPadding?: number;
}

export interface CircularPresentationGeometry {
  size: number;
  radialLayout: CircularRadialLayout;
  fitOuterRadius: number;
  heatmapOuterRadius: number;
  exportOuterRadius: number;
  displayBounds: CanvasPresentationBounds;
  exportBounds: CanvasPresentationBounds;
}

/** Shared circular geometry consumed by paint, hit testing and export. */
export interface CircularSceneGeometry extends CircularPresentationGeometry {
  treeOuterRadius: number;
  radiusByNodeId: ReadonlyMap<number, number>;
  angular: CircularAngularLayout;
}

export function resolveCircularPresentationGeometry(
  input: CircularPresentationGeometryInput,
): CircularPresentationGeometry {
  const layoutSize = Math.max(1, input.layoutSize);
  const radialLayout = resolveCircularRadialLayout({ ...input.radialLayout, size: layoutSize });
  const fitOuterRadius = radialLayout.heatmapInnerRadius;
  const heatmapOuterRadius = circularHeatmapOuterRadius(
    fitOuterRadius,
    input.heatmapSlotSpan,
    input.heatmapRingWidth,
  );
  const exportOuterRadius = heatmapOuterRadius
    + Math.max(0, input.outerLabelBudget)
    + Math.max(0, input.outerPadding ?? 48);
  const size = Math.ceil(Math.max(layoutSize, exportOuterRadius * 2));
  return {
    size,
    radialLayout,
    fitOuterRadius,
    heatmapOuterRadius,
    exportOuterRadius,
    displayBounds: circularHeatmapFitBounds(size, fitOuterRadius),
    exportBounds: circularHeatmapFitBounds(size, exportOuterRadius),
  };
}

export const CANVAS_REFERENCE_VIEWPORT = Object.freeze({ width: 1280, height: 800 });
export const MIN_CANVAS_PRESENTATION_SCALE = 0.65;
export const MAX_CANVAS_PRESENTATION_SCALE = 1.5;

const EMPTY_INSETS: CanvasPresentationInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export const MIN_CANVAS_INTERACTION_ZOOM = 0.0001;
export const MAX_CANVAS_CAMERA_ZOOM = 8;

export function resolveCanvasWheelInteractionZoom(
  currentInteractionZoom: number,
  fitZoom: number,
  direction: "in" | "out",
  maximumCameraZoom = MAX_CANVAS_CAMERA_ZOOM,
) {
  const safeCurrentZoom = Math.max(MIN_CANVAS_INTERACTION_ZOOM, currentInteractionZoom);
  const safeFitZoom = Math.max(0.0001, fitZoom);
  const maximumInteractionZoom = Math.max(
    MIN_CANVAS_INTERACTION_ZOOM,
    maximumCameraZoom / safeFitZoom,
  );
  const factor = direction === "out" ? 0.9 : 1.1;
  return clamp(safeCurrentZoom * factor, MIN_CANVAS_INTERACTION_ZOOM, maximumInteractionZoom);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function positive(value: number, fallback = 1) {
  return Number.isFinite(value) ? Math.max(1, value) : fallback;
}

function normalizeInsets(insets: Partial<CanvasPresentationInsets> | undefined) {
  return {
    top: Math.max(0, insets?.top ?? EMPTY_INSETS.top),
    right: Math.max(0, insets?.right ?? EMPTY_INSETS.right),
    bottom: Math.max(0, insets?.bottom ?? EMPTY_INSETS.bottom),
    left: Math.max(0, insets?.left ?? EMPTY_INSETS.left),
  };
}

function usableViewport(viewport: CanvasPresentationViewport, insets: CanvasPresentationInsets) {
  return {
    width: Math.max(1, positive(viewport.width) - insets.left - insets.right),
    height: Math.max(1, positive(viewport.height) - insets.top - insets.bottom),
  };
}

function fitZoomFor(
  mode: CanvasPresentationMode,
  viewport: CanvasPresentationViewport,
  bounds: CanvasPresentationBounds,
  padding: number,
) {
  const contentWidth = Math.max(1, bounds.right - bounds.left);
  const contentHeight = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  return mode === "circular"
    ? Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
    : availableWidth / contentWidth;
}

export function resolveCanvasPresentation(input: CanvasPresentationInput): CanvasPresentation {
  const padding = Math.max(0, input.padding ?? 24);
  const insets = normalizeInsets(input.insets);
  const actualViewport = usableViewport(input.viewport, insets);
  const referenceViewport = usableViewport(
    input.referenceViewport ?? CANVAS_REFERENCE_VIEWPORT,
    EMPTY_INSETS,
  );
  const referenceFitScale = Math.max(
    0.0001,
    fitZoomFor(input.mode, referenceViewport, input.bounds, padding),
  );
  const containFitZoom = Math.max(
    0.0001,
    fitZoomFor(input.mode, actualViewport, input.bounds, padding),
  );
  const minimumScale = Math.max(0.01, input.minimumScale ?? MIN_CANVAS_PRESENTATION_SCALE);
  const maximumScale = Math.max(minimumScale, input.maximumScale ?? MAX_CANVAS_PRESENTATION_SCALE);
  const responsiveScale = containFitZoom / referenceFitScale;
  const presentationScale = input.purpose === "export"
    ? responsiveScale
    : clamp(responsiveScale, minimumScale, maximumScale);
  const fitZoom = referenceFitScale * presentationScale;
  const interactionZoom = Math.max(0.0001, input.interactionZoom ?? 1);
  const zoom = fitZoom * interactionZoom;
  const contentWidth = Math.max(1, input.bounds.right - input.bounds.left);
  const contentHeight = Math.max(1, input.bounds.bottom - input.bounds.top);
  const renderedWidth = contentWidth * zoom;
  const renderedHeight = contentHeight * zoom;
  const offsetX = input.mode === "circular"
    ? insets.left + (actualViewport.width - renderedWidth) / 2 - input.bounds.left * zoom
    : insets.left + padding - input.bounds.left * zoom;
  const offsetY = input.mode === "circular"
    ? insets.top + (actualViewport.height - renderedHeight) / 2 - input.bounds.top * zoom
    : insets.top + padding - input.bounds.top * zoom;
  const availableWidth = Math.max(1, actualViewport.width - padding * 2);
  const availableHeight = Math.max(1, actualViewport.height - padding * 2);
  const worldVisualPx = (preferredPx: number) => Math.max(0, preferredPx) / referenceFitScale;

  return {
    camera: { zoom, offsetX, offsetY },
    fitZoom,
    presentationScale,
    interactionZoom,
    usableViewport: actualViewport,
    overflow: {
      x: renderedWidth > availableWidth + 0.5,
      y: renderedHeight > availableHeight + 0.5,
    },
    worldVisualPx,
    screenVisualPx: (preferredPx) => worldVisualPx(preferredPx) * zoom,
    screenLength: (worldLength) => Math.max(0, worldLength) * zoom,
  };
}
