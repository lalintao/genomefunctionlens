import type { AnnotationCondition, SearchColumn } from "../../types";
import { inferAnnotationType } from "../../shared/annotation";
import type { ColumnLabelPart } from "./resultTypes";

export function parseBatchQuery(input: string): AnnotationCondition[] {
  return input
    .split(/[\s,;，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((token, index) => ({
      id: `batch-${index}-${token}`,
      type: inferAnnotationType(token),
      value: token,
      selected: null,
    }));
}

export function columnLabelPartValue(column: SearchColumn, part: ColumnLabelPart) {
  if (part === "value") return column.value;
  if (part === "short_name") return column.short_name;
  return column.full_name;
}
