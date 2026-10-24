import type { TerminalNodeTableRow } from "./terminalNodeTable";
import { frozenArray, immutableMap } from "../../shared/immutableCollections";

export interface TerminalLeafOwner {
  rowIndex: number;
  position: number;
}

export interface TerminalCutSnapshot {
  rows: readonly TerminalNodeTableRow[];
  terminalNodeIds: readonly number[];
  scopeLeafNodeIds: readonly number[];
  leafOwnerByNodeId: ReadonlyMap<number, TerminalLeafOwner>;
  rowIndexByNodeId: ReadonlyMap<number, number>;
  aggregationRowsKey: string;
}

const snapshotCache = new WeakMap<readonly TerminalNodeTableRow[], TerminalCutSnapshot>();

/** Compile leaf-owning semantic state once, before crossing the render seam. */
export function createTerminalCutSnapshot(rows: readonly TerminalNodeTableRow[]): TerminalCutSnapshot {
  const cached = snapshotCache.get(rows);
  if (cached) return cached;

  const leafOwnerByNodeId = new Map<number, TerminalLeafOwner>();
  const rowIndexByNodeId = new Map<number, number>();
  const scopeLeafNodeIds: number[] = [];
  rows.forEach((row, rowIndex) => {
    rowIndexByNodeId.set(row.nodeId, rowIndex);
    row.ownedLeafNodeIds.forEach((leafNodeId, position) => {
      if (!leafOwnerByNodeId.has(leafNodeId)) {
        leafOwnerByNodeId.set(leafNodeId, { rowIndex, position });
        scopeLeafNodeIds.push(leafNodeId);
      }
    });
  });
  scopeLeafNodeIds.sort((left, right) => left - right);

  const snapshot: TerminalCutSnapshot = Object.freeze({
    rows,
    terminalNodeIds: frozenArray(rows.map((row) => row.nodeId)),
    scopeLeafNodeIds: frozenArray(scopeLeafNodeIds),
    leafOwnerByNodeId: immutableMap(leafOwnerByNodeId),
    rowIndexByNodeId: immutableMap(rowIndexByNodeId),
    aggregationRowsKey: rows.map((row) => `${row.nodeId}:${row.ownedLeafNodeIds.join(",")}`).join("|"),
  });
  snapshotCache.set(rows, snapshot);
  return snapshot;
}
