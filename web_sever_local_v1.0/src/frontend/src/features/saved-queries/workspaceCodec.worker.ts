import { decodeWorkspaceDocument, prepareWorkspaceRestore } from "./workspaceDocument";
import type { TreeCoreRuntime } from "../tree-core/treeCoreTypes";

// Transfer rebuilt buffers without copying them again; never transfer the UI's raw tree.
function transferableBuffers(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>(), seen = new Set<object>();
  function visit(item: unknown): void {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (ArrayBuffer.isView(item) && item.buffer instanceof ArrayBuffer) buffers.add(item.buffer);
    else if (item instanceof ArrayBuffer) buffers.add(item);
    else if (item instanceof Map || item instanceof Set) for (const child of item.values()) visit(child);
    else for (const child of Object.values(item)) visit(child);
  }
  visit(value);
  return [...buffers];
}

self.onmessage = (event: MessageEvent<{ id: number; operation: "encode" | "decode" | "prepare"; value: unknown }>) => {
  const { id, operation, value } = event.data;
  try {
    if (operation === "prepare") {
      const input = value as { raw: TreeCoreRuntime; document: unknown; revision: number };
      const prepared = prepareWorkspaceRestore(input.raw, input.document, input.revision);
      self.postMessage({ id, value: prepared }, { transfer: transferableBuffers(prepared) });
      return;
    }
    const parsed = operation === "decode" ? JSON.parse(String(value)) : value;
    if (parsed && typeof parsed === "object" && "snapshot" in parsed) decodeWorkspaceDocument(parsed.snapshot);
    self.postMessage({ id, value: operation === "encode" ? JSON.stringify(parsed) : parsed });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Canvas archive encoding failed." });
  }
};
