/**
 * Rendering uses one unit system: one graphic unit is one reference CSS pixel.
 * Layout values are expressed in graphic units; the camera is the only place
 * where they become device/display pixels.
 */
export type GraphicUnit = number;

export const MIN_DOCUMENT_SCALE = 0.0001;

export function normalizeScale(value: number | null | undefined, fallback = 1) {
  const candidate = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(MIN_DOCUMENT_SCALE, candidate);
}

export function screenPxToWorld(screenPx: number, documentScale: number): GraphicUnit {
  return Math.max(0, screenPx) / normalizeScale(documentScale);
}

export function worldToScreenPx(world: GraphicUnit, documentScale: number): number {
  return Math.max(0, world) * normalizeScale(documentScale);
}

export function sceneRevisionKey(parts: readonly unknown[]): string {
  return parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\u001f");
}

export interface SceneRevision {
  semantic: number;
  layout: number;
  frame: number;
}
