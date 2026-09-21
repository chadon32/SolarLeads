import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";

test("roof cache stays fast when Supabase is unavailable and preserves cache compatibility", async (t) => {
  const env = {
    SUPABASE_URL: "http://roof-cache.test",
    SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  type Mode = "healthy" | "offline" | "stalled" | "legacy-read" | "legacy-write" | "write-error";
  let mode: Mode = "healthy";
  const calls: Array<{ method: string; signal?: AbortSignal; body?: unknown }> = [];
  const address = "6420 E Nance St, Mesa, AZ 85215";
  const analysis = buildFallbackRoofAnalysis({ address, lat: 33.415, lng: -111.831 });
  const row = {
    address,
    lat: 33.415,
    lng: -111.831,
    analysis,
    analysis_version: 28,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, env.SUPABASE_URL, "Never contact a real database");
    calls.push({
      method: init?.method ?? "GET",
      signal: init?.signal ?? undefined,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (mode === "offline") throw new TypeError("fetch failed");
    if (mode === "stalled") {
      assert.ok(init?.signal, "Cache requests must have a deadline");
      return await new Promise<Response>((_, reject) => {
        const abort = () => reject(init.signal?.reason);
        if (init.signal?.aborted) abort(); else init.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (mode === "write-error") return Response.json({ message: "write failed" }, { status: 500 });
    if (mode === "legacy-read" && calls.length === 1) {
      return Response.json({ message: 'Could not find the "normalized_address" column' }, { status: 400 });
    }
    if (mode === "legacy-write" && calls.length === 1) {
      return Response.json({ message: 'Could not find the "normalized_address" column' }, { status: 400 });
    }
    return init?.method === "POST" ? new Response(null, { status: 201 }) : Response.json([row]);
  });

  mode = "offline";
  const { createClient } = await import("@supabase/supabase-js");
  const baselineClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const baselineStarted = performance.now();
  await baselineClient.from("roof_analysis_cache").select("analysis").maybeSingle();
  const baselineElapsed = performance.now() - baselineStarted;
  assert.ok(baselineElapsed >= 6_000, "The unbounded default client reproduces retry backoff");
  assert.equal(calls.length, 4, "Default Supabase retries after 1s, 2s, and 4s");

  calls.length = 0;
  mode = "healthy";
  const cache = await import("../src/lib/roof-analysis-cache");

  assert.deepEqual(
    await cache.getCachedRoofAnalysis({ address, lat: 33.415, lng: -111.831, fallback: analysis }),
    analysis,
    "Healthy, current, unexpired entries still normalize against the caller fallback"
  );
  row.analysis_version = 27;
  assert.equal(
    await cache.getCachedRoofAnalysis({ address, lat: 33.415, lng: -111.831, fallback: analysis }),
    null,
    "Older analysis versions remain cache misses"
  );
  row.analysis_version = 28;
  row.expires_at = new Date(Date.now() - 1).toISOString();
  assert.equal(
    await cache.getCachedRoofAnalysis({ address, lat: 33.415, lng: -111.831, fallback: analysis }),
    null,
    "Expired entries remain cache misses"
  );
  row.expires_at = new Date(Date.now() + 60_000).toISOString();

  calls.length = 0;
  mode = "legacy-read";
  assert.deepEqual(await cache.getCachedRoofAnalysisByAddress(address), analysis);
  assert.equal(calls.length, 2, "Missing normalized_address falls back to the legacy address column");
  assert.equal(calls[0]?.signal, calls[1]?.signal, "Legacy reads share one deadline");

  calls.length = 0;
  mode = "legacy-write";
  await cache.saveCachedRoofAnalysis({ address, lat: 33.415, lng: -111.831, analysis });
  assert.equal(calls.length, 2, "Missing normalized_address writes the legacy row");
  assert.equal(calls[0]?.signal, calls[1]?.signal, "Legacy writes share one deadline");
  assert.equal("expires_at" in (calls[1]?.body as Record<string, unknown>), false);

  calls.length = 0;
  mode = "offline";
  const offlineStarted = performance.now();
  assert.equal(await cache.getCachedRoofAnalysis({ address, lat: 33.415, lng: -111.831, fallback: analysis }), null);
  const offlineElapsed = performance.now() - offlineStarted;
  assert.ok(offlineElapsed < 1_000, "Offline reads skip SDK retry backoff");
  assert.equal(calls.length, 1, "Offline reads make a single database request");

  calls.length = 0;
  mode = "stalled";
  const keepAlive = setInterval(() => {}, 5_000);
  try {
    const stalledStarted = performance.now();
    assert.equal(await cache.getCachedRoofAnalysisByAddress(address), null);
    const stalledElapsed = performance.now() - stalledStarted;
    assert.ok(stalledElapsed < 3_000, "Stalled reads stay within the cache deadline");
    t.diagnostic(
      `roof cache timings: before=${baselineElapsed.toFixed(1)}ms offline=${offlineElapsed.toFixed(1)}ms stalled=${stalledElapsed.toFixed(1)}ms`
    );
  } finally {
    clearInterval(keepAlive);
  }

  calls.length = 0;
  mode = "write-error";
  await cache.saveCachedRoofAnalysis({ address, lat: 33.415, lng: -111.831, analysis });
  assert.equal(calls.length, 1, "Cache write errors remain best-effort");
});
