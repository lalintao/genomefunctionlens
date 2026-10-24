import { runWorkspaceCodec } from "./features/saved-queries/workspaceCodec";
import type {
  AnnotationCondition,
  DatasetResponse,
  DownloadBranchScope,
  DownloadColumnScope,
  DownloadResponse,
  DownloadTaskStartResponse,
  DownloadTaskStatusResponse,
  HeatmapAggregateResponse,
  GenomeFilterRequest,
  GenomeDatabase,
  ModuleSuggestItem,
  AnnotationColumnSearchResult,
  SuggestItem,
  TreeCoreResponse,
  TreeFilterGenomesResponse,
  TreeScopeOptionsResponse,
  TreeScopeRequest,
} from "./types";

const ACTIVE_DOWNLOAD_TASK_KEY_PREFIX = "web_sever.active_sequence_download";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function responseError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await response.json() as { detail?: string; message?: string };
      const detail = typeof body.detail === "string" ? body.detail : body.message;
      if (detail) return new ApiError(detail, response.status);
    } catch {
      // Fall through to a stable message when an upstream sends malformed JSON.
    }
  }
  return new ApiError(`Service request failed (${response.status}). Please try again.`, response.status);
}

async function request<T>(input: RequestInfo, init?: RequestInit, decodeArchive = false): Promise<T> {
  const csrf = document.cookie.split("; ").find((item) => item.startsWith("ppd_csrf="))?.split("=")[1];
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return decodeArchive ? runWorkspaceCodec<T>("decode", await response.text()) : (await response.json()) as T;
}

export type SavedQueryRecord = { id: number; record_version: number; title: string; category_id: number | null; species_tree: string; genome_database: string; dataset_revision: string; created_at: string; updated_at: string; category_name?: string | null; snapshot?: Record<string, unknown> };
export type SavedQueryCategory = { id: number; name: string; sort_order: number };
export type SavedQueryPayload = { request_id: string; expected_record_version: number | null; title: string; category_id: number | null; species_tree: string; genome_database: string; dataset_revision: string; snapshot: import("./features/saved-queries/workspaceDocument").WorkspaceDocument };
export async function createSavedQuery(payload: SavedQueryPayload, encoded?: string): Promise<{ id: number; record_version: number }> { return request("/api/saved-queries", { method: "POST", body: encoded ?? await runWorkspaceCodec<string>("encode", payload) }); }
export async function updateSavedQuery(id: number, payload: SavedQueryPayload, encoded?: string): Promise<{ id: number; record_version: number }> { return request(`/api/saved-queries/records/${id}`, { method: "PUT", body: encoded ?? await runWorkspaceCodec<string>("encode", payload) }); }
export async function listSavedQueries(offset = 0): Promise<{ items: SavedQueryRecord[] }> { return request(`/api/saved-queries?limit=100&offset=${offset}`, { method: "GET" }); }
export async function listSavedQueryCategories(): Promise<{ items: SavedQueryCategory[] }> { return request("/api/saved-queries/categories/list", { method: "GET" }); }
export async function createSavedQueryCategory(name: string): Promise<{ id: number }> { return request("/api/saved-queries/categories", { method: "POST", body: JSON.stringify({ name }) }); }
export async function deleteSavedQuery(id: number): Promise<{ deleted: boolean }> { return request(`/api/saved-queries/records/${id}`, { method: "DELETE" }); }
export async function deleteSavedQueryCategory(id: number): Promise<{ deleted: boolean }> { return request(`/api/saved-queries/categories/${id}`, { method: "DELETE" }); }
export async function getSavedQuery(id: number): Promise<SavedQueryRecord> { return request(`/api/saved-queries/records/${id}`, { method: "GET" }, true); }

async function requestBinary(input: RequestInfo, init?: RequestInit): Promise<ArrayBuffer> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function fetchDatasets(): Promise<DatasetResponse> {
  return request<DatasetResponse>("/api/datasets", { method: "GET" });
}

