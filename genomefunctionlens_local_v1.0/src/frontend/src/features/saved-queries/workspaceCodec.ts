let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

/** postMessage takes an isolated snapshot before returning; later edits cannot mutate it. */
export function runWorkspaceCodec<T>(operation: "encode" | "decode" | "prepare", value: unknown): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./workspaceCodec.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.value);
    };
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error("Canvas archive worker failed."));
      pending.clear(); worker?.terminate(); worker = null;
    };
  }
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (result) => resolve(result as T), reject });
    try { worker!.postMessage({ id, operation, value }); }
    catch (error) { pending.delete(id); reject(error); }
  });
}
