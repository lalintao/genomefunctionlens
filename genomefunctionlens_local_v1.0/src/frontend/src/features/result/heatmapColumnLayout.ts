import type { ModuleGroup, SearchColumn } from "../../types";
import type { HeatmapColumnSlot } from "./resultTypes";
import { normalizeColumnKey } from "./resultVisualUtils";

export function createHeatmapColumnSlotId() {
  return `heatmap-slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedSlotIndex(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined ? Math.max(0, Math.floor(value)) : fallback;
}

function nextFreeSlotIndex(occupied: Set<number>, preferred: number) {
  let slotIndex = Math.max(0, preferred);
  while (occupied.has(slotIndex)) slotIndex += 1;
  return slotIndex;
}

function displayIndexToLogicalIndex(displayIndex: number, hiddenSlotIndexes: number[]) {
  let logicalIndex = Math.max(0, Math.floor(displayIndex));
  while (true) {
    const hiddenBeforeOrAt = hiddenSlotIndexes.filter((slotIndex) => slotIndex <= logicalIndex).length;
    const nextLogicalIndex = Math.max(0, Math.floor(displayIndex)) + hiddenBeforeOrAt;
    if (nextLogicalIndex === logicalIndex) return logicalIndex;
    logicalIndex = nextLogicalIndex;
  }
}

function reindexVisibleSlots(
  slots: HeatmapColumnSlot[],
  visibleColumnKeys: Set<string> | null,
): HeatmapColumnSlot[] {
  if (!visibleColumnKeys) return slots.map((slot) => ({ ...slot }));

  const hiddenSlotIndexes = slots
    .filter((slot) => !visibleColumnKeys.has(slot.columnKey))
    .map((slot) => slot.slotIndex)
    .sort((left, right) => left - right);

  return slots
    .filter((slot) => visibleColumnKeys.has(slot.columnKey))
    .map((slot) => ({
      ...slot,
      slotIndex: slot.slotIndex - hiddenSlotIndexes.filter((hiddenIndex) => hiddenIndex < slot.slotIndex).length,
    }));
}

function applyVisibleSlotIndexes(
  currentSlots: HeatmapColumnSlot[],
  visibleSlots: HeatmapColumnSlot[],
  visibleColumnKeys: Set<string> | null,
) {
  if (!visibleColumnKeys) return visibleSlots;

  const visibleByColumnKey = new Map(visibleSlots.map((slot) => [slot.columnKey, slot]));
  const hiddenSlotIndexes = currentSlots
    .filter((slot) => !visibleColumnKeys.has(slot.columnKey))
    .map((slot) => slot.slotIndex)
    .sort((left, right) => left - right);

  return currentSlots.map((slot) => {
    const visibleSlot = visibleByColumnKey.get(slot.columnKey);
    if (!visibleSlot) return { ...slot };
    return {
      ...slot,
      slotIndex: displayIndexToLogicalIndex(visibleSlot.slotIndex, hiddenSlotIndexes),
      reserveTrailingGap: visibleSlot.reserveTrailingGap,
    };
  });
}

function moveSlotIndex(slots: HeatmapColumnSlot[], draggedColumnKey: string, targetSlotIndex: number) {
  const nextSlots = slots.map((slot) => ({ ...slot }));
  const source = nextSlots.find((slot) => slot.columnKey === draggedColumnKey);
  if (!source) return slots;

  const sourceSlotIndex = source.slotIndex;
  const normalizedTargetIndex = Math.max(0, Math.floor(targetSlotIndex));
  if (sourceSlotIndex === normalizedTargetIndex) return slots;

  nextSlots.forEach((slot) => {
    if (slot.reserveTrailingGap && slot.slotIndex + 1 === normalizedTargetIndex) {
      slot.reserveTrailingGap = undefined;
    }
  });

  const targetOccupied = nextSlots.some(
    (slot) => slot.columnKey !== draggedColumnKey && slot.slotIndex === normalizedTargetIndex,
  );
  if (!targetOccupied) {
    source.slotIndex = normalizedTargetIndex;
    return nextSlots;
  }

  nextSlots.forEach((slot) => {
    if (slot.columnKey === draggedColumnKey) return;
    if (normalizedTargetIndex > sourceSlotIndex && slot.slotIndex > sourceSlotIndex && slot.slotIndex <= normalizedTargetIndex) {
      slot.slotIndex -= 1;
    }
    if (normalizedTargetIndex < sourceSlotIndex && slot.slotIndex >= normalizedTargetIndex && slot.slotIndex < sourceSlotIndex) {
      slot.slotIndex += 1;
    }
  });
  source.slotIndex = normalizedTargetIndex;
  return nextSlots;
}

export function normalizeHeatmapColumnSlots(
  currentSlots: HeatmapColumnSlot[],
  columns: SearchColumn[],
): HeatmapColumnSlot[] {
  const validColumnKeys = new Set(columns.map(normalizeColumnKey));
  const seenColumnKeys = new Set<string>();
  const occupiedSlotIndexes = new Set<number>();
  const nextSlots: HeatmapColumnSlot[] = [];

  currentSlots.forEach((slot, index) => {
    if (!slot.columnKey || !validColumnKeys.has(slot.columnKey) || seenColumnKeys.has(slot.columnKey)) return;
    const slotIndex = nextFreeSlotIndex(occupiedSlotIndexes, normalizedSlotIndex(slot.slotIndex, index));
    seenColumnKeys.add(slot.columnKey);
    occupiedSlotIndexes.add(slotIndex);
    nextSlots.push({
      slotId: slot.slotId || createHeatmapColumnSlotId(),
      columnKey: slot.columnKey,
      slotIndex,
      reserveTrailingGap: slot.reserveTrailingGap,
    });
  });

  columns.map(normalizeColumnKey).forEach((columnKey) => {
    if (seenColumnKeys.has(columnKey)) return;
    const slotIndex = nextFreeSlotIndex(occupiedSlotIndexes, occupiedSlotIndexes.size ? Math.max(...occupiedSlotIndexes) + 1 : 0);
    seenColumnKeys.add(columnKey);
    occupiedSlotIndexes.add(slotIndex);
    nextSlots.push({ slotId: createHeatmapColumnSlotId(), columnKey, slotIndex });
  });

  return nextSlots.sort((left, right) => left.slotIndex - right.slotIndex);
}

export function visibleHeatmapColumnSlots(
  slots: HeatmapColumnSlot[],
  visibleColumnKeys: Set<string>,
): HeatmapColumnSlot[] {
  return reindexVisibleSlots(slots, visibleColumnKeys).sort((left, right) => left.slotIndex - right.slotIndex);
}

export function appendHeatmapColumnKeysWithModuleGaps(
  currentSlots: HeatmapColumnSlot[],
  columnKeys: string[],
  moduleGroups: ModuleGroup[],
): HeatmapColumnSlot[] {
  const nextSlots = currentSlots.map((slot) => ({ ...slot }));
  const existingColumnKeys = new Set(nextSlots.map((slot) => slot.columnKey));
  const moduleIdByColumnKey = new Map<string, string>();
  const moduleCompletenessColumnKeys = new Set<string>();
  moduleGroups.forEach((group) => {
    group.column_ids.forEach((columnKey) => moduleIdByColumnKey.set(columnKey, group.module_id));
    if (group.completeness_column_id) moduleCompletenessColumnKeys.add(group.completeness_column_id);
  });

  let nextSlotIndex = nextSlots.length ? Math.max(...nextSlots.map((slot) => slot.slotIndex)) + 1 : 0;
  const lastExistingSlot = nextSlots.reduce<HeatmapColumnSlot | null>(
    (last, slot) => !last || slot.slotIndex > last.slotIndex ? slot : last,
    null,
  );
  let previousModuleId = lastExistingSlot ? moduleIdByColumnKey.get(lastExistingSlot.columnKey) ?? null : null;
  columnKeys
    .filter((columnKey) => !existingColumnKeys.has(columnKey))
    .forEach((columnKey) => {
      const moduleId = moduleIdByColumnKey.get(columnKey) ?? null;
      if (moduleId !== previousModuleId && (moduleId || previousModuleId)) nextSlotIndex += 1;
      nextSlots.push({
        slotId: createHeatmapColumnSlotId(),
        columnKey,
        slotIndex: nextSlotIndex,
        reserveTrailingGap: moduleCompletenessColumnKeys.has(columnKey) || undefined,
      });
      existingColumnKeys.add(columnKey);
      nextSlotIndex += 1;
      previousModuleId = moduleId;
    });

  return nextSlots.sort((left, right) => left.slotIndex - right.slotIndex);
}

function moduleDetailColumnIds(module: ModuleGroup) {
  if (module.detail_column_ids?.length) return module.detail_column_ids;
  return module.column_ids.filter((columnId) => columnId !== module.completeness_column_id);
}

/** Places each Module's detail columns immediately before its completeness column. */
export function placeModuleDetailsBeforeCompleteness(
  currentSlots: HeatmapColumnSlot[],
  moduleGroups: ModuleGroup[],
): HeatmapColumnSlot[] {
  const detailColumnKeys = new Set(moduleGroups.flatMap(moduleDetailColumnIds));
  const orderedSlots = visibleHeatmapColumnSlots(
    currentSlots,
    new Set(currentSlots.filter((slot) => !detailColumnKeys.has(slot.columnKey)).map((slot) => slot.columnKey)),
  );

  moduleGroups.forEach((module) => {
    const completenessColumnId = module.completeness_column_id;
    if (!completenessColumnId) return;
    const completenessSlot = orderedSlots.find((slot) => slot.columnKey === completenessColumnId);
    if (!completenessSlot) return;

    const detailSlots = moduleDetailColumnIds(module)
      .map((columnId) => currentSlots.find((slot) => slot.columnKey === columnId))
      .filter((slot): slot is HeatmapColumnSlot => Boolean(slot));
    if (!detailSlots.length) return;

    const insertionIndex = completenessSlot.slotIndex;
    orderedSlots.forEach((slot) => {
      if (slot.slotIndex > insertionIndex) slot.slotIndex += detailSlots.length;
    });
    completenessSlot.slotIndex += detailSlots.length;
    orderedSlots.push(...detailSlots.map((slot, index) => ({ ...slot, slotIndex: insertionIndex + index })));
  });

  return orderedSlots.sort((left, right) => left.slotIndex - right.slotIndex);
}

export function removeHeatmapColumnKey(
  currentSlots: HeatmapColumnSlot[],
  columnKey: string,
): HeatmapColumnSlot[] {
  return currentSlots
    .filter((slot) => slot.columnKey !== columnKey)
    .map((slot) => ({ ...slot }))
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

export function moveHeatmapColumnSlot(
  currentSlots: HeatmapColumnSlot[],
  draggedColumnKey: string,
  targetSlotIndex: number,
  visibleColumnKeys?: Set<string>,
): HeatmapColumnSlot[] {
  const visibleKeySet = visibleColumnKeys ?? null;
  const visibleSlots = reindexVisibleSlots(currentSlots, visibleKeySet);
  const movedVisibleSlots = moveSlotIndex(visibleSlots, draggedColumnKey, targetSlotIndex);
  return applyVisibleSlotIndexes(currentSlots, movedVisibleSlots, visibleKeySet)
    .sort((left, right) => left.slotIndex - right.slotIndex);
}
