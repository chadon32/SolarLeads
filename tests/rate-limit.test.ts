import assert from "node:assert/strict";
import test from "node:test";
import { enforceRateLimit } from "../src/lib/rate-limit";

test("rate-limit outages stay bounded without bypassing limits", async (t) => {
  const env = { NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let mode: "offline" | "allowed" | "denied" | "legacy" | "legacy-offline" | "timeout" = "offline";
  const calls: Array<{ path: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, env.SUPABASE_URL, "Never contact a real database");
    calls.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (mode === "offline") throw new TypeError("fetch failed");
    if (mode === "timeout") {
      assert.ok(init?.signal, "Rate-limit database requests must have a deadline");
      const signal = init.signal;
      return await new Promise<Response>((_, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    }
    if (url.pathname.includes("/rpc/")) {
      if (mode.startsWith("legacy")) return Response.json({ code: "PGRST202", message: "Function not installed" }, { status: 404 });
      return Response.json({ allowed: mode === "allowed", current_count: 1 });
    }
    if (mode === "legacy-offline") throw new TypeError("fetch failed");
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-range": "*/0" } });
    return new Response(null, { status: 201 });
  });
  const check = (key: string) => enforceRateLimit({ request: new Request("http://localhost"), key, route: "test:lookup", limit: 1, windowMs: 60_000 });

  assert.equal((await check("offline")).allowed, true);
  assert.equal(calls.length, 1, "Do not retry an unreachable database through the legacy table");
  assert.equal((await check("offline")).allowed, false, "The existing memory fallback must still block excess requests");

  calls.length = 0;
  mode = "allowed";
  assert.equal((await check("healthy")).allowed, true);
  assert.equal(calls.length, 1);
  mode = "denied";
  assert.equal((await check("denied")).allowed, false);

  calls.length = 0;
  mode = "legacy";
  assert.equal((await check("legacy")).allowed, true);
  assert.deepEqual(calls.map((call) => call.method), ["POST", "HEAD", "POST"]);

  calls.length = 0;
  mode = "legacy-offline";
  assert.equal((await check("legacy-offline")).allowed, true);
  assert.equal(calls.length, 2, "A failing legacy count must not trigger SDK retry backoff");

  mode = "timeout";
  // Keep the test alive while AbortSignal.timeout's unref'd timer expires.
  const keepAlive = setInterval(() => {}, 5_000);
  try {
    const started = performance.now();
    assert.equal((await check("timeout")).allowed, true);
    assert.ok(performance.now() - started < 4_000, "A stalled database must not hold up lookup indefinitely");
  } finally {
    clearInterval(keepAlive);
  }
});
