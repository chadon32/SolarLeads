import assert from "node:assert/strict";
import test from "node:test";

test("follow-up actions reject inherited object keys before touching lead data", async (t) => {
  const env = {
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "isolated-followup-key",
    DASHBOARD_ACCESS_TOKEN: "isolated-followup-token",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let leadRequests = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, env.SUPABASE_URL);
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json([{ allowed: true, current_count: 1 }]);
    leadRequests += 1;
    return Response.json({ message: "Invalid actions must never reach storage" }, { status: 400 });
  });
  const { PATCH } = await import("../src/app/api/leads/follow-up/route");
  for (const action of ["constructor", "__proto__", "made-up-action"]) {
    const response = await PATCH(new Request("http://localhost/api/leads/follow-up", {
      method: "PATCH",
      headers: { authorization: `Bearer ${env.DASHBOARD_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ leadId: "00000000-0000-4000-8000-000000000001", action }),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(leadRequests, 0);
});
