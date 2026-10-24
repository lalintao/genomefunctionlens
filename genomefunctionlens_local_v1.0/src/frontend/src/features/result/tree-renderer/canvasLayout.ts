export interface Partition {
  start: number;
  end: number;
}

export interface CanvasPartitionLayout {
  tree: Partition;
  treeToStripGap: Partition;
  strip: Partition;
  stripToHeatmapGap: Partition;
  heatmap: Partition;
}

export interface PartitionLayoutInput {
  root: number;
  treeContent: number;
  stripContent: number;
  heatmapContent: number;
  treeToStripGap: number;
  stripToHeatmapGap: number;
}

export function buildCanvasPartitionLayout(input: PartitionLayoutInput): CanvasPartitionLayout {
  const tree = { start: input.root, end: input.root + Math.max(0, input.treeContent) };
  const treeToStripGap = { start: tree.end, end: tree.end + Math.max(0, input.treeToStripGap) };
  const strip = { start: treeToStripGap.end, end: treeToStripGap.end + Math.max(0, input.stripContent) };
  const stripToHeatmapGap = { start: strip.end, end: strip.end + Math.max(0, input.stripToHeatmapGap) };
  const heatmap = { start: stripToHeatmapGap.end, end: stripToHeatmapGap.end + Math.max(0, input.heatmapContent) };
  return { tree, treeToStripGap, strip, stripToHeatmapGap, heatmap };
}
