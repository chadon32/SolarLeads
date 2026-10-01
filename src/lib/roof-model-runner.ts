/**
 * Builds roof models off the main thread when it can, caches them per input
 * (so switching views does not rebuild), and decides whether the rebuilt
 * roof is used at all.
 *
 * Flag: NEXT_PUBLIC_ROOF_RECONSTRUCTION=off falls back to the per-segment
 * model; `?roofModel=segments|reconstructed` overrides it for QA.
 */
import { computeRoofModel, type RoofModel, type RoofModelJob } from "@/lib/roof-model";

const cache = new Map<string, Promise<RoofModel | null>>();
const CACHE_LIMIT = 6;

export function isRoofReconstructionEnabled({
  flag = process.env.NEXT_PUBLIC_ROOF_RECONSTRUCTION,
  search = typeof window === "undefined" ? "" : window.location.search,
}: { flag?: string; search?: string } = {}) {
  const override = new URLSearchParams(search).get("roofModel");
  if (override === "segments") return false;
  if (override === "reconstructed") return true;
  return flag !== "off";
}

export function runRoofModel(
  job: RoofModelJob,
  { cacheKey, timeoutMs = 6_000 }: { cacheKey: string; timeoutMs?: number }
): Promise<RoofModel | null> {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const promise = build(job, timeoutMs).catch(() => null);
  cache.set(cacheKey, promise);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return promise;
}

async function build(job: RoofModelJob, timeoutMs: number): Promise<RoofModel | null> {
  if (typeof Worker === "undefined") return computeRoofModel(job);
  const { computeRoofModelInWorker, RoofModelTimeoutError } = await import("@/lib/roof-model-worker-client");
  try {
    return await computeRoofModelInWorker(job, timeoutMs);
  } catch (error) {
    // A slow device keeps the per-segment model; a worker that cannot start
    // (blocked, unsupported) builds on the main thread instead.
    if (error instanceof RoofModelTimeoutError) return null;
    return computeRoofModel(job);
  }
}
