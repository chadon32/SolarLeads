import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { TEST_ROOF_ANALYSIS } from "./fixtures/test-data";
import { buildSolarReportSnapshot } from "../src/lib/report-snapshot";
import type { RoofAnalysis } from "../src/lib/roof-analysis";

const environment = {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_ROLE_KEY: "fake-test-service-key",
  REPORT_SIGNING_SECRET: "isolated-arizona-signing-secret",
  GOOGLE_PLACES_API_KEY: "fake-places-key",
  DISABLE_EMAIL_SENDING: "true",
  TURNSTILE_SECRET_KEY: "",
  MAINTENANCE_MODE: "false",
};

function useEnvironment(t: TestContext) {
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const urlOf = (input: string | URL | Request) =>
  new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

test("a lead outside Arizona is refused even with a valid signed analysis", async (t) => {
  useEnvironment(t);
  const inserts: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json({ allowed: true, current_count: 1 });
    if (url.pathname === "/rest/v1/leads" && init?.method === "POST") {
      inserts.push(JSON.parse(String(init.body)));
      return Response.json({ id: "e7622e31-cac4-4598-a3eb-80531e9ae85b" }, { status: 201 });
    }
    return new Response(null, { status: 204 });
  });
  const { POST } = await import("../src/app/api/leads/route");
  const { buildRoofAnalysisProof } = await import("../src/lib/roof-analysis-proof");

  // A Las Vegas home: the proof is genuine, but the home is not in Arizona.
  const address = "4100 W Flamingo Rd, Las Vegas, NV 89103";
  const shift = { lat: 36.115 - 33.4152, lng: -115.195 - -111.8315 };
  const move = (point: { lat: number; lng: number }) => ({ lat: point.lat + shift.lat, lng: point.lng + shift.lng });
  const base = TEST_ROOF_ANALYSIS as RoofAnalysis;
  const analysis = {
    ...base,
    roofBounds: base.roofBounds && { northeast: move(base.roofBounds.northeast), southwest: move(base.roofBounds.southwest) },
    solarPanels: base.solarPanels.map((panel) => ({ ...panel, center: move(panel.center) })),
  } as RoofAnalysis;

  const response = await POST(new Request("http://localhost/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Out Of State",
      email: "out-of-state@example.test",
      address,
      monthlyBill: 200,
      formStartedAt: Date.now() - 10_000,
      signedRoofAnalysis: analysis,
      roofAnalysisProof: buildRoofAnalysisProof({ address, analysis }),
      reportSnapshot: buildSolarReportSnapshot({ address, analysis, activePanelCount: 10, monthlyBill: 200 }),
    }),
  }));

  assert.equal(response.status, 400, await response.clone().text());
  assert.match((await response.json()).message, /Arizona/);
  assert.equal(inserts.length, 0, "nothing is saved");
});

test("address suggestions are limited to Arizona", async (t) => {
  useEnvironment(t);
  let googleRequest: Record<string, unknown> | null = null;
  const suggestion = (text: string) => ({
    placePrediction: {
      placeId: text,
      text: { text },
      structuredFormat: { mainText: { text: text.split(",")[0] }, secondaryText: { text: text.split(",").slice(1).join(",").trim() } },
    },
  });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.pathname.includes("/rpc/enforce_request_rate_limit")) return Response.json({ allowed: true, current_count: 1 });
    if (url.hostname === "places.googleapis.com") {
      googleRequest = JSON.parse(String(init?.body));
      return Response.json({
        suggestions: [
          suggestion("1084 W Fever Tree Ave, San Tan Valley, AZ, USA"),
          suggestion("1084 Fever Tree Ln, Henderson, NV, USA"),
          suggestion("1084 W Main St, Mesa, Arizona, USA"),
          suggestion("1084 Tree Rd, Gallup, NM, USA"),
        ],
      });
    }
    return new Response(null, { status: 204 });
  });
  const { POST } = await import("../src/app/api/places/autocomplete/route");

  const response = await POST(new Request("http://localhost/api/places/autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "1084 Fever Tree" }),
  }));

  assert.equal(response.status, 200, await response.clone().text());
  const { predictions } = (await response.json()) as { predictions: Array<{ description: string }> };
  assert.deepEqual(
    predictions.map((prediction) => prediction.description),
    ["1084 W Fever Tree Ave, San Tan Valley, AZ, USA", "1084 W Main St, Mesa, Arizona, USA"]
  );
  // Google is asked for Arizona only, so out-of-state homes rarely reach the filter.
  assert.ok(googleRequest, "Google Places was called");
  assert.deepEqual((googleRequest as { locationRestriction?: unknown }).locationRestriction, {
    rectangle: { low: { latitude: 31.2, longitude: -115 }, high: { latitude: 37.1, longitude: -108.9 } },
  });
});

test("the state check reads Google's and the app's address formats", async () => {
  const { addressStateCode, isArizonaHome } = await import("../src/lib/arizona-address");
  assert.equal(addressStateCode("1084 W Fever Tree Ave, San Tan Valley, AZ 85140"), "AZ");
  assert.equal(addressStateCode("1084 W Fever Tree Ave, San Tan Valley, AZ, USA"), "AZ");
  assert.equal(addressStateCode("12 Main St, Mesa, Arizona, USA"), "AZ");
  assert.equal(addressStateCode("12 Water St, Henderson, NV 89015"), "NV");
  assert.equal(addressStateCode("12 Main St"), null);

  // Henderson, NV sits inside Arizona's rough bounding box; the address decides.
  assert.equal(isArizonaHome({ address: "12 Water St, Henderson, NV 89015", lat: 36.03, lng: -114.98 }), false);
  assert.equal(isArizonaHome({ address: "1084 W Fever Tree Ave, San Tan Valley, AZ 85140", lat: 33.19, lng: -111.56 }), true);
  // An Arizona-looking address with coordinates elsewhere is refused.
  assert.equal(isArizonaHome({ address: "1084 W Fever Tree Ave, San Tan Valley, AZ 85140", lat: 40.7, lng: -74 }), false);
  assert.equal(isArizonaHome({ address: "12 Main St" }), false);
});
