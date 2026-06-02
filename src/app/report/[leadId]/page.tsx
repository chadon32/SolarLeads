import Link from "next/link";
import { cookies } from "next/headers";
import { formatDisplayAddress } from "@/lib/address-format";
import {
  DASHBOARD_SESSION_COOKIE,
  verifyDashboardSessionCookie,
  verifyDashboardToken,
} from "@/lib/dashboard-auth";
import {
  buildRawReportPdfPath,
  verifyReportSignature,
} from "@/lib/report-access";
import { buildSolarReportFromSolarValues } from "@/lib/solar-report";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ReportViewerPageProps = {
  params: Promise<{
    leadId: string;
  }>;
  searchParams?: Promise<{
    exp?: string;
    token?: string;
  }>;
};

type ReportLead = {
  address: string | null;
  annual_energy_kwh?: number | null;
  annual_savings?: number | null;
  created_at: string | null;
  email: string | null;
  energy_offset_pct?: number | null;
  estimated_savings?: number | null;
  id: string;
  lead_score?: number | null;
  lead_score_label?: string | null;
  monthly_bill?: number | null;
  name: string | null;
  panel_count?: number | null;
  phone: string | null;
  roi_years?: number | null;
  solar_suitability_score?: number | null;
  system_size_kw?: number | null;
};

export const metadata = {
  title: "Solar Report | Arizona Solar AI",
  description: "View and download a homeowner solar report.",
};

export default async function ReportViewerPage({
  params,
  searchParams,
}: ReportViewerPageProps) {
  const { leadId } = await params;
  const query = await searchParams;
  const cookieStore = await cookies();
  const access = verifyReportPageAccess(
    leadId,
    query,
    cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value
  );

  if (!access.ok) {
    return (
      <ReportShell>
        <ReportUnavailable
          body={access.body}
          title={access.title}
        />
      </ReportShell>
    );
  }

  const lead = await getLead(leadId);
  const rawPdfPath = access.dashboardAccess
    ? buildDashboardPdfPath(leadId, access.dashboardToken)
    : buildRawReportPdfPath(leadId);
  const downloadPdfPath = access.dashboardAccess
    ? buildDashboardPdfPath(leadId, access.dashboardToken, true)
    : buildRawReportPdfPath(leadId, { download: true });

  if (!lead) {
    return (
      <ReportShell>
        <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.055] p-6 text-center shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
            Report unavailable
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            We could not find this report.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
            The report may have been removed or the lead ID is incorrect.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            Back to dashboard
          </Link>
        </section>
      </ReportShell>
    );
  }

  const report = buildSolarReportFromSolarValues({
    annualKwh: Number(lead.annual_energy_kwh ?? 0),
    annualSavings: Number(lead.annual_savings ?? lead.estimated_savings ?? 0),
    monthlyBill: Number(lead.monthly_bill ?? 0),
    panelCount: Number(lead.panel_count ?? 0),
    systemKw: Number(lead.system_size_kw ?? 0),
  });
  const annualSavings = Number(lead.annual_savings ?? lead.estimated_savings ?? report.annualSavings);
  const systemSizeKw = Number(
    lead.system_size_kw ?? (report.panelCount ? (report.panelCount * 400) / 1000 : 0)
  );
  const panelCount = Number(lead.panel_count ?? report.panelCount);
  const grossCost = panelCount > 0 ? panelCount * 400 * 2.75 : 0;
  const netCost = grossCost * 0.7;
  const netPaybackYears =
    annualSavings > 0 && netCost > 0 ? Number((netCost / annualSavings).toFixed(1)) : 0;
  const roiYears = Number.isFinite(netPaybackYears) && netPaybackYears > 0
    ? netPaybackYears
    : Number(lead.roi_years ?? report.estimatedRoiYears);
  const annualKwh = Number(lead.annual_energy_kwh ?? 0);
  const monthlyBill = Number(lead.monthly_bill ?? 0);
  const energyOffset =
    annualKwh > 0 && monthlyBill > 0
      ? Math.min(Math.round(((annualKwh * 0.13) / (monthlyBill * 12)) * 100), 100)
      : Number(lead.energy_offset_pct ?? report.annualEnergyOffset);
  const solarScore = Number(lead.lead_score ?? lead.solar_suitability_score ?? 0);
  const solarScoreLabel = lead.lead_score
    ? (lead.lead_score_label || getLeadScoreLabel(solarScore)).toUpperCase()
    : null;

  return (
    <ReportShell>
      <header className="flex flex-col justify-between gap-4 rounded-[1.4rem] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl lg:flex-row lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
            Arizona Solar AI
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Solar report for {lead.name || "homeowner"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            {formatDisplayAddress(lead.address || "Address unavailable")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
          >
            Back to dashboard
          </Link>
          <a
            href={rawPdfPath}
            className="inline-flex items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/16"
          >
            Open PDF file
          </a>
          <a
            href={downloadPdfPath}
            className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            Download PDF file
          </a>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[1.4rem] border border-white/10 bg-white/[0.055] p-5 shadow-[0_18px_70px_rgba(2,8,20,0.28)] backdrop-blur-xl">
          <div className="flex flex-col justify-between gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
                Report summary
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Preliminary solar estimate</h2>
            </div>
            <span className="rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">
              Installer verification required
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Metric label="Annual savings" value={formatMoney(annualSavings)} source="Modeled" />
            <Metric label="System size" value={`${formatDecimal(systemSizeKw)} kW`} source="Modeled" />
            <Metric label="Panel count" value={`${Math.round(panelCount || 0)}`} source="Solar API" />
            <Metric label="Estimated ROI" value={`${formatDecimal(roiYears)} yrs`} source="Modeled" />
            <Metric label="Energy offset" value={`${Math.round(energyOffset || 0)}%`} source="Modeled" />
            <Metric
              label="Solar score"
              value={
                solarScore
                  ? `${Math.round(solarScore)}/100${solarScoreLabel ? ` - ${solarScoreLabel}` : ""}`
                  : "Preliminary"
              }
              source="Estimated"
            />
          </div>
        </article>

        <article className="rounded-[1.4rem] border border-white/10 bg-slate-950/50 p-5 shadow-[0_18px_70px_rgba(2,8,20,0.28)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
            PDF actions
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Open or save the full proposal</h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Some embedded browsers do not render raw PDF files. This page gives you a readable report summary first, plus direct PDF links for normal browsers.
          </p>
          <p className="mt-3 rounded-[1rem] border border-amber-200/15 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-100">
            If the PDF file opens as a blank screen in the in-app browser, open this page in Chrome, Edge, or Safari to save the PDF. The report summary on this page is still available immediately.
          </p>
          <div className="mt-5 grid gap-3">
            <a
              href={rawPdfPath}
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
            >
              Open PDF file
            </a>
            <a
              href={downloadPdfPath}
              className="inline-flex items-center justify-center rounded-full bg-cyan-100 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white"
            >
              Download PDF file
            </a>
          </div>
        </article>
      </section>
    </ReportShell>
  );
}

function verifyReportPageAccess(
  leadId: string,
  query?: {
    exp?: string;
    token?: string;
  },
  dashboardSessionCookie?: string
):
  | { ok: true; dashboardAccess?: boolean; dashboardToken?: string }
  | { ok: false; title: string; body: string } {
  const dashboardToken = query?.token?.trim() ?? "";
  const dashboardAuth = verifyDashboardToken(dashboardToken);

  if (dashboardAuth.ok) {
    return { ok: true, dashboardAccess: true, dashboardToken: dashboardAuth.token };
  }

  const dashboardSessionAuth = verifyDashboardSessionCookie(dashboardSessionCookie);

  if (dashboardSessionAuth.ok) {
    return { ok: true, dashboardAccess: true };
  }

  const signature = verifyReportSignature(
    leadId,
    query?.exp ?? null,
    query?.token ?? null
  );

  if (signature.ok) {
    return { ok: true };
  }

  if (signature.missingSecret) {
    return {
      ok: false,
      title: "Report links are not configured.",
      body: "Please contact Arizona Solar AI for a fresh report link.",
    };
  }

  if (signature.expired) {
    return {
      ok: false,
      title: "This report link has expired.",
      body: "For homeowner privacy, report links expire. Please request a fresh report link.",
    };
  }

  return {
    ok: false,
    title: "This report link is invalid.",
    body: "For homeowner privacy, reports require a signed link or dashboard access.",
  };
}

function buildDashboardPdfPath(
  leadId: string,
  token?: string,
  download = false
) {
  const params = new URLSearchParams({
    leadId,
    raw: "1",
  });

  if (token) {
    params.set("token", token);
  }

  if (download) {
    params.set("download", "1");
  }

  return `/api/report/pdf?${params.toString()}`;
}

function ReportUnavailable({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.055] p-6 text-center shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
        Report unavailable
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
        {body}
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
      >
        Back to Arizona Solar AI
      </Link>
    </section>
  );
}

