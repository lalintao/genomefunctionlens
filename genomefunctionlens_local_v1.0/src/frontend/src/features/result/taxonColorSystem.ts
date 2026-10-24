import { TAXON_COLOR_SOURCE } from "./taxonColorPalette";
import { immutableMap } from "../../shared/immutableCollections";

export const TAXON_COLOR_SECTOR_IDS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;

export type TaxonColorSectorId = typeof TAXON_COLOR_SECTOR_IDS[number];

export interface TaxonColorSector {
  readonly id: TaxonColorSectorId;
  readonly colors: readonly string[];
}

export interface TaxonColorAssignment {
  readonly color: string;
  readonly sector: TaxonColorSectorId;
  readonly sectorIndex: number;
}

export interface TaxonColorGroup {
  readonly label: string;
  readonly nodeIds: readonly number[];
}

export interface TaxonColorPlan<Group extends TaxonColorGroup = TaxonColorGroup> {
  readonly groups: readonly Group[];
  readonly assignments: ReadonlyMap<string, TaxonColorAssignment>;
}

export type TaxonColorRole = "legend" | "strip" | "background";

interface OklchColor {
  lightness: number;
  chroma: number;
  hue: number;
}

const COLORS_PER_SECTOR = 24;
const SECTOR_CENTERS = [0, 60, 120, 180, 240, 300] as const;

function srgbToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number) {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function hexToOklch(hex: string): OklchColor {
  const red = srgbToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const green = srgbToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = srgbToLinear(Number.parseInt(hex.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness,
    chroma: Math.hypot(a, b),
    hue: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360,
  };
}

function isNearWhite(color: OklchColor) {
  return color.lightness >= 0.93 && color.chroma < 0.05;
}

const uniqueSourceColors = Array.from(new Set<string>(TAXON_COLOR_SOURCE));

export const REMOVED_LIGHT_TAXON_COLORS = Object.freeze(
  uniqueSourceColors.filter((color) => isNearWhite(hexToOklch(color))),
);

export const TAXON_COLOR_SEEDS = Object.freeze(
  uniqueSourceColors.filter((color) => !isNearWhite(hexToOklch(color))),
);

function linearRgb(color: OklchColor) {
  const radians = color.hue * Math.PI / 180;
  const a = color.chroma * Math.cos(radians);
  const b = color.chroma * Math.sin(radians);
  const l = (color.lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (color.lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (color.lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inSrgbGamut(channels: readonly number[]) {
  return channels.every((channel) => channel >= 0 && channel <= 1);
}

function oklchToHex(color: OklchColor) {
  let low = 0;
  let high = color.chroma;
  let channels = linearRgb(color);
  if (!inSrgbGamut(channels)) {
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const chroma = (low + high) / 2;
      const candidate = linearRgb({ ...color, chroma });
      if (inSrgbGamut(candidate)) {
        low = chroma;
        channels = candidate;
      } else {
        high = chroma;
      }
    }
  }
  return `#${channels.map((channel) => Math.round(Math.max(0, Math.min(1, linearToSrgb(channel))) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function sectorIndexForHue(hue: number) {
  if (hue < 30 || hue >= 330) return 0;
  return Math.floor((hue - 30) / 60) + 1;
}

function oklabDistance(left: OklchColor, right: OklchColor) {
  const leftRadians = left.hue * Math.PI / 180;
  const rightRadians = right.hue * Math.PI / 180;
  const deltaLightness = left.lightness - right.lightness;
  const deltaA = left.chroma * Math.cos(leftRadians) - right.chroma * Math.cos(rightRadians);
  const deltaB = left.chroma * Math.sin(leftRadians) - right.chroma * Math.sin(rightRadians);
  return Math.hypot(deltaLightness, deltaA, deltaB);
}

function generatedCandidates(sectorIndex: number) {
  const sourceTones = TAXON_COLOR_SEEDS.map(hexToOklch).sort((left, right) => (
    left.lightness - right.lightness || left.chroma - right.chroma || left.hue - right.hue
  ));
  const tones = Array.from({ length: 18 }, (_, index) => (
    sourceTones[Math.round(index * (sourceTones.length - 1) / 17)]
  ));
  const variants = [
    { lightnessOffset: 0, chromaScale: 1 },
    { lightnessOffset: -0.015, chromaScale: 1.05 },
    { lightnessOffset: 0.015, chromaScale: 0.95 },
  ] as const;
  const candidates = new Map<string, OklchColor>();
  tones.forEach((tone) => {
    variants.forEach((variant) => {
      for (let hueStep = -27; hueStep <= 27; hueStep += 3) {
        const requested = {
          lightness: Math.max(0.35, Math.min(0.92, tone.lightness + variant.lightnessOffset)),
          chroma: Math.max(0.045, tone.chroma * variant.chromaScale),
          hue: (SECTOR_CENTERS[sectorIndex] + hueStep + 360) % 360,
        };
        const hex = oklchToHex(requested);
        const actual = hexToOklch(hex);
        if (!isNearWhite(actual) && sectorIndexForHue(actual.hue) === sectorIndex) candidates.set(hex, actual);
      }
    });
  });
  return candidates;
}

function buildColorWheel(): readonly TaxonColorSector[] {
  const sectors = Array.from({ length: TAXON_COLOR_SECTOR_IDS.length }, () => [] as string[]);
  TAXON_COLOR_SEEDS.forEach((color) => sectors[sectorIndexForHue(hexToOklch(color).hue)].push(color));
  const used = new Set<string>(TAXON_COLOR_SEEDS);

  sectors.forEach((colors, sectorIndex) => {
    const candidates = generatedCandidates(sectorIndex);
    while (colors.length < COLORS_PER_SECTOR) {
      const existing = colors.map(hexToOklch);
      const ranked = Array.from(candidates, ([color, metrics]) => ({
        color,
        metrics,
        distance: Math.min(...existing.map((current) => oklabDistance(metrics, current))),
      })).filter((candidate) => !used.has(candidate.color))
        .sort((left, right) => right.distance - left.distance || left.color.localeCompare(right.color));
      const selected = ranked[0];
      if (!selected || selected.distance < 0.018) {
        throw new Error(`Unable to fill taxon color sector ${TAXON_COLOR_SECTOR_IDS[sectorIndex]} with perceptually distinct colors.`);
      }
      candidates.delete(selected.color);
      used.add(selected.color);
      colors.push(selected.color);
    }
  });

  return Object.freeze(sectors.map((colors, index) => Object.freeze({
    id: TAXON_COLOR_SECTOR_IDS[index],
    colors: Object.freeze(colors),
  })));
}

export const TAXON_COLOR_WHEEL = buildColorWheel();

function adjacencyGraph(labels: readonly string[]) {
  const graph = new Map<string, Set<string>>();
  labels.forEach((label) => {
    if (!graph.has(label)) graph.set(label, new Set());
  });
  const connect = (left: string, right: string) => {
    if (left === right) return;
    graph.get(left)?.add(right);
    graph.get(right)?.add(left);
  };
  labels.slice(1).forEach((label, index) => connect(labels[index], label));
  if (labels.length > 2) connect(labels[0], labels[labels.length - 1]);
  return graph;
}

function exactSectorAssignment(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  firstIndex: ReadonlyMap<string, number>,
  order: readonly string[],
) {
  const sectorByLabel = new Map<string, number>();
  const sectorUsage = Array.from({ length: TAXON_COLOR_SECTOR_IDS.length }, () => 0);
  const candidatesFor = (label: string) => {
    const unavailable = new Set(Array.from(graph.get(label) ?? [], (neighbor) => sectorByLabel.get(neighbor)).filter((sector): sector is number => sector !== undefined));
    const preferred = (firstIndex.get(label) ?? 0) % TAXON_COLOR_SECTOR_IDS.length;
    return Array.from(
      { length: TAXON_COLOR_SECTOR_IDS.length },
      (_, offset) => (preferred + offset) % TAXON_COLOR_SECTOR_IDS.length,
    ).filter((sector) => !unavailable.has(sector))
      .sort((left, right) => sectorUsage[left] - sectorUsage[right]);
  };
  interface SearchFrame {
    label: string;
    candidates: number[];
    nextCandidate: number;
    assignedSector: number | null;
  }
  const stack: SearchFrame[] = [];
  const pushNextFrame = () => {
    const label = order[stack.length];
    stack.push({ label, candidates: candidatesFor(label), nextCandidate: 0, assignedSector: null });
  };
  pushNextFrame();
  let searchSteps = 0;
  const maximumSearchSteps = Math.max(250_000, graph.size * 200);
  while (stack.length && searchSteps < maximumSearchSteps) {
    const frame = stack[stack.length - 1];
    if (frame.assignedSector !== null) {
      sectorUsage[frame.assignedSector] -= 1;
      sectorByLabel.delete(frame.label);
      frame.assignedSector = null;
    }
    if (frame.nextCandidate >= frame.candidates.length) {
      stack.pop();
      continue;
    }
    const sector = frame.candidates[frame.nextCandidate];
    frame.nextCandidate += 1;
    frame.assignedSector = sector;
    sectorByLabel.set(frame.label, sector);
    sectorUsage[sector] += 1;
    searchSteps += 1;
    if (sectorByLabel.size === graph.size) return sectorByLabel;
    pushNextFrame();
  }
  return null;
}

function hasSectorCollision(graph: ReadonlyMap<string, ReadonlySet<string>>, sectorByLabel: ReadonlyMap<string, number>) {
  return Array.from(graph).some(([label, neighbors]) => Array.from(neighbors).some(
    (neighbor) => sectorByLabel.get(label) === sectorByLabel.get(neighbor),
  ));
}

function assignSectors(labels: readonly string[]) {
  const firstIndex = new Map<string, number>();
  labels.forEach((label, index) => {
    if (!firstIndex.has(label)) firstIndex.set(label, index);
  });
  const graph = adjacencyGraph(labels);
  const sectorByLabel = new Map<string, number>();
  const order = Array.from(graph.keys()).sort((left, right) => {
    const degreeDifference = (graph.get(right)?.size ?? 0) - (graph.get(left)?.size ?? 0);
    return degreeDifference || (firstIndex.get(left) ?? 0) - (firstIndex.get(right) ?? 0) || left.localeCompare(right);
  });
  const sectorUsage = Array.from({ length: TAXON_COLOR_SECTOR_IDS.length }, () => 0);
  order.forEach((label) => {
    const neighborSectorCounts = Array.from({ length: TAXON_COLOR_SECTOR_IDS.length }, () => 0);
    graph.get(label)?.forEach((neighbor) => {
      const sectorIndex = sectorByLabel.get(neighbor);
      if (sectorIndex !== undefined) neighborSectorCounts[sectorIndex] += 1;
    });
    const preferred = (firstIndex.get(label) ?? 0) % TAXON_COLOR_SECTOR_IDS.length;
    const candidates = Array.from({ length: TAXON_COLOR_SECTOR_IDS.length }, (_, offset) => (preferred + offset) % TAXON_COLOR_SECTOR_IDS.length);
    const sectorIndex = candidates.find((candidate) => neighborSectorCounts[candidate] === 0)
      ?? [...candidates].sort((left, right) => neighborSectorCounts[left] - neighborSectorCounts[right] || sectorUsage[left] - sectorUsage[right])[0];
    sectorByLabel.set(label, sectorIndex);
    sectorUsage[sectorIndex] += 1;
  });
  if (hasSectorCollision(graph, sectorByLabel)) {
    const exactAssignment = exactSectorAssignment(graph, firstIndex, order);
    if (!exactAssignment) throw new Error("Taxon adjacency could not be compiled into six sectors without a collision.");
    return exactAssignment;
  }
  return sectorByLabel;
}

export function assignTaxonColors(orderedLabels: readonly string[]): ReadonlyMap<string, TaxonColorAssignment> {
  const labels = orderedLabels.filter((label) => Boolean(label.trim()));
  if (!labels.length) return immutableMap([]);
  const sectorByLabel = assignSectors(labels);
  const sectorUseCounts = Array.from({ length: TAXON_COLOR_WHEEL.length }, () => 0);
  const assignments: Array<readonly [string, TaxonColorAssignment]> = [];
  const assignedLabels = new Set<string>();
  labels.forEach((label) => {
    if (assignedLabels.has(label)) return;
    assignedLabels.add(label);
    const sectorIndex = sectorByLabel.get(label) ?? 0;
    const sector = TAXON_COLOR_WHEEL[sectorIndex];
    const colorIndex = sectorUseCounts[sectorIndex] % sector.colors.length;
    sectorUseCounts[sectorIndex] += 1;
    assignments.push([label, Object.freeze({ color: sector.colors[colorIndex], sector: sector.id, sectorIndex })]);
  });
  return immutableMap(assignments);
}

export function createTaxonColorPlan<Group extends TaxonColorGroup>(groups: readonly Group[]): TaxonColorPlan<Group> {
  const frozenGroups = Object.freeze(groups.map((group) => Object.freeze({
    ...group,
    nodeIds: Object.freeze([...group.nodeIds]),
  }) as Group));
  return Object.freeze({
    groups: frozenGroups,
    assignments: assignTaxonColors(frozenGroups.map((group) => group.label)),
  });
}

export function visibleTaxonColorGroups<Group extends TaxonColorGroup>(plan: TaxonColorPlan<Group>, minimumTerminalCount: number) {
  const minimum = Math.max(0, Math.floor(minimumTerminalCount));
  return plan.groups.filter((group) => group.nodeIds.length >= minimum);
}

const COLOR_ROLE_PRESENTATION = {
  legend: { alpha: 1, maximumLightness: 1 },
  strip: { alpha: 0.72, maximumLightness: 0.82 },
  background: { alpha: 0.2, maximumLightness: 0.72 },
} as const satisfies Record<TaxonColorRole, { alpha: number; maximumLightness: number }>;

export function taxonColorCss(assignment: TaxonColorAssignment | undefined, role: TaxonColorRole = "legend") {
  return taxonStyleColorCss(assignment?.color ?? TAXON_COLOR_WHEEL[0].colors[0], role);
}

export function taxonStyleColorCss(baseColor: string, role: TaxonColorRole = "legend") {
  const presentation = COLOR_ROLE_PRESENTATION[role];
  const oklch = hexToOklch(baseColor);
  const color = oklch.lightness > presentation.maximumLightness
    ? oklchToHex({ ...oklch, lightness: presentation.maximumLightness })
    : baseColor;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${presentation.alpha})`;
}
