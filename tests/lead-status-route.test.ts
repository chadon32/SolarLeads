import assert from "node:assert/strict";
import test from "node:test";

test("status writes return persisted timestamps and reject stale concurrent edits", async (t) => {
  const env = {
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "isolated-status-fixture",
    DASHBOARD_ACCESS_TOKEN: "isolated-status-token",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const row = { id: "00000000-0000-4000-8000-000000000001", status: "New", updated_at: "2026-10-01T12:00:00.000Z" };
  const originalTime = row.updated_at;
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, env.SUPABASE_URL);
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json([{ allowed: true, current_count: 1 }]);
    assert.equal(url.pathname, "/rest/v1/leads");
    assert.equal(init?.method, "PATCH");
    const matches = url.searchParams.get("id") === `eq.${row.id}` &&
      (!url.searchParams.has("updated_at") || url.searchParams.get("updated_at") === `eq.${row.updated_at}`);
    if (!matches) return Response.json(null);
    writes += 1;
    Object.assign(row, JSON.parse(String(init?.body)));
    return Response.json({ ...row });
  });
  const { PATCH } = await import("../src/app/api/leads/status/route");
  const request = (status: string) => new Request("http://localhost/api/leads/status", {
    method: "PATCH",
    headers: { authorization: `Bearer ${env.DASHBOARD_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ leadId: row.id, status, expectedUpdatedAt: originalTime }),
  });
  const response = await PATCH(request("contacted"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.lead.status, "contacted");
  assert.notEqual(row.updated_at, originalTime);
  assert.equal(payload.lead.updatedAt, row.updated_at);
  assert.equal((await PATCH(request("closed-lost"))).status, 409);
  assert.equal(row.status, "Contacted");
  assert.equal(writes, 1, "The stale tab must not overwrite the saved status");
});
