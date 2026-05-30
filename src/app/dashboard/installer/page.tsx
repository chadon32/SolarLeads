import type { Metadata } from "next";
import {
  InstallerDashboard,
  type InstallerFollowUpStatus,
  type InstallerFollowUpStep,
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
import { fmtAddr } from "@/lib/utils";

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
  follow_up_notes?: string | null;
  follow_up_status?: string | null;
  id: string;
  last_contacted_at?: string | null;
  lead_score?: number | null;
  lead_score_label?: string | null;
  monthly_bill: number;
  name: string;
  next_follow_up_at?: string | null;
  notes?: string | null;
  panel_count?: number | null;
  pdf_downloaded?: boolean | null;
  pdf_generated?: boolean | null;
  quote_requested?: boolean | null;
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
  channel?: string | null;
  delivery_message?: string | null;
  lead_id: string;
  processed_at?: string | null;
  scheduled_for?: string | null;
  status?: string | null;
  step_order?: number | null;
  title?: string | null;
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
    "id, name, email, phone, address, monthly_bill, estimated_savings, panel_count, system_size_kw, annual_savings, annual_energy_kwh, roi_years, energy_offset_pct, lead_score, lead_score_label, notes, follow_up_status, follow_up_notes, last_contacted_at, next_follow_up_at, pdf_downloaded, pdf_generated, quote_requested, solar_suitability_score, twenty_year_savings, utility_bill_uploaded, status, created_at";
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
    .select("lead_id, step_order, channel, title, scheduled_for, status, processed_at, delivery_message")
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
      automationConnected={isAutomationConnected()}
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
    quoteRequested: lead.quote_requested,
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
    followUpNotes: lead.follow_up_notes ?? "",
    followUpStatus: getFollowUpStatus(lead.follow_up_status, followUps),
    followUpSteps: mapFollowUpSteps(followUps),
    id: lead.id,
    lastContactedAt: lead.last_contacted_at ?? getLastContactedFromFollowUps(followUps),
    leadScore,
    leadScoreLabel: normalizeLeadScoreLabel(lead.lead_score_label, leadScore),
    monthlyBill: Number(lead.monthly_bill ?? 0),
    name: lead.name,
    nextFollowUpAt: lead.next_follow_up_at ?? getNextFollowUpFromSteps(followUps),
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
    utilityBillUploaded: Boolean(lead.utility_bill_uploaded),
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
    fmtAddr(address)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)[1] || "Unknown"
  );
}

function getFollowUpStatus(
  storedStatus: string | null | undefined,
  followUps: FollowUpRow[]
): InstallerFollowUpStatus {
  const normalized = normalizeFollowUpStatus(storedStatus);
  if (normalized !== "Not started") {
    return normalized;
  }

  if (!followUps.length) {
    return "Not started";
  }

  if (followUps.some((followUp) => followUp.status === "failed")) {
    return "First follow-up due";
  }

  if (followUps.some((followUp) => followUp.step_order === 1 && followUp.status === "sent")) {
    return "Report sent";
  }

  if (
    followUps.some(
      (followUp) => followUp.status === "queued" || followUp.status === "scheduled"
    )
  ) {
    return "First follow-up due";
  }

  return "Not started";
}

function getLeadStatusFromFollowUps(followUps: FollowUpRow[]): InstallerLeadStatus {
  return followUps.some(
    (followUp) => followUp.status === "sent" || followUp.status === "queued"
  )
    ? "contacted"
    : "new";
}

function mapFollowUpSteps(followUps: FollowUpRow[]): InstallerFollowUpStep[] {
  return [...followUps]
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
    .map((followUp) => ({
      channel: followUp.channel ?? "email",
      deliveryMessage: followUp.delivery_message ?? null,
      processedAt: followUp.processed_at ?? null,
      scheduledFor: followUp.scheduled_for ?? "",
      status: followUp.status ?? "queued",
      stepOrder: Number(followUp.step_order ?? 0),
      title: followUp.title ?? getDefaultFollowUpTitle(followUp.step_order),
    }));
}

function getLastContactedFromFollowUps(followUps: FollowUpRow[]) {
  const processedTimes = followUps
    .map((followUp) => followUp.processed_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return processedTimes[0] ?? null;
}

function getNextFollowUpFromSteps(followUps: FollowUpRow[]) {
  const now = Date.now();
  const queuedTimes = followUps
    .filter(
      (followUp) =>
        followUp.status === "queued" ||
        followUp.status === "scheduled" ||
        followUp.status === "failed"
    )
    .map((followUp) => followUp.scheduled_for)
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) && timestamp >= now - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return queuedTimes[0] ?? null;
}

function normalizeFollowUpStatus(value?: string | null): InstallerFollowUpStatus {
  const normalized = (value ?? "").trim().toLowerCase().replace(/\s+/g, "-");

  if (normalized === "report-sent" || normalized === "sent") {
    return "Report sent";
  }

  if (
    normalized === "first-follow-up-due" ||
    normalized === "follow-up-due" ||
    normalized === "queued" ||
    normalized === "scheduled"
  ) {
    return "First follow-up due";
  }

  if (normalized === "contacted") {
    return "Contacted";
  }

  if (normalized === "quote-requested" || normalized === "quoted") {
    return "Quote requested";
  }

  if (normalized === "closed" || normalized === "closed-won") {
    return "Closed";
  }

  if (normalized === "lost" || normalized === "closed-lost") {
    return "Lost";
  }

  return "Not started";
}

function getDefaultFollowUpTitle(stepOrder?: number | null) {
  if (stepOrder === 1) return "Report ready email";
  if (stepOrder === 2) return "24-hour follow-up";
  if (stepOrder === 3) return "3-day savings reminder";
  if (stepOrder === 4) return "7-day quote CTA";
  return "Follow-up";
}

function normalizeLeadStatus(value?: string | null): InstallerLeadStatus | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");

  if (normalized === "quote-requested") {
    return "quoted";
  }

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

function isAutomationConnected() {
  const emailConnected = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim()
  );
  const smsConnected = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );

  return emailConnected || smsConnected;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
