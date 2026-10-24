import { aliveBitsetFromLeafNodeIds, createEmptyAliveBitset, leafNodeIdsFromAliveBitset } from "../tree-core/treeBitmapState";
import type { TreeCoreViewModel } from "../tree-core/treeCoreView";
import type { LocalRankConstraint } from "../tree-core/treeState";
import type { BranchCartBatch, BranchCartRecord } from "../result/resultTypes";

export interface CartWorkspaceSnapshot {
  aliveBitset: Uint8Array;
  records: BranchCartRecord[];
  batches: BranchCartBatch[];
}

export type CartWorkspaceCommand =
  | { type: "add-batch"; batch: BranchCartBatch; records: BranchCartRecord[] }
  | { type: "replace-node-record"; batch: BranchCartBatch; record: BranchCartRecord }
  | { type: "remove-record"; recordId: string }
  | { type: "remove-batches"; batchIds: number[] }
  | { type: "replace-filtered-scope"; leafNodeIds: number[] }
  | { type: "update-record-rank"; recordId: string; rank: string }
  | { type: "clear" };

export type CartWorkspaceResult =
  | { accepted: true; snapshot: CartWorkspaceSnapshot }
  | { accepted: false; snapshot: CartWorkspaceSnapshot; rejection: string };

export function createCartWorkspace(tree: TreeCoreViewModel): CartWorkspaceSnapshot {
  return { aliveBitset: createEmptyAliveBitset(tree.nodeCount), records: [], batches: [] };
}

export function copyCartWorkspaceSnapshot(snapshot: CartWorkspaceSnapshot): CartWorkspaceSnapshot {
  return {
    aliveBitset: Uint8Array.from(snapshot.aliveBitset),
    records: snapshot.records.map((record) => ({ ...record, leafNodeIds: [...record.leafNodeIds] })),
    batches: snapshot.batches.map((batch) => ({ ...batch })),
  };
}

function rebuildScope(tree: TreeCoreViewModel, records: readonly BranchCartRecord[]) {
  return aliveBitsetFromLeafNodeIds(tree, new Set(records.flatMap((record) => record.leafNodeIds)));
}

export function executeCartWorkspace(
  tree: TreeCoreViewModel,
  snapshot: CartWorkspaceSnapshot,
  command: CartWorkspaceCommand,
): CartWorkspaceResult {
  switch (command.type) {
    case "add-batch": {
      const seenNodeIds = new Set(snapshot.records.map((record) => record.nodeId));
      const freshRecords = command.records.filter((record) => {
        if (seenNodeIds.has(record.nodeId)) return false;
        seenNodeIds.add(record.nodeId);
        return true;
      });
      if (!freshRecords.length) return { accepted: false, snapshot, rejection: "The requested clades are already in the download list." };
      const records = [...snapshot.records, ...freshRecords.map((record) => ({ ...record, leafNodeIds: [...record.leafNodeIds] }))];
      const batches = [...snapshot.batches.filter((batch) => batch.id !== command.batch.id), { ...command.batch, recordCount: freshRecords.length }];
      return { accepted: true, snapshot: { aliveBitset: rebuildScope(tree, records), records, batches } };
    }
    case "replace-node-record": {
      if (!snapshot.records.some((record) => record.nodeId === command.record.nodeId)) {
        return { accepted: false, snapshot, rejection: "Download-list record not found." };
      }
      const records = [
        ...snapshot.records.filter((record) => record.nodeId !== command.record.nodeId),
        { ...command.record, leafNodeIds: [...command.record.leafNodeIds] },
      ];
      const activeBatchIds = new Set(records.map((record) => record.batchId));
      const batches = [
        ...snapshot.batches
          .filter((batch) => activeBatchIds.has(batch.id) && batch.id !== command.batch.id)
          .map((batch) => ({ ...batch, recordCount: records.filter((record) => record.batchId === batch.id).length })),
        { ...command.batch, recordCount: 1 },
      ];
      return { accepted: true, snapshot: { aliveBitset: rebuildScope(tree, records), records, batches } };
    }
    case "remove-record": {
      const removed = snapshot.records.find((record) => record.id === command.recordId);
      if (!removed) return { accepted: false, snapshot, rejection: "Download-list record not found." };
      const records = snapshot.records.filter((record) => record.id !== command.recordId);
      const remainingBatchRecords = records.filter((record) => record.batchId === removed.batchId);
      return {
        accepted: true,
        snapshot: {
          aliveBitset: rebuildScope(tree, records),
          records,
          batches: snapshot.batches
            .filter((batch) => batch.id !== removed.batchId || remainingBatchRecords.length > 0)
            .map((batch) => batch.id === removed.batchId ? { ...batch, recordCount: remainingBatchRecords.length } : batch),
        },
      };
    }
    case "remove-batches": {
      const removed = new Set(command.batchIds);
      const records = snapshot.records.filter((record) => !removed.has(record.batchId));
      if (records.length === snapshot.records.length) return { accepted: false, snapshot, rejection: "No matching cart batches were found." };
      return {
        accepted: true,
        snapshot: {
          aliveBitset: rebuildScope(tree, records),
          records,
          batches: snapshot.batches.filter((batch) => !removed.has(batch.id)),
        },
      };
    }
    case "replace-filtered-scope": {
      return {
        accepted: true,
        snapshot: {
          aliveBitset: aliveBitsetFromLeafNodeIds(tree, command.leafNodeIds),
          records: snapshot.records,
          batches: snapshot.batches,
        },
      };
    }
    case "update-record-rank": {
      if (!snapshot.records.some((record) => record.id === command.recordId)) return { accepted: false, snapshot, rejection: "Download-list record not found." };
      return {
        accepted: true,
        snapshot: {
          ...snapshot,
          records: snapshot.records.map((record) => record.id === command.recordId ? { ...record, expandRank: command.rank } : record),
          batches: snapshot.batches.map((batch) => {
            if (batch.id !== snapshot.records.find((record) => record.id === command.recordId)?.batchId) return batch;
            const ranks = new Set(snapshot.records.map((record) => record.id === command.recordId ? { ...record, expandRank: command.rank } : record)
              .filter((record) => record.batchId === batch.id)
              .map((record) => record.expandRank));
            return { ...batch, expandRank: ranks.size === 1 ? [...ranks][0] : "mixed" };
          }),
        },
      };
    }
    case "clear":
      if (!snapshot.records.length && !leafNodeIdsFromAliveBitset(tree, snapshot.aliveBitset).length) {
        return { accepted: false, snapshot, rejection: "The cart is already empty." };
      }
      return { accepted: true, snapshot: createCartWorkspace(tree) };
  }
}

export function cartWorkspaceApplication(snapshot: CartWorkspaceSnapshot) {
  const activeLeaves = new Set<number>();
  snapshot.records.forEach((record) => record.leafNodeIds.forEach((leafNodeId) => {
    if (snapshot.aliveBitset[leafNodeId] === 1) activeLeaves.add(leafNodeId);
  }));
  const constraints: LocalRankConstraint[] = snapshot.records
    .filter((record) => record.leafNodeIds.some((leafNodeId) => activeLeaves.has(leafNodeId)))
    .map((record) => ({
      nodeId: record.nodeId,
      expandRank: record.expandRank,
      taxonRank: record.rank ?? undefined,
      taxonName: record.taxonLabel || undefined,
    }));
  return { leafNodeIds: [...activeLeaves].sort((left, right) => left - right), localRankConstraints: constraints };
}
