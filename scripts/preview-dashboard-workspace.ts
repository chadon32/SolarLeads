import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

// Local-only REST adapter. The preview never points at a production database.
const fixturePort = 3201;
const appPort = 3101;
const token = "dashboard-workspace-local-qa";
const now = Date.now();
const stages = [
  "New",
  "Contacted",
  "Quote Requested",
  "Closed Won",
  "Closed Lost",
  "Test Lead",
];
let leads = Array.from({ length: 64 }, (_, index) => {
  const createdAt = new Date(now - (index % 28) * 86_400_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `QA Homeowner ${String(index + 1).padStart(2, "0")}`,
    email: `qa-${index + 1}@example.test`,
    phone: "",
    address: `${index + 1} QA Test Way, Mesa, AZ 85201`,
    status: stages[index % stages.length],
    created_at: createdAt,
    updated_at: createdAt,
    monthly_bill: 180 + index * 3,
    annual_savings: index % 11 === 0 ? null : 1600 + index * 50,
    estimated_savings: null,
    panel_count: 20 + (index % 10),
    system_size_kw: 8 + (index % 4),
    annual_energy_kwh: 15000,
    roi_years: 8,
    selected_panel_brand: ["Qcells", "REC", "Panasonic"][index % 3],
    selected_panel_model: "QA sample module",
    selected_panel_watts: 400,
    system_cost_before_incentives:
      index % 11 === 0 ? null : 22000 + index * 400,
    lead_score: 60 + (index % 40),
    lead_score_label: "Qualified Lead",
    energy_offset_pct: 80,
    pdf_generated: true,
    utility_bill_uploaded: index % 3 === 0,
    utility_bill_file_path: null,
    referred_by: index % 4 === 0 ? "QA-REFERRAL" : null,
    referral_code: null,
    report_snapshot: {
      version: 3,
      createdAt,
      monthlyBill: 200,
      roofAnalysis: { carbonOffsetFactorKgPerMwh: 400 },
      metrics: {
        annualKwh: 15000,
        annualSavings: 2000,
        coveragePct: 80,
        panelCount: 20,
        paybackYears: 8,
        systemKw: 8,
      },
    },
  };
}).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
const followUps = leads.slice(0, 12).map((lead, index) => ({
  id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
  lead_id: lead.id,
  step_order: 1,
  channel: "email",
  title: "QA report follow-up",
  body: "Synthetic preview message. No real email is sent by this preview.",
  scheduled_for: new Date(now + index * 3_600_000).toISOString(),
  status: ["failed", "needs_review", "queued", "sent"][index % 4],
  attempts: 0,
  processed_at: null,
  delivery_message: index % 4 === 0 ? "QA fixture delivery failure" : null,
}));

const fixtureServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${fixturePort}`);
  response.setHeader("Content-Type", "application/json");
  if (url.pathname === "/rest/v1/rpc/enforce_request_rate_limit") {
    response.end(JSON.stringify([{ allowed: true, current_count: 1 }]));
    return;
  }
  if (url.pathname === "/rest/v1/leads") {
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    const matching = id ? leads.filter((lead) => lead.id === id) : leads;
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.method === "PATCH") {
      const patch = JSON.parse(body || "{}");
      for (const lead of matching)
        Object.assign(lead, patch, { updated_at: new Date().toISOString() });
    }
    if (request.method === "DELETE")
      leads = leads.filter((lead) => lead.id !== id);
    const total = matching.length;
    const limit = Number(url.searchParams.get("limit") ?? total);
    response.setHeader(
      "Content-Range",
      total ? `0-${Math.min(total, limit) - 1}/${total}` : "*/0",
    );
    const projected = matching.slice(0, limit).map((lead) => {
      if (!url.searchParams.get("select")?.includes("snapshot_version:"))
        return lead;
      const { report_snapshot: snapshot, ...record } = lead;
      return {
        ...record,
        snapshot_version: snapshot.version,
        snapshot_created_at: snapshot.createdAt,
        snapshot_bill: snapshot.monthlyBill,
        snapshot_metrics: snapshot.metrics,
        snapshot_carbon: snapshot.roofAnalysis.carbonOffsetFactorKgPerMwh,
      };
    });
    response.end(
      JSON.stringify(
        request.headers.accept?.includes("vnd.pgrst.object")
          ? (projected[0] ?? null)
          : projected,
      ),
    );
    return;
  }
  if (url.pathname === "/rest/v1/lead_followups") {
    response.setHeader(
      "Content-Range",
      `0-${followUps.length - 1}/${followUps.length}`,
    );
    response.end(JSON.stringify(followUps));
    return;
  }
  response.statusCode = 404;
  response.end(
    JSON.stringify({ message: "Unsupported local fixture operation" }),
  );
});
async function start() {
  fixtureServer.listen(fixturePort, "127.0.0.1");
  await once(fixtureServer, "listening");
  console.log(`Synthetic dashboard: http://localhost:${appPort}/dashboard`);
  console.log(`Local fixture token: ${token}`);
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--port", String(appPort)],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${fixturePort}`,
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-fixture-key",
        DASHBOARD_ACCESS_TOKEN: token,
        RESEND_API_KEY: "",
        SENDGRID_API_KEY: "",
        TWILIO_AUTH_TOKEN: "",
        FOURFOLD_ATTRIBUTION_URL: "",
        FOURFOLD_ATTRIBUTION_TOKEN: "",
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      },
    },
  );
  const close = () => {
    child.kill();
    fixtureServer.close();
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  child.on("exit", () => {
    fixtureServer.close();
  });
}
void start().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Preview could not start.",
  );
  fixtureServer.close();
  process.exitCode = 1;
});
