import assert from "node:assert/strict";
import test from "node:test";

test("report email retries claim delivery once and preserve uncertain outcomes", async (t) => {
  const env = {
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "isolated-report-fixture",
    DASHBOARD_ACCESS_TOKEN: "isolated-report-token",
    REPORT_SIGNING_SECRET: "isolated-report-signing-secret-at-least-32-characters",
    RESEND_API_KEY: "re_isolated_test_key",
    FROM_EMAIL: "reports@example.test",
    DISABLE_EMAIL_SENDING: "false",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const initial = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Synthetic Homeowner",
    email: "homeowner@example.test",
    phone: "",
    address: "1 Synthetic Way, Mesa, AZ 85201",
    status: "New",
    email_sent_at: null as string | null,
    notification_status: "homeowner_email_failed",
  };
  let row = { ...initial };
  let sends = 0;
  let failFinalization = false;
  let failLookup = false;
  let providerBody: Record<string, unknown> = { id: "synthetic-message-id" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin === "https://api.resend.com") {
      sends += 1;
      return Response.json(providerBody);
    }
    assert.equal(url.origin, env.SUPABASE_URL, "No real database or other network is allowed");
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json([{ allowed: true, current_count: 1 }]);
    assert.equal(url.pathname, "/rest/v1/leads");
    if (!init?.method || init.method === "GET") {
      if (failLookup) return Response.json({ message: "Synthetic outage" }, { status: 503 });
      return Response.json([{ ...row }]);
    }
    assert.equal(init.method, "PATCH");
    const patch = JSON.parse(String(init.body));
    if (failFinalization && patch.notification_status !== "homeowner_email_sending") {
      return Response.json({ message: "Synthetic finalize failure" }, { status: 503 });
    }
    for (const [key, filter] of url.searchParams) {
      if (key === "select") continue;
      const value = row[key as keyof typeof row];
      if ((filter === "is.null" && value != null) || (filter.startsWith("eq.") && String(value) !== filter.slice(3))) {
        return Response.json([]);
      }
    }
    Object.assign(row, patch);
    return Response.json([{ ...row }]);
  });
  const { POST } = await import("../src/app/api/report/email/route");
  const request = () => new Request("http://localhost/api/report/email", {
    method: "POST",
    headers: { authorization: `Bearer ${env.DASHBOARD_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ leadId: row.id }),
  });
  const results = await Promise.all([POST(request()), POST(request())]);
  assert.equal(sends, 1, "Concurrent retries must send only one email");
  assert.ok(results.some((result) => result.status === 200));
  assert.ok(results.every((result) => result.status === 200 || result.status === 409));
  const sentAt = row.email_sent_at;
  assert.ok(sentAt);
  assert.equal((await POST(request())).status, 200);
  assert.equal(sends, 1, "Confirmed delivery must not be repeated");
  assert.equal(row.email_sent_at, sentAt);

  row = { ...initial, status: "Test Lead" };
  assert.equal((await POST(request())).status, 409);
  assert.equal(sends, 1, "Test leads must not receive live report emails");

  row = { ...initial };
  providerBody = {};
  assert.equal((await POST(request())).status, 502);
  assert.equal(row.notification_status, "homeowner_email_needs_review");
  assert.equal((await POST(request())).status, 409);
  assert.equal(sends, 2, "An uncertain delivery must be reconciled before retrying");

  row = { ...initial };
  providerBody = { id: "synthetic-message-id-2" };
  failFinalization = true;
  assert.equal((await POST(request())).status, 503);
  assert.equal(row.notification_status, "homeowner_email_sending");
  assert.equal((await POST(request())).status, 409);
  assert.equal(sends, 3, "A failed durable confirmation must not allow a duplicate send");

  failLookup = true;
  assert.equal((await POST(request())).status, 503, "A database outage is not a missing lead");
});
