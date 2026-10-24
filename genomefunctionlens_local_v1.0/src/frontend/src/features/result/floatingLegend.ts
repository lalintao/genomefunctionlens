import type { HeatmapLegendState } from "./resultTypes";
import { svgTextAttributes } from "./resultTypography";

export const FLOATING_LEGEND_TITLE_FONT_SIZE = 18;
export const FLOATING_LEGEND_ITEM_FONT_SIZE = 14;

interface FloatingLegendCamera {
  zoom: number;
  offset: { x: number; y: number };
}

export type FloatingLegendExportCamera = FloatingLegendCamera;

interface FloatingLegendViewport {
  width: number;
  height: number;
}

export type FloatingLegendInteractionMode = "move" | "resize-n" | "resize-e" | "resize-s" | "resize-w";

export interface FloatingLegendInteractionDraft {
  mode: FloatingLegendInteractionMode;
  pointerId: number;
  startX: number;
  startY: number;
  startZoom: number;
  startSizeScale: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
}

export interface FloatingLegendSvgItem {
  label: string;
  color: string;
  marker: "swatch" | "fill" | "circle" | "square" | "triangle";
}

export function closeFloatingLegend(state: HeatmapLegendState | null): HeatmapLegendState | null {
  return state?.open ? { ...state, open: false } : state;
}