export async function fetchTreeCoreSummary(
  speciesTree: string,
  genomeDatabase: GenomeDatabase,
): Promise<TreeCoreResponse> {
  const query = new URLSearchParams({
    species_tree: speciesTree,
    genome_database: genomeDatabase,
  });
  // tree_core and its summary must come from the same generated dataset.
  // Browser-cache reuse across a dataset rebuild can otherwise pair a fresh
  // summary with stale binary data and leave the result tree unavailable.
  return request<TreeCoreResponse>(`/api/tree/core?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
}

export async function fetchTreeCoreFile(downloadUrl: string): Promise<ArrayBuffer> {
  return requestBinary(downloadUrl, { method: "GET", cache: "no-store" });
}

export async function fetchTreeScopeOptions(
  speciesTree: string,
  genomeDatabase: GenomeDatabase,
): Promise<TreeScopeOptionsResponse> {
  return request<TreeScopeOptionsResponse>("/api/tree/scope-options", {
    method: "POST",
    body: JSON.stringify({ species_tree: speciesTree, genome_database: genomeDatabase }),
  });
}

export async function filterTreeGenomes(
  speciesTree: string,
  genomeDatabase: GenomeDatabase,
  scope: TreeScopeRequest,
  filters: GenomeFilterRequest,
): Promise<TreeFilterGenomesResponse> {
  return request<TreeFilterGenomesResponse>("/api/tree/filter-genomes", {
    method: "POST",
    body: JSON.stringify({
      species_tree: speciesTree,
      genome_database: genomeDatabase,
      scope,
      filters,
    }),
  });
}

export async function fetchSuggestions(
  type: string,
  keyword: string,
): Promise<SuggestItem[]> {
  const query = new URLSearchParams({ type, keyword, limit: "12" });
  const data = await request<{ items: SuggestItem[] }>(
    `/api/annotations/suggest?${query.toString()}`,
    { method: "GET" },
  );
  return data.items;
}

export async function fetchModuleSuggestions(
  type: string,
  keyword: string,
): Promise<ModuleSuggestItem[]> {
  const query = new URLSearchParams({ type, keyword, limit: "12" });
  const data = await request<{ items: ModuleSuggestItem[] }>(
    `/api/modules/suggest?${query.toString()}`,
    { method: "GET" },
  );
  return data.items;
}

function annotationValue(item: AnnotationCondition): string {
  if (item.type === "module") {
    return item.moduleSelected?.module_id ?? item.value.trim();
  }
  return item.selected?.value ?? item.value.trim();
}

export async function searchAnnotationColumns(
  speciesTree: string,
  genomeDatabase: GenomeDatabase,
  annotations: AnnotationCondition[],
): Promise<AnnotationColumnSearchResult> {
  return request<AnnotationColumnSearchResult>("/api/search/columns", {
    method: "POST",
    body: JSON.stringify({
      species_tree: speciesTree,
      genome_database: genomeDatabase,
      annotations: annotations.map((item) => ({
        type: item.selected?.type ?? item.type,
        value: annotationValue(item),
        ...(item.type === "module" && { include_module_members: true }),
      })),
    }),
  });
}

export async function aggregateHeatmap(
  speciesTree: string,
  genomeDatabase: GenomeDatabase,
  terminalRows: Array<{ nodeId: number; ownedLeafNodeIds: number[] }>,
  annotationColumns: Array<Pick<AnnotationCondition, "type" | "value"> & { annotation_id?: number | null }>,
  moduleCompletenessThreshold?: number | null,
  signal?: AbortSignal,
): Promise<HeatmapAggregateResponse> {
  return request<HeatmapAggregateResponse>("/api/heatmap/aggregate", {
    method: "POST",
    body: JSON.stringify({
      species_tree: speciesTree,
      genome_database: genomeDatabase,
      terminal_rows: terminalRows.map((row) => ({
        node_id: row.nodeId,
        owned_leaf_node_ids: row.ownedLeafNodeIds,
      })),
      annotation_columns: annotationColumns.map((column) => ({
        annotation_id: column.annotation_id ?? null,
        type: column.type,
        value: column.value,
      })),
      module_completeness_threshold: moduleCompletenessThreshold ?? null,
    }),
    signal,
  });
}

export async function downloadSequences(
  speciesTree: string,
  genomeDatabase: GenomeDatabase,
  branches: DownloadBranchScope[],
  columns: DownloadColumnScope[],
  headerFields: string[],
  downloadMode: "all" | "representative",
): Promise<DownloadTaskStartResponse> {
  const task = await request<DownloadTaskStartResponse>("/api/download/sequences", {
    method: "POST",
    body: JSON.stringify({
      species_tree: speciesTree,
      genome_database: genomeDatabase,
      branches: branches.map((item) => ({
        branch_id: item.branchId,
        branch_label: item.branchLabel,
        branch_rank: item.branchRank,
        node_id: item.nodeId,
        leaf_count: item.leafCount,
        leaf_node_ids: item.leafNodeIds ?? [],
      })),
      columns: columns.map((item) => ({
        column_id: item.columnId,
        annotation_type: item.annotationType,
        annotation_value: item.annotationValue,
        annotation_id: item.annotationId,
        annotation_label: item.annotationLabel,
        module_id: item.moduleId,
        module_name: item.moduleName,
        step_id: item.stepId,
        step_label: item.stepLabel,
      })),
      header_fields: headerFields,
      download_mode: downloadMode,
    }),
  });
  return task;
}

export async function fetchDownloadStatus(
  statusUrl: string,
  signal?: AbortSignal,
): Promise<DownloadTaskStatusResponse> {
  return request<DownloadTaskStatusResponse>(statusUrl, { method: "GET", signal });
}

export async function waitForSequenceDownload(
  task: DownloadTaskStartResponse,
  onProgress?: (status: DownloadTaskStatusResponse) => void,
  pollIntervalMs = 1000,
  accountKey: string | null = null,
  signal?: AbortSignal,
): Promise<DownloadResponse> {
  rememberActiveDownloadTask(task, accountKey);
  let consecutiveFailures = 0;
  while (true) {
    throwIfAborted(signal);
    let status: DownloadTaskStatusResponse;
    try {
      status = await fetchDownloadStatus(task.status_url, signal);
      consecutiveFailures = 0;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof ApiError && error.status === 404) {
        clearActiveSequenceDownloadTask(task.task_id, accountKey);
        throw error;
      }
      if (!isRetryableDownloadPollError(error)) throw error;
      if (consecutiveFailures >= 8) {
        throw new Error("Download status is temporarily unavailable. Please try again shortly.");
      }
      consecutiveFailures += 1;
      const retryDelay = Math.min(5000, pollIntervalMs * (2 ** Math.min(consecutiveFailures - 1, 3)));
      await delay(retryDelay, signal);
      continue;
    }
    onProgress?.(status);
    if (status.status === "ready" && status.download_url && status.file_count !== null && status.file_count !== undefined) {
      clearActiveSequenceDownloadTask(task.task_id, accountKey);
      return {
        task_id: status.task_id,
        download_url: status.download_url,
        file_count: status.file_count,
      };
    }
    if (status.status === "failed") {
      clearActiveSequenceDownloadTask(task.task_id, accountKey);
      throw new Error(status.error || "Download generation failed.");
    }
    if (status.status === "cancelled") {
      clearActiveSequenceDownloadTask(task.task_id, accountKey);
      throw new Error("Download was cancelled.");
    }
    await delay(Math.min(5000, pollIntervalMs), signal);
  }
}

export function getActiveSequenceDownloadTask(accountKey: string): DownloadTaskStartResponse | null {
  try {
    const raw = globalThis.localStorage?.getItem(activeDownloadTaskKey(accountKey));
    if (!raw) return null;
    const task = JSON.parse(raw) as Partial<DownloadTaskStartResponse>;
    if (typeof task.task_id !== "string" || typeof task.status_url !== "string") return null;
    return { task_id: task.task_id, status: "queued", status_url: task.status_url };
  } catch {
    return null;
  }
}

function rememberActiveDownloadTask(
  task: DownloadTaskStartResponse,
  accountKey: string | null,
): void {
  if (!accountKey) return;
  try {
    globalThis.localStorage?.setItem(activeDownloadTaskKey(accountKey), JSON.stringify(task));
  } catch {
    // Downloads still work when storage is unavailable or disabled.
  }
}

function clearActiveSequenceDownloadTask(taskId: string, accountKey: string | null): void {
  if (!accountKey) return;
  try {
    const active = getActiveSequenceDownloadTask(accountKey);
    if (!active || active.task_id === taskId) {
      globalThis.localStorage?.removeItem(activeDownloadTaskKey(accountKey));
    }
  } catch {
    // Ignore storage failures after the server-side task reached a terminal state.
  }
}

function isRetryableDownloadPollError(error: unknown): boolean {
  if (error instanceof ApiError) return [502, 503, 504].includes(error.status);
  return error instanceof TypeError;
}

function activeDownloadTaskKey(accountKey: string): string {
  return `${ACTIVE_DOWNLOAD_TASK_KEY_PREFIX}.${encodeURIComponent(accountKey.trim().toLowerCase())}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Download polling was aborted.");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
