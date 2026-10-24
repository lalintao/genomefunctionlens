export const VISUAL_SLOT_FILL = 0.95;

import { screenPxToWorld as contractScreenPxToWorld, worldToScreenPx as contractWorldToScreenPx } from "./rendering/renderContracts";

export interface ResolvedVisualSize {
  preferredPx: number;
  maxPx: number;
  effectivePx: number;
  world: number;
}

export function screenPxToWorld(screenPx: number, documentScale: number) {
  return contractScreenPxToWorld(screenPx, documentScale);
}

export function worldToScreenPx(worldSize: number, documentScale: number) {
  return contractWorldToScreenPx(worldSize, documentScale);
}

export function dynamicVisualMaxPx(availableWorldSize: number, documentScale: number, fill = VISUAL_SLOT_FILL) {
  const availablePx = worldToScreenPx(availableWorldSize, documentScale);
  return Math.max(1, Math.floor(availablePx * Math.max(0, fill)));
}

export function resolveVisualSize(
  preferredPx: number,
  availableWorldSize: number,
  documentScale: number,
  fill = VISUAL_SLOT_FILL,
): ResolvedVisualSize {
  const normalizedPreferredPx = Math.max(1, preferredPx);
  const maxPx = dynamicVisualMaxPx(availableWorldSize, documentScale, fill);
  const effectivePx = Math.min(normalizedPreferredPx, maxPx);
  return {
    preferredPx: normalizedPreferredPx,
    maxPx,
    effectivePx,
    world: screenPxToWorld(effectivePx, documentScale),
  };
}

export function resolveScreenLockedWorldLength(preferredPx: number, documentScale: number) {
  return screenPxToWorld(Math.max(0, preferredPx), documentScale);
}

export function resolveRectangularColumnWidthWorld(input: {
  preferredPx: number;
  documentScale: number;
  rowHeightWorld: number;
  shapeLocked: boolean;
  maxPx?: number;
}) {
  if (input.shapeLocked) return Math.max(1, input.rowHeightWorld);
  const effectivePx = Math.min(Math.max(1, input.preferredPx), input.maxPx ?? Number.POSITIVE_INFINITY);
  return resolveScreenLockedWorldLength(effectivePx, input.documentScale);
}

