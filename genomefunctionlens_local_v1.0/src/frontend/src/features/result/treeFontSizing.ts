import { DEFAULT_HEATMAP_VALUE_TO_BRANCH_LABEL_RATIO } from "./resultVisualConstants";
import { VISUAL_SLOT_FILL } from "./visualScaleResolver";

export interface CircularFontGeometry {
  arcRadians: number;
  terminalCount: number;
  treeOuterRadius: number;
  /** Radius where terminal labels are actually painted, after radial gaps. */
  branchLabelRadius?: number;
  speciesCountRadius: number;
}

export function rectangularBranchNameFontLimit(rowHeight: number) {
  return Math.max(1, Math.floor(rowHeight * VISUAL_SLOT_FILL));
}

export function heatmapColumnLabelFontLimit(columnWidth: number) {
  return Math.max(1, Math.floor(columnWidth * VISUAL_SLOT_FILL));
}

export function defaultHeatmapValueFontSize(branchNameFontSize: number) {
  return Math.max(1, branchNameFontSize * DEFAULT_HEATMAP_VALUE_TO_BRANCH_LABEL_RATIO);
}

export function circularArcSlotHeight(radius: number, arcRadians: number, terminalCount: number) {
  const safeRadius = Math.max(1, radius);
  const slotAngle = Math.max(0, arcRadians) / Math.max(1, terminalCount);
  return Math.max(1, Math.floor(2 * safeRadius * Math.sin(Math.min(Math.PI, slotAngle) / 2)));
}

export function circularFontLimits(geometry: CircularFontGeometry) {
  return {
    branchName: Math.max(1, Math.floor(circularArcSlotHeight(geometry.branchLabelRadius ?? geometry.treeOuterRadius, geometry.arcRadians, geometry.terminalCount) * VISUAL_SLOT_FILL)),
    speciesCount: Math.max(1, Math.floor(circularArcSlotHeight(geometry.speciesCountRadius, geometry.arcRadians, geometry.terminalCount) * VISUAL_SLOT_FILL)),
  };
}

export function fontSizeAfterLimitChange(current: number, previousLimit: number, nextLimit: number) {
  const safeNextLimit = Math.max(1, Math.floor(nextLimit));
  if (current >= previousLimit) return safeNextLimit;
  return Math.min(Math.max(1, current), safeNextLimit);
}

export function defaultStripLabelFontSize(_mode: "rectangular" | "circular", branchNameFontSize: number) {
  return Math.max(1, Math.floor(branchNameFontSize));
}

export function defaultSpeciesCountFontSize(branchNameFontSize: number, speciesCountLimit: number) {
  return Math.max(1, Math.min(Math.floor(branchNameFontSize), Math.floor(speciesCountLimit)));
}
