import { buildSolarReportSnapshot } from "../../src/lib/report-snapshot";
import type { RoofAnalysis } from "../../src/lib/roof-analysis";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "../fixtures/test-data";

export const PDF_TEST_ID = "00000000-0000-4000-8000-000000000021";

export function makePdfLead(variant = "standard") {
  const analysis = structuredClone(TEST_ROOF_ANALYSIS) as RoofAnalysis;
  // A documented synthetic two-plane roof, never a customer's property scan.
  const lat = 33.4152, lng = -111.8315;
  const halfLat = 5.5 / 111320;
  const halfLng = 7.5 / (111320 * Math.cos(lat * Math.PI / 180));
  analysis.roofBounds = { northeast: { lat: lat + halfLat, lng: lng + halfLng }, southwest: { lat: lat - halfLat, lng: lng - halfLng } };
  analysis.roofOutline = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  analysis.roofSegments = [0, 1].map((index) => ({
    ...analysis.roofSegments[0], segmentIndex: index, azimuthDeg: index ? 180 : 0,
    panelsFit: 10, areaM2: 82.5, bounds: analysis.roofBounds,
    outline: [{ x: 0, y: index * 50 }, { x: 100, y: index * 50 }, { x: 100, y: (index + 1) * 50 }, { x: 0, y: (index + 1) * 50 }],
  }));
  analysis.solarPanels = Array.from({ length: 20 }, (_, index) => {
    const face = index < 10 ? 0 : 1;
    const northMeters = (face ? -1 : 1) * (1.35 + Math.floor((index % 10) / 5) * 1.95);
    return { ...analysis.solarPanels[0], segmentIndex: face, azimuthDeg: face ? 180 : 0,
      center: { lat: lat + northMeters / 111320, lng: lng + ((index % 5) - 2) * 1.25 / (111320 * Math.cos(lat * Math.PI / 180)) },
      rowIndex: Math.floor(index / 5), columnIndex: index % 5,
    };
  });
  const snapshot = buildSolarReportSnapshot({
    address: TEST_ADDRESS, analysis, activePanelCount: 20, monthlyBill: 200,
  });
  const lead = {
    id: PDF_TEST_ID, name: "Alex Example", email: "alex@example.test", phone: "",
    address: TEST_ADDRESS, created_at: "2026-09-22T18:00:00.000Z",
    monthly_bill: 200, annual_savings: snapshot.metrics.annualSavings,
    monthly_savings: snapshot.metrics.monthlySavings, panel_count: 20,
    system_size_kw: 8, annual_energy_kwh: snapshot.metrics.annualKwh,
    roof_area_m2: 165, usable_area_m2: 88, roof_pitch_deg: 22,
    selected_panel_brand: "Qcells", selected_panel_model: "Q.PEAK DUO BLK ML-G10+",
    selected_panel_watts: 400, system_cost_before_incentives: 21200,
    net_system_cost: 21200, solar_suitability_score: 92,
    utility_bill_uploaded: false, report_snapshot: snapshot as typeof snapshot | null,
  };
  if (variant === "long") {
    lead.name = "Alexandra Example-Winterbottom and Christopher Example-Winterbottom";
    lead.address = "1234 Demonstration Residential Community Boulevard, Building B, Unit 123456789, Mesa, Arizona 85201, United States";
    lead.email = `${"long-local-part".repeat(5)}@example.test`;
    lead.selected_panel_model = "Long Manufacturer Model Identifier " + "ABCDEFGHIJKLMN".repeat(5);
  }
  if (variant === "missing") {
    return { ...lead, report_snapshot: null, panel_count: null, system_size_kw: null,
      annual_energy_kwh: null, roof_area_m2: null, usable_area_m2: null };
  }
  return lead;
}

/** No live network: unexpected requests fail closed, including database writes. */
export function installPdfFixture(lead = makePdfLead()) {
  const priorFetch = globalThis.fetch;
  const env = {
    SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "pdf-fixture-only",
    DASHBOARD_ACCESS_TOKEN: "pdf-fixture-dashboard-only", REPORT_SIGNING_SECRET: "pdf-fixture-signing-only",
    GOOGLE_MAPS_API_KEY: "", MAINTENANCE_MODE: "false", DISABLE_PDF_GENERATION: "false",
  };
  const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const updates: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "http://127.0.0.1:9") throw new Error(`Blocked external PDF request: ${url.origin}`);
    if (url.pathname === "/rest/v1/rpc/enforce_request_rate_limit") {
      return Response.json([{ allowed: true, current_count: 1 }]);
    }
    if (url.pathname === "/rest/v1/leads" && request.method === "GET") return Response.json(lead);
    if (url.pathname === "/rest/v1/leads" && request.method === "PATCH") {
      updates.push(await request.json());
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected PDF fixture request: ${request.method} ${url.pathname}`);
  };
  return {
    updates,
    restore() {
      globalThis.fetch = priorFetch;
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}

export function pdfFixtureRequest(query = "download=1") {
  return new Request(`http://localhost/api/report/pdf?leadId=${PDF_TEST_ID}&${query}`, {
    headers: { "x-dashboard-token": "pdf-fixture-dashboard-only" },
  });
}
