import type { AnnotationCondition, AnnotationType } from "../../types";
import type { ColumnMenuState, InsertDialogState } from "./resultTypes";

export function createCondition(index: number, type: AnnotationType = "cog"): AnnotationCondition {
  return {
    id: `condition-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    value: "",
    selected: null,
  };
}

export function createHeatmapStyleId() {
  return `heatmap-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyColumnMenu(): ColumnMenuState {
  return { open: false, x: 0, y: 0, targetValue: null };
}

export function emptyInsertDialog(): InsertDialogState {
  return { open: false, side: "right", targetValue: null, type: "cog", value: "", selected: null };
}
