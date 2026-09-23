import assert from "node:assert/strict";
import test from "node:test";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "./fixtures/test-data";
import { buildSolarReportSnapshot } from "../src/lib/report-snapshot";
import type { RoofAnalysis } from "../src/lib/roof-analysis";

const leadId = "e7622e31-cac4-4598-a3eb-80531e9ae85b";

for (const missingColumn of ["referral_code", "report_snapshot"]) {
  test(`lead schema fallback preserves model data when ${missingColumn} is missing`, async (t) => {
    const environment = {
      SUPABASE_URL: "http://127.0.0.1:9",
      SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
      REPORT_SIGNING_SECRET: "isolated-regression-signing-secret",
      DISABLE_EMAIL_SENDING: "true",
      TURNSTILE_SECRET_KEY: "",
      MAINTENANCE_MODE: "false",
    };
    const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
    Object.assign(process.env, environment);
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const inserts: Record<string, unknown>[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      assert.equal(url.origin, "http://127.0.0.1:9");
      if (url.pathname.includes("/rpc/enforce_request_rate_limit")) {
        return Response.json({ allowed: true, current_count: 1 });
      }
      if (url.pathname === "/rest/v1/leads" && init?.method === "POST") {
        const inserted = JSON.parse(String(init.body)) as Record<string, unknown>;
        inserts.push(inserted);
        if (Object.hasOwn(inserted, missingColumn)) {
          return Response.json({ code: "PGRST204", message: `Could not find the '${missingColumn}' column of 'leads' in the schema cache` }, { status: 400 });
        }
        return Response.json({ ...inserted, id: leadId }, { status: 201 });
      }
      return new Response(null, { status: init?.method === "POST" ? 201 : 204 });
    });
    const { POST } = await import("../src/app/api/leads/route");
    const { buildRoofAnalysisProof } = await import("../src/lib/roof-analysis-proof");
    const analysis = TEST_ROOF_ANALYSIS as RoofAnalysis;
    const response = await POST(new Request("http://localhost/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Synthetic Schema Test",
        email: "schema-check@example.test",
        address: TEST_ADDRESS,
        monthlyBill: 200,
        formStartedAt: Date.now() - 10_000,
        signedRoofAnalysis: analysis,
        roofAnalysisProof: buildRoofAnalysisProof({ address: TEST_ADDRESS, analysis }),
        reportSnapshot: buildSolarReportSnapshot({ address: TEST_ADDRESS, analysis, activePanelCount: 10, monthlyBill: 200 }),
      }),
    }));
    if (missingColumn === "report_snapshot") {
      assert.equal(response.status, 503);
      assert.equal(inserts.length, 1, "Never retry by discarding the report snapshot");
      assert.equal((await response.json()).code, "lead_schema_incomplete");
    } else {
      assert.equal(response.status, 200, await response.clone().text());
      const responsePayload = await response.json();
      assert.equal(responsePayload.lead.emailDeliveryStatus, "unavailable");
      assert.equal(inserts.length, 2);
      assert.deepEqual(inserts[1].report_snapshot, inserts[0].report_snapshot);
      for (const field of ["panel_count", "system_size_kw", "annual_savings", "selected_panel_model"]) {
        assert.deepEqual(inserts[1][field], inserts[0][field]);
        assert.ok(inserts[1][field]);
      }
      assert.equal(Object.hasOwn(inserts[1], "referral_code"), false);
    }
  });
}

test("lead submission accepts null optional referral values and a large signed analysis", async (t) => {
  const environment = {
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
    REPORT_SIGNING_SECRET: "isolated-regression-signing-secret",
    DISABLE_EMAIL_SENDING: "true",
    TURNSTILE_SECRET_KEY: "",
    MAINTENANCE_MODE: "false",
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const { POST } = await import("../src/app/api/leads/route");
  const { buildRoofAnalysisProof } = await import("../src/lib/roof-analysis-proof");
  let insertedReferredBy: unknown;

  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      );
      assert.equal(url.origin, "http://127.0.0.1:9", "Tests must never contact a real service");
      const method = init?.method ?? "GET";

      if (url.pathname.includes("/rpc/enforce_request_rate_limit")) {
        return Response.json({ allowed: true, current_count: 1 });
      }

      if (url.pathname === "/rest/v1/leads" && method === "POST") {
        const inserted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        insertedReferredBy = inserted.referred_by;
        return Response.json({ ...inserted, id: leadId }, { status: 201 });
      }

      return new Response(null, { status: method === "POST" ? 201 : 204 });
    }
  );

  const analysis = {
    ...(TEST_ROOF_ANALYSIS as RoofAnalysis),
    confidenceNote: "large-analysis-test-".repeat(40_000),
  } as RoofAnalysis;
  const reportSnapshot = buildSolarReportSnapshot({
    address: TEST_ADDRESS,
    analysis,
    activePanelCount: 10,
    monthlyBill: 200,
  });
  const body = {
    name: "Test Request",
    email: "new-homeowner@example.test",
    phone: "2025550147",
    address: TEST_ADDRESS,
    monthlyBill: 200,
    formStartedAt: Date.now() - 10_000,
    signedRoofAnalysis: analysis,
    roofAnalysisProof: buildRoofAnalysisProof({ address: TEST_ADDRESS, analysis }),
    reportSnapshot,
    referredBy: null,
  };
  const serialized = JSON.stringify(body);
  assert.ok(Buffer.byteLength(serialized) > 1024 * 1024);

  const response = await POST(
    new Request("http://localhost/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    })
  );

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(insertedReferredBy, null);
});

test("lead submission reports missing nullable proof as verification failure", async () => {
  const environment = {
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
    REPORT_SIGNING_SECRET: "isolated-regression-signing-secret",
    TURNSTILE_SECRET_KEY: "",
    MAINTENANCE_MODE: "false",
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, environment);

  try {
    const { POST } = await import("../src/app/api/leads/route");
    const reportSnapshot = buildSolarReportSnapshot({
      address: TEST_ADDRESS,
      analysis: TEST_ROOF_ANALYSIS as RoofAnalysis,
      activePanelCount: 10,
      monthlyBill: 200,
    });
    const response = await POST(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Request",
          email: "new-homeowner@example.test",
          address: TEST_ADDRESS,
          monthlyBill: 200,
          formStartedAt: Date.now() - 10_000,
          reportSnapshot,
          roofAnalysisProof: null,
          signedRoofAnalysis: null,
          referredBy: null,
        }),
      })
    );

    assert.equal(response.status, 403, await response.clone().text());
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
