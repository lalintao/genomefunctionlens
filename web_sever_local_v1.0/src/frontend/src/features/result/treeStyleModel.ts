export type TreeStyleKind = "label" | "branch" | "background" | "strip";

export function defaultTreeStyleKindForNode(nodeKind: "internal" | "terminal"): TreeStyleKind {
  return nodeKind === "internal" ? "branch" : "label";
}

export interface TreeStyleRecord {
  id: string;
  createdOrder: number;
  kind: TreeStyleKind;
  color: string;
  name: string;
  nodeId: number;
  nodeIds: number[];
  source?: "manual" | "taxon";
  taxonRank?: string;
  taxonLabel?: string;
  taxonOverrides?: readonly { rank: string; label: string }[];
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function normalizeTreeStyleColor(value: string) {
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toUpperCase() : null;
}

export function createTreeStyleId() {
  return `tree-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nextTreeStyleName(styles: TreeStyleRecord[]) {
  const highest = styles.reduce((max, style) => {
    const match = /^(\d{3})$/.exec(style.name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return String(highest + 1).padStart(3, "0");
}

export function updateTreeStyle(
  styles: TreeStyleRecord[],
  styleId: string,
  patch: Partial<Pick<TreeStyleRecord, "kind" | "color" | "name">>,
) {
  return styles.map((style) => {
    if (style.id !== styleId) return style;
    const changed = Object.entries(patch).some(([key, value]) => value !== style[key as keyof TreeStyleRecord]);
    if (!changed || style.source !== "taxon") return { ...style, ...patch };
    const overrides = [
      ...(style.taxonOverrides ?? []),
      ...(style.taxonRank && style.taxonLabel ? [{ rank: style.taxonRank, label: style.taxonLabel }] : []),
    ];
    const taxonOverrides = Array.from(new Map(overrides.map((override) => [`${override.rank}\u0000${override.label}`, override] as const)).values());
    return {
      ...style,
      ...patch,
      source: "manual" as const,
      taxonRank: undefined,
      taxonLabel: undefined,
      ...(taxonOverrides.length ? { taxonOverrides } : {}),
    };
  });
}

export function appendTreeStyleWithCoveragePruning(styles: TreeStyleRecord[], nextStyle: TreeStyleRecord) {
  if (nextStyle.kind !== "label" && nextStyle.kind !== "background" && nextStyle.kind !== "strip") {
    return [...styles, nextStyle];
  }
  const nextNodeIds = new Set(nextStyle.nodeIds);
  const replacedStyles = styles.filter((style) => style.kind === nextStyle.kind && style.nodeIds.every((nodeId) => nextNodeIds.has(nodeId)));
  const taxonOverrides = Array.from(new Map([
    ...(nextStyle.taxonOverrides ?? []),
    ...replacedStyles.flatMap((style) => [
      ...(style.taxonOverrides ?? []),
      ...(style.source === "taxon" && style.taxonRank && style.taxonLabel
        ? [{ rank: style.taxonRank, label: style.taxonLabel }]
        : []),
    ]),
  ].map((override) => [`${override.rank}\u0000${override.label}`, override] as const)).values());
  const effectiveNextStyle = taxonOverrides.length && nextStyle.source !== "taxon"
    ? {
        ...nextStyle,
        source: "manual" as const,
        taxonOverrides,
      }
    : nextStyle;
  return [
    ...styles.filter((style) => !replacedStyles.includes(style)),
    effectiveNextStyle,
  ];
}

export function createTaxonStyleId(rank: string, label: string) {
  const codePoints = Array.from(`${rank}\u0000${label}`, (character) => (character.codePointAt(0) ?? 0).toString(16)).join("-");
  return `taxon-style-${codePoints || "empty"}`;
}

export function treeStyleMatchesTaxon(style: TreeStyleRecord, rank: string, label: string) {
  return style.source === "taxon"
    ? style.taxonRank === rank && style.taxonLabel === label
    : style.taxonOverrides?.some((override) => override.rank === rank && override.label === label) ?? false;
}

export function syncTaxonStyles(
  styles: readonly TreeStyleRecord[],
  groups: readonly { label: string; nodeIds: readonly number[] }[],
  rank: string,
  colorForLabel: (label: string) => string,
  displayStyle: Extract<TreeStyleKind, "background" | "strip"> = "strip",
) {
  const groupsByLabel = new Map<string, { label: string; nodeIds: number[] }>();
  groups.forEach((group) => {
    const current = groupsByLabel.get(group.label);
    if (current) {
      const nodeIds = new Set([...current.nodeIds, ...group.nodeIds]);
      current.nodeIds = Array.from(nodeIds);
    } else {
      groupsByLabel.set(group.label, { label: group.label, nodeIds: [...group.nodeIds] });
    }
  });
  const mergedGroups = Array.from(groupsByLabel.values());
  const retained = styles.filter((style) => style.source !== "taxon" || (style.taxonRank === rank && style.kind === displayStyle));
  const groupByLabel = new Map(mergedGroups.map((group) => [group.label, group]));
  const suppressedLabels = new Set(retained
    .flatMap((style) => style.taxonOverrides ?? [])
    .filter((override) => override.rank === rank)
    .map((override) => override.label));
  const refreshed = retained.flatMap((style) => {
    if (style.source !== "taxon" || !style.taxonLabel) return [style];
    const group = groupByLabel.get(style.taxonLabel);
    return group ? [{ ...style, nodeId: group.nodeIds[0] ?? style.nodeId, nodeIds: [...group.nodeIds] }] : [];
  });
  const current = new Set(refreshed.filter((style) => style.source === "taxon").map((style) => style.taxonLabel));
  const nextOrder = refreshed.reduce((max, style) => Math.max(max, style.createdOrder), -1);
  const additions = mergedGroups.filter((group) => !current.has(group.label) && !suppressedLabels.has(group.label)).map((group, index) => ({
    id: createTaxonStyleId(rank, group.label),
    createdOrder: nextOrder + index + 1,
    kind: displayStyle,
    color: colorForLabel(group.label),
    name: group.label,
    nodeId: group.nodeIds[0] ?? -1,
    nodeIds: [...group.nodeIds],
    source: "taxon" as const,
    taxonRank: rank,
    taxonLabel: group.label,
  }));
  return [...refreshed, ...additions];
}
