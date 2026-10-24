import type { AnnotationColumnSearchResult, SearchColumn } from "../../types";
import { appendSearchedHeatmapColumns } from "../result/annotationColumnSearch";
import { moveHeatmapColumnSlot, normalizeHeatmapColumnSlots, removeHeatmapColumnKey } from "../result/heatmapColumnLayout";
import type { HeatmapColumnSlot } from "../result/resultTypes";
import { normalizeColumnKey } from "../result/resultVisualUtils";

export interface QuerySpecificationSnapshot {
  resultSession: AnnotationColumnSearchResult | null;
  columnSlots: HeatmapColumnSlot[];
}

export type QuerySpecificationCommand =
  | { type: "replace"; result: AnnotationColumnSearchResult }
  | { type: "append"; result: AnnotationColumnSearchResult }
  | { type: "insert-column"; column: SearchColumn; targetColumnKey?: string | null; side?: "left" | "right"; visibleColumnKeys?: string[] }
  | { type: "remove-column"; columnKey: string }
  | { type: "move-column"; columnKey: string; targetIndex: number; visibleColumnKeys?: string[] }
  | { type: "reset" };

export type QuerySpecificationResult =
  | { accepted: true; snapshot: QuerySpecificationSnapshot; changedColumnKeys: string[] }
  | { accepted: false; snapshot: QuerySpecificationSnapshot; rejection: string; changedColumnKeys: [] };

export const EMPTY_QUERY_SPECIFICATION: QuerySpecificationSnapshot = { resultSession: null, columnSlots: [] };

export function executeQuerySpecification(
  snapshot: QuerySpecificationSnapshot,
  command: QuerySpecificationCommand,
): QuerySpecificationResult {
  switch (command.type) {
    case "replace": {
      const appended = appendSearchedHeatmapColumns(null, [], command.result);
      return { accepted: true, snapshot: { resultSession: appended.resultSession, columnSlots: appended.columnSlots }, changedColumnKeys: appended.appendedColumns.map(normalizeColumnKey) };
    }
    case "append": {
      const appended = appendSearchedHeatmapColumns(snapshot.resultSession, snapshot.columnSlots, command.result);
      if (!appended.appendedColumns.length && appended.resultSession.module_groups.length === snapshot.resultSession?.module_groups.length) {
        return { accepted: false, snapshot, rejection: "The requested columns already exist.", changedColumnKeys: [] };
      }
      return { accepted: true, snapshot: { resultSession: appended.resultSession, columnSlots: appended.columnSlots }, changedColumnKeys: appended.appendedColumns.map(normalizeColumnKey) };
    }
    case "remove-column": {
      if (!snapshot.resultSession) return { accepted: false, snapshot, rejection: "There is no active query.", changedColumnKeys: [] };
      const columns = snapshot.resultSession.columns.filter((column) => normalizeColumnKey(column) !== command.columnKey);
      if (columns.length === snapshot.resultSession.columns.length) return { accepted: false, snapshot, rejection: "Column not found.", changedColumnKeys: [] };
      const validKeys = new Set(columns.map(normalizeColumnKey));
      const moduleGroups = snapshot.resultSession.module_groups
        .map((group) => {
          const detailColumnIds = [...(group.detail_column_ids ?? [])];
          const removedDetailIndex = detailColumnIds.indexOf(command.columnKey);
          return {
            ...group,
            column_ids: group.column_ids.filter((key) => validKeys.has(key)),
            detail_column_ids: detailColumnIds.filter((key) => validKeys.has(key)),
            completeness_column_id: group.completeness_column_id === command.columnKey ? null : group.completeness_column_id,
            ko_values: removedDetailIndex < 0
              ? [...(group.ko_values ?? [])]
              : (group.ko_values ?? []).filter((_, index) => index !== removedDetailIndex),
          };
        })
        .filter((group) => group.column_ids.length > 0);
      const resultSession = { ...snapshot.resultSession, columns, module_groups: moduleGroups };
      return {
        accepted: true,
        snapshot: { resultSession, columnSlots: normalizeHeatmapColumnSlots(removeHeatmapColumnKey(snapshot.columnSlots, command.columnKey), columns) },
        changedColumnKeys: [command.columnKey],
      };
    }
    case "insert-column": {
      if (!snapshot.resultSession) return { accepted: false, snapshot, rejection: "There is no active query.", changedColumnKeys: [] };
      const columnKey = normalizeColumnKey(command.column);
      if (snapshot.resultSession.columns.some((column) => normalizeColumnKey(column) === columnKey)) {
        return { accepted: false, snapshot, rejection: "This annotation column already exists.", changedColumnKeys: [] };
      }
      const targetIndex = command.targetColumnKey
        ? snapshot.resultSession.columns.findIndex((column) => normalizeColumnKey(column) === command.targetColumnKey)
        : -1;
      const insertionIndex = targetIndex < 0
        ? snapshot.resultSession.columns.length
        : targetIndex + (command.side === "left" ? 0 : 1);
      const columns = [...snapshot.resultSession.columns];
      columns.splice(insertionIndex, 0, { ...command.column });
      let columnSlots = normalizeHeatmapColumnSlots(snapshot.columnSlots, columns);
      if (command.targetColumnKey) {
        const targetSlot = columnSlots.find((slot) => slot.columnKey === command.targetColumnKey);
        if (targetSlot) columnSlots = moveHeatmapColumnSlot(
          columnSlots,
          columnKey,
          targetSlot.slotIndex + (command.side === "left" ? 0 : 1),
          command.visibleColumnKeys ? new Set(command.visibleColumnKeys) : undefined,
        );
      }
      return {
        accepted: true,
        snapshot: { resultSession: { ...snapshot.resultSession, columns }, columnSlots },
        changedColumnKeys: [columnKey],
      };
    }
    case "move-column": {
      const columnSlots = moveHeatmapColumnSlot(snapshot.columnSlots, command.columnKey, command.targetIndex, command.visibleColumnKeys ? new Set(command.visibleColumnKeys) : undefined);
      if (columnSlots.every((slot, index) => slot.columnKey === snapshot.columnSlots[index]?.columnKey && slot.slotIndex === snapshot.columnSlots[index]?.slotIndex)) {
        return { accepted: false, snapshot, rejection: "Column order is unchanged.", changedColumnKeys: [] };
      }
      return { accepted: true, snapshot: { ...snapshot, columnSlots }, changedColumnKeys: [command.columnKey] };
    }
    case "reset":
      if (!snapshot.resultSession && !snapshot.columnSlots.length) return { accepted: false, snapshot, rejection: "The query is already empty.", changedColumnKeys: [] };
      return { accepted: true, snapshot: EMPTY_QUERY_SPECIFICATION, changedColumnKeys: snapshot.columnSlots.map((slot) => slot.columnKey) };
  }
}
