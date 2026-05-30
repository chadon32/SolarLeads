import type { Metadata } from "next";
import {
  InstallerDashboard,
  type InstallerLead,
  type InstallerLeadStatus,
} from "@/components/installer-dashboard";
import {
  calculateLeadScore,
  normalizeLeadScoreLabel,
} from "@/lib/lead-scoring";
import { buildReportPdfPath } from "@/lib/report-access";
import { buildSolarReportFromSolarValues } from "@/lib/solar-report";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const metadata: Metadata = {
  title: {
    absolute: "Installer Dashboard | Arizona Solar AI",
  },
  description:
    "Manage homeowner solar leads, prioritize hot prospects, and download reports.",
  openGraph: {
    title: "Installer Dashboard | Arizona Solar AI",
    description:
      "Manage homeowner solar leads, prioritize hot prospects, and download reports.",
  },
  twitter: {
    title: "Installer Dashboard | Arizona Solar AI",
    description:
      "Manage homeowner solar leads, prioritize hot prospects, and download reports.",
  },
};

export const dynamic = "force-dynamic";

type DashboardLead = {
  address: string;
  annual_energy_kwh?: number | null;
  annual_savings?: number | null;
  created_at: string;
  email: string;
  energy_offset_pct?: number | null;
  estimated_savings: number | null;
  id: string;
  lead_score?: number | null;
  lead_score_label?: string | null;
  monthly_bill: number;
  name: string;
  notes?: string | null;
  panel_count?: number | null;
  pdf_downloaded?: boolean | null;
  pdf_generated?: boolean | null;
  phone: string;
  roi_years?: number | null;
  solar_suitability_score?: number | null;
  status?: string | null;
  system_size_kw?: number | null;
  twenty_year_savings?: number | null;
  utility_bill_uploaded?: boolean | null;
};

type LeadsQueryResult = {
  data: DashboardLead[] | null;
  error: { message: string } | null;
};

type FollowUpRow = {
  lead_id: string;
  status?: string | null;
};

export default async function InstallerDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const token = (await searchParams)?.token?.trim();
  const accessToken = process.env.DASHBOARD_ACCESS_TOKEN?.trim();

  if (process.env.NODE_ENV === "production" && !accessToken) {
    return <DashboardAccessGate configurationMissing />;
  }

  if (accessToken && token !== accessToken) {
    return <DashboardAccessGate />;
  }

  const supabase = getSupabaseAdminClient();
  const scoredLeadSelect =
    "id, name, email, phone, address, monthly_bill, estimated_savings, panel_count, system_size_kw, annual_savings, annual_energy_kwh, roi_years, energy_offset_pct, lead_score, lead_score_label, notes, pdf_downloaded, pdf_generated, solar_suitability_score, twenty_year_savings, utility_bill_uploaded, status, created_at";
  const extendedLeadSelect =
    "id, name, email, phone, address, monthly_bill, estimated_savings, panel_count, system_size_kw, annual_savings, annual_energy_kwh, roi_years, status, created_at";
  const baseLeadSelect =
    "id, name, email, phone, address, monthly_bill, estimated_savings, created_at";

  let leadsResult = (await supabase
    .from("leads")
    .select(scoredLeadSelect)
    .order("created_at", { ascending: false })
    .limit(250)) as unknown as LeadsQueryResult;

  if (leadsResult.error && shouldRetryLegacySelect(leadsResult.error.message)) {
    leadsResult = (await supabase
      .from("leads")
      .select(extendedLeadSelect)
      .order("created_at", { ascending: false })
      .limit(250)) as unknown as LeadsQueryResult;
  }

  if (leadsResult.error && shouldRetryLegacySelect(leadsResult.error.message)) {
    leadsResult = (await supabase
      .from("leads")
      .select(baseLeadSelect)
      .order("created_at", { ascending: false })
      .limit(250)) as unknown as LeadsQueryResult;
  }

  const { data: leads, error } = leadsResult;

  if (error) {
    return (
      <main className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-6 py-10 text-slate-100 md:px-10 lg:px-12">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Installer dashboard
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Installer data is not ready yet.
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Confirm Supabase lead tables and service-role access are configured.
          </p>
          <p className="mt-3 rounded-[1.1rem] border border-amber-300/15 bg-amber-300/10 px-4 py-3 text-xs leading-6 text-amber-100">
            Supabase response: {error.message}
          </p>
        </div>
      </main>
    );
  }

  const { data: followUps } = await supabase
    .from("lead_followups")
    .select("lead_id, status")
    .limit(1000);
  const followUpsByLeadId = new Map<string, FollowUpRow[]>();

  ((followUps ?? []) as FollowUpRow[]).forEach((followUp) => {
    const existing = followUpsByLeadId.get(followUp.lead_id) ?? [];
    existing.push(followUp);
    followUpsByLeadId.set(followUp.lead_id, existing);
  });

  const installerLeads = (leads ?? []).map((lead) =>
    mapInstallerLead(lead, followUpsByLeadId.get(lead.id) ?? [])
  );
  const totalLeads = installerLeads.length;
  const hotLeads = installerLeads.filter(
    (lead) => lead.leadScoreLabel === "Hot Lead"
  ).length;
  const averageSavings = average(installerLeads.map((lead) => lead.annualSavings));
  const averageSolarScore = average(installerLeads.map((lead) => lead.solarScore));
  const reportsGenerated = installerLeads.filter((lead) => lead.pdfGenerated).length;
  const pdfsDownloaded = installerLeads.filter((lead) => lead.pdfDownloaded).length;

  return (
    <InstallerDashboard
      leads={installerLeads}
      stats={{
        averageSavings,
        averageSolarScore,
        hotLeads,
        pdfsDownloaded,
        reportsGenerated,
        totalLeads,
      }}
    />
  );
}

