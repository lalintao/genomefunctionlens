import { CIRCULAR_HEATMAP_SHAPES, DEFAULT_PALETTE_ID, HEATMAP_COLOR_SCHEMES, PALETTES, RECTANGULAR_HEATMAP_SHAPES } from "./resultConstants";
import type { HeatmapBorderMode, HeatmapColorScale, HeatmapColorScales, HeatmapStyleRecord, PartitionShape, TreeViewMode } from "./resultTypes";
import { createHeatmapStyleId } from "./resultState";

const DEFAULT_STYLE_NAME = "默认样式";
const TREE_VIEW_MODES: TreeViewMode[] = ["rectangular", "circular"];
const DEFAULT_COLORS = HEATMAP_COLOR_SCHEMES.find((scheme) => scheme.id === DEFAULT_PALETTE_ID)?.colors
  ?? ["#FFFFFF", "#F8EAE1", "#FBE3D6", "#FAD4BF", "#F5AC8B", "#C6403D", "#A81428", "#780522"];
const DEFAULT_COUNT_UPPER_BOUNDS = [0, 5, 15, 30, 50, 75, 149] as const;
const DEFAULT_RATIO_UPPER_BOUNDS = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1] as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
export const HEATMAP_LEVEL_COUNT_OPTIONS = [4, 5, 6, 7, 8] as const;
export type HeatmapLevelCount = typeof HEATMAP_LEVEL_COUNT_OPTIONS[number];

function stops(bounds: readonly (number | null)[], colors: readonly string[] = DEFAULT_COLORS, exclusiveIndexes: readonly number[] = []): HeatmapColorScale {
  return { stops: bounds.map((upperBound, index) => ({ upperBound, ...(exclusiveIndexes.includes(index) ? { upperBoundExclusive: true } : {}), color: colors[index] ?? colors[colors.length - 1] })) };
}

export function defaultHeatmapColorScales(): HeatmapColorScales {
  return { count: stops([...DEFAULT_COUNT_UPPER_BOUNDS, null]), ratio: stops([...DEFAULT_RATIO_UPPER_BOUNDS, null], DEFAULT_COLORS, [6]) };
}

function normalizedLevelCount(levelCount: number): HeatmapLevelCount {
  if (!Number.isFinite(levelCount)) return 8;
  const rounded = Math.round(levelCount);
  return (HEATMAP_LEVEL_COUNT_OPTIONS.find((option) => option >= rounded) ?? 8) as HeatmapLevelCount;
}

export function heatmapLevelCount(scale: HeatmapColorScale): HeatmapLevelCount {
  return normalizedLevelCount(scale.stops.length);
}

function sampleEvenly<T>(values: readonly T[], count: number) {
  if (count <= 0 || !values.length) return [] as T[];
  if (count === 1) return [values[0]];
  return Array.from({ length: count }, (_, index) => values[Math.round(index * (values.length - 1) / (count - 1))]);
}

