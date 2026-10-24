export interface CircularRadialLayoutInput {
  size: number;
  treeOuterRadius: number;
  showBranchLabels: boolean;
  branchLabelFontSize: number;
  branchLabelTextBudget: number;
  showSpeciesLayer: boolean;
  showStrip: boolean;
  stripRingWidth: number;
  showStripLabels: boolean;
  stripLabelFontSize: number;
  stripLabelTextBudget: number;
}

export interface CircularRadialLayout {
  ringGap: number;
  labelRadius: number;
  labelOuterRadius: number;
  speciesInnerRadius: number;
  speciesOuterRadius: number;
  stripInnerRadius: number;
  stripOuterRadius: number;
  stripLabelRingInnerRadius: number;
  stripLabelRingOuterRadius: number;
  stripLabelRadius: number;
  heatmapInnerRadius: number;
}

export interface CircularAngularNode {
  id: number;
  nodeId: number;
  children: readonly number[];
}

export interface CircularAngularLayoutInput {
  treeNodes: readonly CircularAngularNode[];
  visibleRows: readonly { nodeId: number }[];
  arcDegrees: number;
  rotationDegrees: number;
}

export interface CircularAngularLayout {
  rootDirection: number;
  availableArc: number;
  gapArc: number;
  leafStep: number;
  startAngle: number;
  endAngle: number;
  sectorHalfStep: number;
  angleByTreeNodeId: Map<number, number>;
  angleByLayoutNodeId: Map<number, number>;
  spanByNodeId: Map<number, { start: number; end: number }>;
}

export interface CircularRadiusNode {
  id: number;
  parent: number | null;
  x: number;
}

export function resolveCircularAngularLayout(input: CircularAngularLayoutInput): CircularAngularLayout {
  const rootDirection = -Math.PI / 2 + input.rotationDegrees * Math.PI / 180;
  const availableArc = Math.PI * 2 * Math.max(180, Math.min(360, input.arcDegrees)) / 360;
  const gapArc = Math.PI * 2 - availableArc;
  const leafStep = availableArc / Math.max(1, input.visibleRows.length);
  const startAngle = rootDirection + gapArc / 2;
  const endAngle = startAngle + availableArc;
  const sectorHalfStep = leafStep * 0.46;
  const angleByTreeNodeId = new Map<number, number>();
  const angleByLayoutNodeId = new Map<number, number>();
  const centerIndexByLayoutNodeId = new Map<number, number>();
  const spanByNodeId = new Map<number, { start: number; end: number }>();
  const layoutNodeByNodeId = new Map(input.treeNodes.map((node) => [node.nodeId, node]));
  input.visibleRows.forEach((row, index) => {
    const angle = startAngle + index * leafStep + leafStep / 2;
    angleByTreeNodeId.set(row.nodeId, angle);
    const layoutNode = layoutNodeByNodeId.get(row.nodeId);
    if (!layoutNode) return;
    spanByNodeId.set(layoutNode.id, { start: index, end: index });
    centerIndexByLayoutNodeId.set(layoutNode.id, index + 0.5);
  });
  [...input.treeNodes].reverse().forEach((node) => {
    const angle = angleByTreeNodeId.get(node.nodeId);
    if (angle !== undefined) angleByLayoutNodeId.set(node.id, angle);
    const childSpans = node.children.map((childId) => spanByNodeId.get(childId)).filter((span): span is { start: number; end: number } => Boolean(span));
    if (childSpans.length && !spanByNodeId.has(node.id)) spanByNodeId.set(node.id, { start: Math.min(...childSpans.map((span) => span.start)), end: Math.max(...childSpans.map((span) => span.end)) });
    if (!centerIndexByLayoutNodeId.has(node.id)) {
      const childCenters = node.children.map((childId) => centerIndexByLayoutNodeId.get(childId)).filter((center): center is number => center !== undefined);
      if (childCenters.length) centerIndexByLayoutNodeId.set(node.id, childCenters.reduce((sum, center) => sum + center, 0) / childCenters.length);
    }
    const centerIndex = centerIndexByLayoutNodeId.get(node.id);
    if (centerIndex !== undefined && !angleByLayoutNodeId.has(node.id)) angleByLayoutNodeId.set(node.id, startAngle + centerIndex * leafStep);
  });
  return { rootDirection, availableArc, gapArc, leafStep, startAngle, endAngle, sectorHalfStep, angleByTreeNodeId, angleByLayoutNodeId, spanByNodeId };
}