async function getLead(leadId: string) {
  const supabase = getSupabaseAdminClient();
  const selects = [
    "id, name, email, phone, address, monthly_bill, estimated_savings, created_at, panel_count, system_size_kw, annual_savings, annual_energy_kwh, roi_years, energy_offset_pct, solar_suitability_score, lead_score, lead_score_label",
    "id, name, email, phone, address, monthly_bill, estimated_savings, created_at, panel_count, system_size_kw, annual_savings, annual_energy_kwh",
    "id, name, email, phone, address, monthly_bill, estimated_savings, created_at",
  ];

  for (const select of selects) {
    const { data, error } = (await supabase
      .from("leads")
      .select(select)
      .eq("id", leadId)
      .maybeSingle()) as { data: ReportLead | null; error: { message: string } | null };

    if (data) {
      return data;
    }

    if (!error || !shouldRetryLegacySelect(error.message)) {
      if (error) {
        console.error("[report-viewer-lead]", error.message);
      }
      return null;
    }
  }

  return null;
}

function shouldRetryLegacySelect(message: string) {
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("Could not find")
  );
}

function getLeadScoreLabel(score: number) {
  if (score >= 70) return "HOT LEAD";
  if (score >= 45) return "WARM LEAD";
  return "COLD LEAD";
}

function ReportShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_34%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">{children}</div>
    </main>
  );
}

function Metric({
  label,
  source,
  value,
}: {
  label: string;
  source: string;
  value: string;
}) {
  return (
    <div className="rounded-[1rem] border border-white/10 bg-slate-950/48 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          {label}
        </p>
        <span className="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] text-cyan-100">
          {source}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function formatMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDecimal(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "Unavailable";
  }

  return Number(value.toFixed(1)).toLocaleString("en-US");
}
