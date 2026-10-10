/**
 * Browser-only: owns the roof-model worker. Imported lazily by the runner so
 * server and test environments never evaluate `new Worker(...)`.
 */
import type { RoofModel, RoofModelJob } from "@/lib/roof-model";

export class RoofModelTimeoutError extends Error {}

type Reply = { id: number; model?: RoofModel | null; error?: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (model: RoofModel | null) => void; reject: (error: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  const created = new Worker(new URL("../workers/roof-model.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<Reply>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.error) entry.reject(new Error(event.data.error));
    else entry.resolve(event.data.model ?? null);
  };
  created.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || "Roof model worker failed"));
    pending.clear();
    created.terminate();
    worker = null;
  };
  worker = created;
  return created;
}

export function computeRoofModelInWorker(job: RoofModelJob, timeoutMs: number): Promise<RoofModel | null> {
  const target = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new RoofModelTimeoutError("Roof model timed out"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (model) => {
        window.clearTimeout(timer);
        resolve(model);
      },
      reject: (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    });
    // Rasters are copied (they stay in the shared GeoTIFF cache); results come back transferred.
    target.postMessage({ id, job });
  });
}