interface FloatingLegendSvgInput {
  id: string;
  state: HeatmapLegendState;
  title: string;
  items: FloatingLegendSvgItem[];
  viewport: FloatingLegendViewport;
  fontFamily: string;
  /** Font size in the same coordinate space as the exported SVG. */
  itemFontSize?: number;
  x?: number;
  y?: number;
  margin?: number;
  presentationScale?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function rebaseFloatingLegendToCamera(
  state: HeatmapLegendState,
  before: FloatingLegendCamera,
  after: FloatingLegendCamera,
  viewport: FloatingLegendViewport,
  margin = 24,
  sizeScale = 1,
): HeatmapLegendState {
  const beforeZoom = Math.max(0.01, before.zoom);
  const afterZoom = Math.max(0.01, after.zoom);
  const previousScreenX = before.offset.x + state.x * beforeZoom;
  const previousScreenY = before.offset.y + state.y * beforeZoom;
  const safeSizeScale = Math.max(0.01, sizeScale);
  const maxScreenX = Math.max(margin, viewport.width - state.width * safeSizeScale - margin);
  const maxScreenY = Math.max(margin, viewport.height - state.height * safeSizeScale - margin);
  const screenX = clamp(previousScreenX, margin, maxScreenX);
  const screenY = clamp(previousScreenY, margin, maxScreenY);

  return {
    ...state,
    x: (screenX - after.offset.x) / afterZoom,
    y: (screenY - after.offset.y) / afterZoom,
  };
}

export function floatingLegendExportLayout(
  state: HeatmapLegendState,
  viewport: FloatingLegendViewport,
  coordinateSpace: "world" | "screen",
  cameras: {
    sourceCamera?: FloatingLegendExportCamera;
    targetCamera: FloatingLegendExportCamera;
  },
) {
  const targetCamera = cameras.targetCamera;
  const targetZoom = Math.max(0.01, targetCamera.zoom);
  if (coordinateSpace === "world") {
    return {
      state,
      x: state.x,
      y: state.y,
      presentationScale: 1,
    };
  }

  const sourceCamera = cameras.sourceCamera ?? targetCamera;
  const exportState = rebaseFloatingLegendToCamera(
    state,
    sourceCamera,
    targetCamera,
    viewport,
    24,
    targetZoom,
  );
  return {
    state: exportState,
    x: targetCamera.offset.x + exportState.x * targetZoom,
    y: targetCamera.offset.y + exportState.y * targetZoom,
    presentationScale: targetZoom,
  };
}

export function updateFloatingLegendInteraction(
  state: HeatmapLegendState,
  draft: FloatingLegendInteractionDraft,
  clientX: number,
  clientY: number,
  minWidth = 220,
  minHeight = 96,
): HeatmapLegendState {
  const screenDx = clientX - draft.startX;
  const screenDy = clientY - draft.startY;
  const zoom = Math.max(0.01, draft.startZoom);
  const sizeScale = Math.max(0.01, draft.startSizeScale);
  if (draft.mode === "move") {
    return { ...state, x: draft.originX + screenDx / zoom, y: draft.originY + screenDy / zoom };
  }
  if (draft.mode === "resize-e") {
    return { ...state, width: Math.max(minWidth, draft.originWidth + screenDx / sizeScale) };
  }
  if (draft.mode === "resize-s") {
    return { ...state, height: Math.max(minHeight, draft.originHeight + screenDy / sizeScale) };
  }
  if (draft.mode === "resize-w") {
    const width = Math.max(minWidth, draft.originWidth - screenDx / sizeScale);
    return { ...state, x: draft.originX + (draft.originWidth - width) * sizeScale / zoom, width };
  }
  const height = Math.max(minHeight, draft.originHeight - screenDy / sizeScale);
  return { ...state, y: draft.originY + (draft.originHeight - height) * sizeScale / zoom, height };
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgMarker(item: FloatingLegendSvgItem, x: number, y: number, swatchSize = 16) {
  const fill = escapeSvg(item.color);
  if (item.marker === "swatch") return `<rect x="${x}" y="${y}" width="${swatchSize}" height="${swatchSize}" fill="${fill}" stroke="rgba(17,17,15,0.28)" stroke-width="1"/>`;
  const marker = item.marker === "fill"
    ? `<path d="M5 26 A12 12 0 0 1 27 8 L16 16 Z" fill="${fill}" stroke="rgba(17,17,17,0.38)" stroke-width="1.4"/>`
    : item.marker === "circle"
      ? `<circle cx="16" cy="16" r="9.5" fill="${fill}" stroke="rgba(17,17,17,0.38)" stroke-width="1.4"/>`
      : item.marker === "triangle"
        ? `<path d="M16 5 L27 26 H5 Z" fill="${fill}" stroke="rgba(17,17,17,0.38)" stroke-width="1.4"/>`
        : `<rect x="7" y="7" width="18" height="18" rx="2.5" fill="${fill}" stroke="rgba(17,17,17,0.38)" stroke-width="1.4"/>`;
  return `<g transform="translate(${x} ${y}) scale(0.875)">${marker}</g>`;
}

export function floatingLegendSvgMarkup(input: FloatingLegendSvgInput) {
  if (!input.state.open) return "";
  const margin = input.margin ?? 24;
  const presentationScale = Math.max(0.01, input.presentationScale ?? 1);
  const itemFontSize = Math.max(1, input.itemFontSize ?? FLOATING_LEGEND_ITEM_FONT_SIZE);
  const swatchSize = Math.max(16, Math.round(itemFontSize * 0.7));
  const maxMarkerSize = input.items.some((item) => item.marker !== "swatch") ? 28 : swatchSize;
  const itemRowHeight = Math.max(30, maxMarkerSize + 10, Math.ceil(itemFontSize * 1.35));
  const width = input.state.width;
  const height = input.state.height;
  const x = clamp(input.x ?? input.state.x, margin, Math.max(margin, input.viewport.width - width * presentationScale - margin));
  const y = clamp(input.y ?? input.state.y, margin, Math.max(margin, input.viewport.height - height * presentationScale - margin));
  const clipId = `floating-legend-${input.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const right = width - 18;
  let cursorX = 18;
  let cursorY = Math.max(54 + Math.ceil((maxMarkerSize - 18) / 2), 46 + Math.ceil(itemFontSize * 0.8));
  const records: string[] = [];
  input.items.forEach((item) => {
    const markerSize = item.marker === "swatch" ? swatchSize : 28;
    const itemWidth = markerSize + 8 + Math.max(28, item.label.length * itemFontSize * 0.58);
    if (cursorX > 18 && cursorX + itemWidth > right) {
      cursorX = 18;
      cursorY += itemRowHeight;
    }
    const markerY = cursorY - 5 - markerSize / 2;
    records.push(
      `${svgMarker(item, cursorX, markerY, markerSize)}<text x="${cursorX + markerSize + 8}" y="${cursorY}" ${svgTextAttributes("legendItem", itemFontSize)} fill="#11110f">${escapeSvg(item.label)}</text>`,
    );
    cursorX += itemWidth + 18;
  });
  return [
    `<g data-floating-legend="${escapeSvg(input.id)}" transform="translate(${x} ${y}) scale(${presentationScale})" font-family="${escapeSvg(input.fontFamily)}">`,
    `<defs><clipPath id="${clipId}"><rect width="${width}" height="${height}" rx="2"/></clipPath></defs>`,
    `<rect width="${width}" height="${height}" rx="2" fill="#fff" fill-opacity="0.94" stroke="#11110f" stroke-width="${1.5 / presentationScale}"/>`,
    `<g clip-path="url(#${clipId})">`,
    `<text x="18" y="31" ${svgTextAttributes("legendTitle", itemFontSize)} fill="#11110f">${escapeSvg(input.title)}</text>`,
    ...records,
    "</g></g>",
  ].join("");
}
