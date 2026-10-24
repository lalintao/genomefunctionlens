import type { TreeLayoutNode } from "../resultTypes";
import type { TreeStyleRecord } from "../treeStyleModel";
import { frozenArray, immutableMap } from "../../../shared/immutableCollections";

export interface ResolvedTreeStyle {
  readonly id: string;
  readonly color: string;
  readonly name: string;
  readonly nodeId: number;
  readonly anchorX: number;
  readonly source?: "manual" | "taxon";
}

export interface ResolvedTreeStyleRowRun {
  readonly style: ResolvedTreeStyle;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface ResolvedTreeStyleProjection {
  readonly branchByNodeId: ReadonlyMap<number, ResolvedTreeStyle>;
  readonly labelByNodeId: ReadonlyMap<number, ResolvedTreeStyle>;
  readonly backgroundRuns: readonly ResolvedTreeStyleRowRun[];
  readonly stripRuns: readonly ResolvedTreeStyleRowRun[];
}

function rowRunsForStyle(
  style: TreeStyleRecord,
  resolvedStyle: ResolvedTreeStyle,
  rowIndexByNodeId: ReadonlyMap<number, number>,
) {
  const indexes = Array.from(new Set(style.nodeIds
    .map((nodeId) => rowIndexByNodeId.get(nodeId))
    .filter((index): index is number => index !== undefined)))
    .sort((left, right) => left - right);
  const runs: ResolvedTreeStyleRowRun[] = [];
  if (!indexes.length) return runs;
  let startIndex = indexes[0];
  let endIndex = indexes[0];
  indexes.slice(1).forEach((index) => {
    if (index === endIndex + 1) {
      endIndex = index;
      return;
    }
    runs.push(Object.freeze({ style: resolvedStyle, startIndex, endIndex }));
    startIndex = index;
    endIndex = index;
  });
  runs.push(Object.freeze({ style: resolvedStyle, startIndex, endIndex }));
  return runs;
}

export function compileTreeStyleProjection(
  styles: readonly TreeStyleRecord[],
  nodes: readonly Pick<TreeLayoutNode, "nodeId">[],
  rows: readonly { nodeId: number }[],
  anchorXForNodeId: (nodeId: number) => number,
): ResolvedTreeStyleProjection {
  const visibleNodeIds = new Set(nodes.map((node) => node.nodeId));
  const rowIndexByNodeId = new Map(rows.map((row, index) => [row.nodeId, index]));
  const branchByNodeId = new Map<number, ResolvedTreeStyle>();
  const labelByNodeId = new Map<number, ResolvedTreeStyle>();
  const backgroundRuns: ResolvedTreeStyleRowRun[] = [];
  const stripRuns: ResolvedTreeStyleRowRun[] = [];

  styles.forEach((style) => {
    const resolvedStyle: ResolvedTreeStyle = Object.freeze({
      id: style.id,
      color: style.color,
      name: style.name,
      nodeId: style.nodeId,
      anchorX: anchorXForNodeId(style.nodeId),
      ...(style.source ? { source: style.source } : {}),
    });
    if (style.kind === "label" || style.kind === "branch") {
      style.nodeIds.forEach((nodeId) => {
        if (!visibleNodeIds.has(nodeId)) return;
        if (style.kind === "label") labelByNodeId.set(nodeId, resolvedStyle);
        // Internal anchors color their descendants; visible terminals color their incoming branch.
        else if (style.nodeId !== nodeId || rowIndexByNodeId.has(nodeId)) branchByNodeId.set(nodeId, resolvedStyle);
      });
      return;
    }

    if (style.kind === "strip") {
      stripRuns.push(...rowRunsForStyle(style, resolvedStyle, rowIndexByNodeId));
      return;
    }

    backgroundRuns.push(...rowRunsForStyle(style, resolvedStyle, rowIndexByNodeId));
  });

  return Object.freeze({
    branchByNodeId: immutableMap(branchByNodeId),
    labelByNodeId: immutableMap(labelByNodeId),
    backgroundRuns: frozenArray(backgroundRuns),
    stripRuns: frozenArray(stripRuns),
  });
}