export function resolveCircularTaxonomyBackgroundRange(
  layout: Pick<CircularRadialLayout, "stripLabelRingOuterRadius">,
) {
  return {
    innerRadius: 0,
    outerRadius: layout.stripLabelRingOuterRadius,
  };
}

export function resolveCircularNodeRadii(nodes: readonly CircularRadiusNode[], branchScale: number) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const radiusByNodeId = new Map<number, number>();

  const radiusForNode = (node: CircularRadiusNode): number => {
    const cachedRadius = radiusByNodeId.get(node.id);
    if (cachedRadius !== undefined) return cachedRadius;
    if (node.parent === null) {
      radiusByNodeId.set(node.id, 0);
      return 0;
    }
    const parent = nodeById.get(node.parent);
    if (!parent) {
      radiusByNodeId.set(node.id, 0);
      return 0;
    }
    const radius = radiusForNode(parent) + Math.max(0, node.x - parent.x) * branchScale;
    radiusByNodeId.set(node.id, radius);
    return radius;
  };

  nodes.forEach(radiusForNode);
  return {
    radiusByNodeId,
    treeDepth: Math.max(...radiusByNodeId.values(), 0),
  };
}

export function circularHeatmapOuterRadius(heatmapInnerRadius: number, slotSpan: number, ringWidth: number) {
  if (slotSpan <= 0) return heatmapInnerRadius;
  const ringGap = Math.max(1.2, ringWidth * 0.08);
  return heatmapInnerRadius + (slotSpan - 1) * (ringWidth + ringGap) + ringWidth;
}

export function circularHeatmapFitBounds(size: number, heatmapOuterRadius: number) {
  const center = size / 2;
  const radius = Math.max(1, heatmapOuterRadius);
  return {
    left: center - radius,
    top: center - radius,
    right: center + radius,
    bottom: center + radius,
  };
}

export function resolveCircularRadialLayout(input: CircularRadialLayoutInput): CircularRadialLayout {
  const ringGap = input.size * 0.0085;
  const labelGap = input.showBranchLabels
    ? Math.max(input.size * 0.022, input.branchLabelFontSize * 0.8)
    : input.size * 0.008;
  const labelRadius = input.treeOuterRadius + labelGap;
  const labelOuterRadius = input.showBranchLabels
    ? labelRadius + input.branchLabelTextBudget + input.branchLabelFontSize * 0.8
    : input.treeOuterRadius;
  const speciesInnerRadius = labelOuterRadius + ringGap;
  const speciesOuterRadius = input.showSpeciesLayer
    ? speciesInnerRadius + input.size * 0.0145
    : labelOuterRadius;
  const stripInnerRadius = (input.showSpeciesLayer ? speciesOuterRadius : labelOuterRadius) + ringGap;
  const stripOuterRadius = input.showStrip
    ? stripInnerRadius + input.stripRingWidth
    : input.showSpeciesLayer
      ? speciesOuterRadius
      : labelOuterRadius;
  const hasStripLabelRing = input.showStripLabels;
  const stripLabelRingInnerRadius = hasStripLabelRing ? stripOuterRadius + ringGap : stripOuterRadius;
  const stripLabelRingWidth = hasStripLabelRing
    ? Math.max(input.size * 0.036, input.stripLabelTextBudget + input.stripLabelFontSize * 0.4)
    : 0;
  const stripLabelRingOuterRadius = stripLabelRingInnerRadius + stripLabelRingWidth;
  const stripLabelRadius = (stripLabelRingInnerRadius + stripLabelRingOuterRadius) / 2;
  const heatmapBaseRadius = hasStripLabelRing
    ? stripLabelRingOuterRadius
    : input.showStrip
      ? stripOuterRadius
      : input.showSpeciesLayer
        ? speciesOuterRadius
        : labelOuterRadius;

  return {
    ringGap,
    labelRadius,
    labelOuterRadius,
    speciesInnerRadius,
    speciesOuterRadius,
    stripInnerRadius,
    stripOuterRadius,
    stripLabelRingInnerRadius,
    stripLabelRingOuterRadius,
    stripLabelRadius,
    heatmapInnerRadius: heatmapBaseRadius + ringGap,
  };
}
