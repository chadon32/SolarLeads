import assert from "node:assert/strict";
import test from "node:test";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "./fixtures/test-data";
import type { RoofAnalysis } from "../src/lib/roof-analysis";
import { buildSolarReportSnapshot } from "../src/lib/report-snapshot";

test("anonymous lead submission cannot read or overwrite an existing homeowner", async (t) => {
  const environment = {
    SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
    REPORT_SIGNING_SECRET: "isolated-regression-signing-secret", DISABLE_EMAIL_SENDING: "true",
    TURNSTILE_SECRET_KEY: "", MAINTENANCE_MODE: "false",
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { POST } = await import("../src/app/api/leads/route");
  const { buildRoofAnalysisProof } = await import("../src/lib/roof-analysis-proof");
  const original = { id: "original-homeowner", email: "original@example.test", phone: "2025550147", utility_bill_file_path: "leads/original-homeowner/utility-bill.pdf" };
  const originalCopy = { ...original };
  const leadId = "e7622e31-cac4-4598-a3eb-80531e9ae85b";
  let duplicate = true;
  let inserted: Record<string, unknown> = {};
  const requests: Array<{ path: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "http://127.0.0.1:9", "Tests must never contact a real service");
    const method = init?.method ?? "GET";
    requests.push({ path: url.pathname, method });
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json({ allowed: true, current_count: 1 });
    if (url.pathname === "/rest/v1/leads") {
      if (method === "POST") {
        inserted = JSON.parse(String(init?.body));
        if (duplicate) return Response.json({ code: "23505", message: "Unique constraint conflict" }, { status: 409 });
        return Response.json({ ...inserted, id: leadId }, { status: 201 });
      }
      if (method === "PATCH") {
        assert.equal(url.searchParams.get("id"), `eq.${leadId}`, "Only this request's newly created row may receive metadata");
        return new Response(null, { status: 204 });
      }
      assert.fail("Public submission must not look up a homeowner by supplied contact details");
    }
    if (url.pathname.includes("/storage/")) assert.fail("Existing bills must not be accessed or moved");
    return new Response(null, { status: 204 });
  });

  const analysis = TEST_ROOF_ANALYSIS as RoofAnalysis;
  const body = {
    name: "Test Request", email: original.email, phone: original.phone, address: TEST_ADDRESS,
    monthlyBill: 200, formStartedAt: Date.now() - 10000,
    signedRoofAnalysis: analysis,
    roofAnalysisProof: buildRoofAnalysisProof({ address: TEST_ADDRESS, analysis }),
    reportSnapshot: buildSolarReportSnapshot({ address: TEST_ADDRESS, analysis, activePanelCount: 10, monthlyBill: 200 }),
  };
  const request = (payload: typeof body) => new Request("http://localhost/api/leads", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const conflict = await POST(request(body));
  assert.equal(conflict.status, 409, await conflict.clone().text());
  const conflictBody = await conflict.json();
  assert.equal(conflictBody.reportUrl, undefined);
  assert.equal(requests.some((item) => item.path === "/rest/v1/leads" && item.method === "PATCH"), false);

  duplicate = false;
  const response = await POST(request({ ...body, email: "different@example.test" }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(inserted.annual_energy_kwh, 6800);
  assert.equal(inserted.annual_savings, 1054);
  assert.deepEqual(original, originalCopy);
  assert.equal(requests.some((item) => item.path === "/rest/v1/leads" && item.method === "GET"), false);
});

test("a saved lead is the conversion boundary and Fourfold failure does not change success", async (t) => {
  const environment = {
    SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
    REPORT_SIGNING_SECRET: "isolated-regression-signing-secret", DISABLE_EMAIL_SENDING: "true",
    TURNSTILE_SECRET_KEY: "", MAINTENANCE_MODE: "false",
    FOURFOLD_ATTRIBUTION_ENDPOINT: "http://127.0.0.1:9/api/conversions",
    FOURFOLD_ATTRIBUTION_SECRET: `00000000-0000-4000-8000-000000000001.${"a".repeat(43)}`,
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { POST } = await import("../src/app/api/leads/route");
  const { buildRoofAnalysisProof } = await import("../src/lib/roof-analysis-proof");
  const leadId = "e7622e31-cac4-4598-a3eb-80531e9ae85b";
  const sequence: string[] = [];

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";

    if (url.pathname === "/api/conversions") {
      sequence.push("fourfold");
      const attributionBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(attributionBody).sort(), ["attributionKey", "eventId", "occurredAt"]);
      assert.equal(attributionBody.eventId, leadId);
      assert.match(String(attributionBody.occurredAt), /Z$/);
      assert.equal(
        attributionBody.attributionKey,
        "solarai-threads-123e4567-e89b-12d3-a456-426614174000"
      );
      throw new Error("Fourfold is unavailable");
    }

    assert.equal(url.origin, "http://127.0.0.1:9", "Tests must never contact a real service");
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json({ allowed: true, current_count: 1 });
    if (url.pathname === "/rest/v1/leads" && method === "POST") {
      sequence.push("lead-insert");
      const inserted = JSON.parse(String(init?.body));
      return Response.json({ ...inserted, id: leadId }, { status: 201 });
    }
    if (url.pathname === "/rest/v1/leads" && method === "PATCH") return new Response(null, { status: 204 });
    return new Response(null, { status: 204 });
  });

  const analysis = TEST_ROOF_ANALYSIS as RoofAnalysis;
  const body = {
    name: "Test Request", email: "new@example.test", phone: "2025550147", address: TEST_ADDRESS,
    monthlyBill: 200, formStartedAt: Date.now() - 10000,
    signedRoofAnalysis: analysis,
    roofAnalysisProof: buildRoofAnalysisProof({ address: TEST_ADDRESS, analysis }),
    reportSnapshot: buildSolarReportSnapshot({ address: TEST_ADDRESS, analysis, activePanelCount: 10, monthlyBill: 200 }),
    utm_id: "solarai-threads-123e4567-e89b-12d3-a456-426614174000",
  };
  const response = await POST(new Request("http://localhost/api/leads", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

  assert.equal(response.status, 200, await response.clone().text());
  const responseBody = await response.json();
  assert.equal(responseBody.lead.id, leadId);
  assert.deepEqual(sequence, ["lead-insert", "fourfold"]);
});
