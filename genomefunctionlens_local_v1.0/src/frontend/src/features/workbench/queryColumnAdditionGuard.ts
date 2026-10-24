import type { AnnotationColumnSearchResult } from "../../types";
import { normalizeColumnKey } from "../result/resultVisualUtils";

export const LARGE_QUERY_COLUMN_ADDITION_LIMIT = 30;

export function countQueryColumnsAdded(
  currentSession: AnnotationColumnSearchResult | null,
  searchedColumns: AnnotationColumnSearchResult,
  mode: "replace" | "append",
): number {
  const existingKeys = mode === "append"
    ? new Set((currentSession?.columns ?? []).map(normalizeColumnKey))
    : new Set<string>();
  const addedKeys = new Set<string>();
  for (const column of searchedColumns.columns) {
    const key = normalizeColumnKey(column);
    if (!existingKeys.has(key)) addedKeys.add(key);
  }
  return addedKeys.size;
}

export function requiresLargeQueryColumnConfirmation(
  currentSession: AnnotationColumnSearchResult | null,
  searchedColumns: AnnotationColumnSearchResult,
  mode: "replace" | "append",
): boolean {
  return countQueryColumnsAdded(currentSession, searchedColumns, mode)
    > LARGE_QUERY_COLUMN_ADDITION_LIMIT;
}

export type QueryColumnAdditionApplicationResult = {
  status: "accepted" | "cancelled" | "rejected";
};

export async function executeGuardedQueryColumnAddition<T extends QueryColumnAdditionApplicationResult>(
  currentSession: AnnotationColumnSearchResult | null,
  searchedColumns: AnnotationColumnSearchResult,
  mode: "replace" | "append",
  confirm: () => boolean,
  apply: () => T | Promise<T>,
): Promise<T | { status: "cancelled" }> {
  if (
    requiresLargeQueryColumnConfirmation(currentSession, searchedColumns, mode)
    && !confirm()
  ) {
    return { status: "cancelled" };
  }
  return apply();
}