function mapInstallerLead(
  lead: DashboardLead,
  followUps: FollowUpRow[]
): InstallerLead {
  const annualSavings = Number(lead.annual_savings ?? lead.estimated_savings ?? 0);
  const panelCount = Number(lead.panel_count ?? 0);
  const systemSizeKw = Number(lead.system_size_kw ?? panelCount * 0.4);
  const report = buildSolarReportFromSolarValues({
    annualSavings,
    annualKwh: Number(lead.annual_energy_kwh ?? 0),
    monthlyBill: Number(lead.monthly_bill ?? 0),
    panelCount,
    systemKw: systemSizeKw,
  });
  const solarScore = clamp(
    Math.round(
      Number(
        lead.solar_suitability_score ??
          estimateSolarScore(report.annualEnergyOffset, report.panelCount, systemSizeKw)
      )
    ),
    0,
    100
  );
  const calculatedScore = calculateLeadScore({
    annualSavings: report.annualSavings,
    email: lead.email,
    energyOffsetPct: lead.energy_offset_pct ?? report.annualEnergyOffset,
    panelCount: report.panelCount,
    pdfDownloaded: lead.pdf_downloaded,
    pdfGenerated: lead.pdf_generated ?? true,
    phone: lead.phone,
    solarSuitabilityScore: solarScore,
    systemSizeKw,
    twentyYearSavings:
      Number(lead.twenty_year_savings ?? 0) || report.annualSavings * 20,
    utilityBillUploaded: lead.utility_bill_uploaded,
  });
  const storedScore =
    lead.lead_score === null || lead.lead_score === undefined
      ? null
      : Number(lead.lead_score);
  const leadScore =
    storedScore !== null && Number.isFinite(storedScore)
      ? Math.round(storedScore)
      : calculatedScore.score;

  return {
    address: lead.address,
    annualSavings: report.annualSavings,
    city: getCityFromAddress(lead.address),
    createdAt: lead.created_at,
    email: lead.email,
    energyOffsetPct: Number(lead.energy_offset_pct ?? report.annualEnergyOffset),
    followUpStatus: getFollowUpStatus(followUps),
    id: lead.id,
    leadScore,
    leadScoreLabel: normalizeLeadScoreLabel(lead.lead_score_label, leadScore),
    monthlyBill: Number(lead.monthly_bill ?? 0),
    name: lead.name,
    notes: lead.notes ?? "",
    panelCount: report.panelCount,
    pdfDownloaded: Boolean(lead.pdf_downloaded),
    pdfGenerated: lead.pdf_generated ?? true,
    phone: lead.phone,
    reportUrl: buildReportPdfPath(lead.id),
    roiYears: Number(lead.roi_years ?? report.estimatedRoiYears),
    solarScore,
    status: normalizeLeadStatus(lead.status) ?? getLeadStatusFromFollowUps(followUps),
    systemSizeKw,
  };
}

function DashboardAccessGate({
  configurationMissing = false,
}: {
  configurationMissing?: boolean;
}) {
  return (
    <main className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-4 py-8 text-slate-100 sm:px-6 md:px-10 lg:px-12">
      <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
          Installer dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          {configurationMissing ? "Dashboard is not configured." : "Access required."}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          {configurationMissing
            ? "Set DASHBOARD_ACCESS_TOKEN in Vercel to protect installer lead history before using this dashboard in production."
            : "Enter the dashboard access token to view installer lead history, PDF links, and follow-up status."}
        </p>

        {configurationMissing ? null : (
          <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              name="token"
              type="password"
              placeholder="Dashboard token"
              className="flex-1 rounded-[1.1rem] border border-white/10 bg-slate-950/45 px-4 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
            />
            <button
              type="submit"
              className="rounded-[1.1rem] bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
            >
              Unlock dashboard
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function getCityFromAddress(address: string) {
  return (
    address
      .replace(", USA", "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)[1] || "Unknown"
  );
}

function getFollowUpStatus(followUps: FollowUpRow[]) {
  if (!followUps.length) {
    return "none";
  }

  if (followUps.some((followUp) => followUp.status === "sent")) {
    return "sent";
  }

  if (followUps.some((followUp) => followUp.status === "failed")) {
    return "needs review";
  }

  return "queued";
}

function getLeadStatusFromFollowUps(followUps: FollowUpRow[]): InstallerLeadStatus {
  return followUps.some(
    (followUp) => followUp.status === "sent" || followUp.status === "queued"
  )
    ? "contacted"
    : "new";
}

function normalizeLeadStatus(value?: string | null): InstallerLeadStatus | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");

  if (
    normalized === "new" ||
    normalized === "contacted" ||
    normalized === "quoted" ||
    normalized === "closed-won" ||
    normalized === "closed-lost"
  ) {
    return normalized;
  }

  return null;
}

function estimateSolarScore(
  energyOffsetPct: number,
  panelCount: number,
  systemSizeKw: number
) {
  return clamp(
    Math.round(
      Math.min(energyOffsetPct, 100) * 0.46 +
        Math.min(panelCount / 30, 1) * 34 +
        Math.min(systemSizeKw / 12, 1) * 20
    ),
    0,
    100
  );
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return 0;
  }

  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function shouldRetryLegacySelect(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find")
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