function parseHexColor(color: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function interpolateHexColor(start: string, end: string, fraction: number) {
  const startChannels = parseHexColor(start);
  const endChannels = parseHexColor(end);
  return `#${startChannels.map((channel, index) => Math.round(channel + (endChannels[index] - channel) * fraction).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function isNearWhite(color: string) {
  const [red, green, blue] = parseHexColor(color);
  return Math.min(red, green, blue) >= 232 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 28;
}

function paletteColorsForCount(colors: readonly string[], count: number) {
  if (count <= 0 || !colors.length) return [] as string[];
  const normalized = colors.map((color, index) => index === 0 && isNearWhite(color) ? "#FFFFFF" : color);
  if (normalized.length === count) return [...normalized];
  if (normalized.length > count) {
    const sampled = sampleEvenly(normalized, count);
    const whiteIndex = normalized.indexOf("#FFFFFF");
    if (whiteIndex >= 0 && !sampled.includes("#FFFFFF")) {
      const closestOutputIndex = Math.round(whiteIndex * (count - 1) / (normalized.length - 1));
      sampled[closestOutputIndex] = "#FFFFFF";
    }
    return sampled;
  }

  const sourcePositions = normalized.map((_, index) => Math.round(index * (count - 1) / (normalized.length - 1)));
  return Array.from({ length: count }, (_, index) => {
    const exactSourceIndex = sourcePositions.indexOf(index);
    if (exactSourceIndex >= 0) return normalized[exactSourceIndex];
    const upperSourceIndex = sourcePositions.findIndex((position) => position > index);
    const lowerSourceIndex = upperSourceIndex - 1;
    const lowerPosition = sourcePositions[lowerSourceIndex];
    const upperPosition = sourcePositions[upperSourceIndex];
    const fraction = (index - lowerPosition) / (upperPosition - lowerPosition);
    return interpolateHexColor(normalized[lowerSourceIndex], normalized[upperSourceIndex], fraction);
  });
}

function generatedScale(metric: "count" | "ratio", levelCount: HeatmapLevelCount, colors: readonly string[]): HeatmapColorScale {
  const bounds = metric === "count"
    ? [...sampleEvenly(DEFAULT_COUNT_UPPER_BOUNDS, levelCount - 1), null]
    : [...Array.from({ length: levelCount - 1 }, (_, index) => index / (levelCount - 2)), null];
  return stops(bounds, colors, metric === "ratio" ? [levelCount - 2] : []);
}

function colorsForLevelCount(scale: HeatmapColorScale, levelCount: HeatmapLevelCount) {
  return sampleEvenly(scale.stops.map((stop) => stop.color), levelCount);
}

export function heatmapColorScalesForLevelCount(scales: HeatmapColorScales, levelCount: number, paletteId?: string): HeatmapColorScales {
  const normalized = normalizedLevelCount(levelCount);
  const scheme = HEATMAP_COLOR_SCHEMES.find((candidate) => candidate.id === paletteId);
  const colorsForScale = (scale: HeatmapColorScale) => scheme
    ? paletteColorsForCount(scheme.colors, normalized)
    : colorsForLevelCount(scale, normalized);
  return {
    count: generatedScale("count", normalized, colorsForScale(scales.count)),
    ratio: generatedScale("ratio", normalized, colorsForScale(scales.ratio)),
  };
}

export function applyHeatmapColorScheme(scales: HeatmapColorScales, schemeId: string): HeatmapColorScales {
  const scheme = HEATMAP_COLOR_SCHEMES.find((candidate) => candidate.id === schemeId) ?? HEATMAP_COLOR_SCHEMES[0];
  const recolor = (scale: HeatmapColorScale): HeatmapColorScale => ({
    stops: scale.stops.map((stop, index) => ({
      ...stop,
      color: paletteColorsForCount(scheme.colors, scale.stops.length)[index],
    })),
  });
  return { count: recolor(scales.count), ratio: recolor(scales.ratio) };
}

function relativeLuminance(hexColor: string) {
  const weights = [0.2126, 0.7152, 0.0722];
  return [1, 3, 5].reduce((luminance, offset, index) => {
    const channel = Number.parseInt(hexColor.slice(offset, offset + 2), 16) / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return luminance + linear * weights[index];
  }, 0);
}

export function heatmapValueTextColor(cellColor: string) {
  if (!HEX_COLOR.test(cellColor)) return "#111111";
  const luminance = relativeLuminance(cellColor);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#111111" : "#FFFFFF";
}

function legacyColorScales(paletteId: string): HeatmapColorScales {
  const colors = HEATMAP_COLOR_SCHEMES.find((scheme) => scheme.id === paletteId)?.colors
    ?? PALETTES.find((palette) => palette.id === paletteId)?.colors
    ?? DEFAULT_COLORS;
  const legacyColors = paletteColorsForCount(colors, 8);
  return {
    count: stops([...DEFAULT_COUNT_UPPER_BOUNDS, null], legacyColors),
    ratio: stops([...DEFAULT_RATIO_UPPER_BOUNDS, null], legacyColors, [6]),
  };
}

export function normalizeHeatmapColorScale(scale: HeatmapColorScale, fallback: HeatmapColorScale): HeatmapColorScale {
  const source = scale?.stops ?? fallback.stops;
  const normalized = source
    .map((stop) => ({
      upperBound: stop.upperBound === null ? null : Number(stop.upperBound),
      ...(stop.upperBoundExclusive ? { upperBoundExclusive: true } : {}),
      color: typeof stop.color === "string" && HEX_COLOR.test(stop.color.trim()) ? stop.color.trim().toUpperCase() : "",
    }))
    .filter((stop) => stop.upperBound === null || Number.isFinite(stop.upperBound))
    .filter((stop) => stop.color)
    .slice(0, 10);
  if (normalized.length < 2 || normalized[normalized.length - 1]?.upperBound !== null) return fallback;
  const bounded = normalized.slice(0, -1);
  if (bounded.some((stop, index) => stop.upperBound === null || (index > 0 && stop.upperBound <= (bounded[index - 1].upperBound ?? -Infinity)))) return fallback;
  return { stops: normalized };
}

export function colorScalesForStyle(style: Pick<HeatmapStyleRecord, "paletteId" | "colorScales">): HeatmapColorScales {
  const fallback = defaultHeatmapColorScales();
  const legacy = legacyColorScales(style.paletteId);
  if (!style.colorScales) return legacy;
  return {
    count: normalizeHeatmapColorScale(style.colorScales.count, fallback.count),
    ratio: normalizeHeatmapColorScale(style.colorScales.ratio, fallback.ratio),
  };
}

export function colorForHeatmapValue(value: number, scale: HeatmapColorScale) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return scale.stops.find((stop) => stop.upperBound === null || safeValue < stop.upperBound || (!stop.upperBoundExclusive && safeValue === stop.upperBound))?.color
    ?? scale.stops[scale.stops.length - 1]?.color
    ?? DEFAULT_COLORS[DEFAULT_COLORS.length - 1];
}

export function defaultStyleIdForTreeMode(mode: TreeViewMode) {
  return `default-${mode}`;
}

export function defaultShapeForTreeMode(_mode: TreeViewMode): PartitionShape {
  return "fill";
}

export function normalizeHeatmapBorderMode(mode: HeatmapBorderMode | undefined): HeatmapBorderMode {
  return mode === "outer" || mode === "inner" ? mode : "none";
}

export function shapeForTreeMode(shape: PartitionShape | undefined, mode: TreeViewMode): PartitionShape {
  if (mode === "rectangular") return shape === "circle" || shape === "square" || shape === "fill" ? shape : "square";
  return shape === "circle" || shape === "fill" ? shape : "fill";
}

export function defaultHeatmapStyle(mode: TreeViewMode) {
  return {
    paletteId: DEFAULT_PALETTE_ID,
    shape: defaultShapeForTreeMode(mode),
  };
}

export function createDefaultHeatmapStyleRecord(mode: TreeViewMode): HeatmapStyleRecord {
  const style = defaultHeatmapStyle(mode);
  return {
    id: defaultStyleIdForTreeMode(mode),
    role: "default",
    treeViewMode: mode,
    paletteId: style.paletteId,
    colorScales: defaultHeatmapColorScales(),
    shape: style.shape,
    borderMode: "outer",
    name: DEFAULT_STYLE_NAME,
    leafCellKeys: [],
  };
}

export function ensureDefaultHeatmapStyles(styles: HeatmapStyleRecord[]) {
  const normalized = styles.map((style) => style.borderMode
    ? style
    : { ...style, borderMode: normalizeHeatmapBorderMode(style.borderMode) });
  return TREE_VIEW_MODES.reduce((next, mode) => {
    const hasDefault = next.some((style) => style.role === "default" && style.treeViewMode === mode);
    return hasDefault ? next : [createDefaultHeatmapStyleRecord(mode), ...next];
  }, normalized);
}

export function resetHeatmapStylesForMode(styles: HeatmapStyleRecord[], mode: TreeViewMode) {
  return ensureDefaultHeatmapStyles(styles)
    .filter((style) => style.treeViewMode !== mode || style.role === "default")
    .map((style) => style.treeViewMode === mode && style.role === "default" ? createDefaultHeatmapStyleRecord(mode) : style);
}

export function heatmapStylesForMode(styles: HeatmapStyleRecord[], mode: TreeViewMode) {
  return ensureDefaultHeatmapStyles(styles).filter((style) => style.treeViewMode === mode && (style.role === "default" || style.leafCellKeys.length));
}

/** Rectangular column geometry is shared by the whole grid, not per cell. */
export function rectangularHeatmapUsesSquareCells(styles: HeatmapStyleRecord[]) {
  return heatmapStylesForMode(styles, "rectangular")
    .some((style) => style.shape === "square" || style.shape === "circle");
}

export function effectiveRectangularHeatmapColumnWidth(
  styles: HeatmapStyleRecord[],
  rowHeight: number,
  configuredWidth: number,
) {
  return rectangularHeatmapUsesSquareCells(styles) ? rowHeight : configuredWidth;
}

export function defaultHeatmapStyleForMode(styles: HeatmapStyleRecord[], mode: TreeViewMode) {
  return heatmapStylesForMode(styles, mode).find((style) => style.role === "default") ?? createDefaultHeatmapStyleRecord(mode);
}

function firstUnusedStyleAppearance(styles: HeatmapStyleRecord[], mode: TreeViewMode) {
  const shapeOptions = mode === "rectangular" ? RECTANGULAR_HEATMAP_SHAPES : CIRCULAR_HEATMAP_SHAPES;
  const used = new Set(heatmapStylesForMode(styles, mode).map((style) => `${style.paletteId}::${style.shape}`));
  for (const palette of PALETTES) {
    for (const shape of shapeOptions) {
      if (!used.has(`${palette.id}::${shape.value}`)) return { paletteId: palette.id, shape: shape.value };
    }
  }
  return defaultHeatmapStyle(mode);
}

function mergeStylesByAppearance(styles: HeatmapStyleRecord[]) {
  const merged: HeatmapStyleRecord[] = [];
  const indexByAppearance = new Map<string, number>();
  styles.forEach((style) => {
    if (style.role === "selection" && !style.leafCellKeys.length) return;
    if (style.role === "default") {
      merged.push({ ...style, leafCellKeys: [] });
      return;
    }
    const key = styleAppearanceKey(style);
    const existingIndex = indexByAppearance.get(key);
    if (existingIndex === undefined) {
      indexByAppearance.set(key, merged.length);
      const uniqueLeafKeys = new Set(style.leafCellKeys);
      merged.push({ ...style, leafCellKeys: uniqueLeafKeys.size === style.leafCellKeys.length ? style.leafCellKeys : Array.from(uniqueLeafKeys) });
      return;
    }
    const existing = merged[existingIndex];
    const leafCellKeys = new Set(existing.leafCellKeys);
    style.leafCellKeys.forEach((key) => leafCellKeys.add(key));
    merged[existingIndex] = {
      ...existing,
      name: existing.name || style.name,
      leafCellKeys: Array.from(leafCellKeys),
    };
  });
  return ensureDefaultHeatmapStyles(merged);
}

function styleAppearanceKey(style: HeatmapStyleRecord) {
  return `${style.role}::${style.treeViewMode}::${JSON.stringify(colorScalesForStyle(style))}::${style.shape}::${normalizeHeatmapBorderMode(style.borderMode)}`;
}

export function updateHeatmapStyle(
  styles: HeatmapStyleRecord[],
  styleId: string,
  patch: Partial<Pick<HeatmapStyleRecord, "paletteId" | "colorScales" | "shape" | "borderMode" | "name">>,
) {
  const normalized = ensureDefaultHeatmapStyles(styles);
  const target = normalized.find((style) => style.id === styleId);
  if (!target) return styles;
  const nextTarget = {
    ...target,
    ...patch,
    shape: patch.shape ? shapeForTreeMode(patch.shape, target.treeViewMode) : target.shape,
  };
  if (styleAppearanceKey(target) === styleAppearanceKey(nextTarget)) {
    // A name-only edit does not change cell resolution or appearance. Keep the
    // other style records and their large leaf-key arrays shared.
    if (target.name === nextTarget.name) return styles;
    return normalized.map((style) => style.id === styleId ? nextTarget : style);
  }

  // Most edits do not collide with another appearance. Avoid rebuilding and
  // de-duplicating every style's leaf-key array in that common case.
  const collision = normalized.some((style) => style.id !== styleId && styleAppearanceKey(style) === styleAppearanceKey(nextTarget));
  const replaced = normalized.map((style) => style.id === styleId ? nextTarget : style);
  return collision ? mergeStylesByAppearance(replaced) : replaced;
}

export function removeHeatmapStyle(styles: HeatmapStyleRecord[], styleId: string) {
  const target = styles.find((style) => style.id === styleId);
  if (!target || target.role === "default") return styles;
  return ensureDefaultHeatmapStyles(styles.filter((style) => style.id !== styleId));
}

export function removeHeatmapColumnStyles(styles: HeatmapStyleRecord[], columnKey: string) {
  const suffix = `::${columnKey}`;
  let changed = false;
  const next = styles.map((style) => {
    if (!style.leafCellKeys.length) return style;
    const leafCellKeys = style.leafCellKeys.filter((key) => !key.endsWith(suffix));
    if (leafCellKeys.length === style.leafCellKeys.length) return style;
    changed = true;
    return { ...style, leafCellKeys };
  }).filter((style) => style.role === "default" || style.leafCellKeys.length);
  return changed ? next : styles;
}

export function createStyleFromLeafKeys(input: {
  styles: HeatmapStyleRecord[];
  treeViewMode: TreeViewMode;
  leafCellKeys: string[];
  paletteId?: string;
  colorScales?: HeatmapColorScales;
  shape?: PartitionShape;
  name?: string;
}) {
  const uniqueLeafKeys = Array.from(new Set(input.leafCellKeys));
  if (!uniqueLeafKeys.length) return input.styles;
  const selectedSet = new Set(uniqueLeafKeys);
  const base = input.paletteId && input.shape
    ? { paletteId: input.paletteId, shape: shapeForTreeMode(input.shape, input.treeViewMode) }
    : firstUnusedStyleAppearance(ensureDefaultHeatmapStyles(input.styles), input.treeViewMode);
  const cleaned = ensureDefaultHeatmapStyles(input.styles)
    .map((style) =>
      style.role === "selection" && style.treeViewMode === input.treeViewMode
        ? { ...style, leafCellKeys: style.leafCellKeys.filter((key) => !selectedSet.has(key)) }
        : style,
    )
    .filter((style) => style.leafCellKeys.length);
  return mergeStylesByAppearance([
    ...cleaned,
    {
      id: createHeatmapStyleId(),
      role: "selection",
      treeViewMode: input.treeViewMode,
      paletteId: base.paletteId,
      colorScales: input.colorScales ?? colorScalesForStyle({ paletteId: base.paletteId, colorScales: undefined }),
      shape: base.shape,
      borderMode: "none",
      name: input.name ?? "",
      leafCellKeys: uniqueLeafKeys,
    },
  ]);
}

export function buildLeafStyleMap(styles: HeatmapStyleRecord[], mode: TreeViewMode) {
  const map = new Map<string, HeatmapStyleRecord>();
  heatmapStylesForMode(styles, mode).forEach((style) => {
    if (style.role !== "selection") return;
    style.leafCellKeys.forEach((key) => map.set(key, style));
  });
  return map;
}
