import type { Metadata } from "next";
import {
  DashboardCrm,
  type DashboardCrmFollowUp,
  type DashboardCrmLead,
  type DashboardLeadStatus,
} from "@/components/dashboard-crm";
import { Button } from "@/components/ui/button";
import {
  calculateLeadScore,
  normalizeLeadScoreLabel,
} from "@/lib/lead-scoring";
import { buildSolarReportFromSolarValues } from "@/lib/solar-report";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildReportPdfPath } from "@/lib/report-access";

export const metadata: Metadata = {
  title: {
    absolute: "Lead Dashboard | Arizona Solar AI",
  },
  description:
    "Manage solar leads, download reports, and track your pipeline.",
  openGraph: {
    title: "Lead Dashboard | Arizona Solar AI",
    description:
      "Manage solar leads, download reports, and track your pipeline.",
  },
  twitter: {
    title: "Lead Dashboard | Arizona Solar AI",
    description:
      "Manage solar leads, download reports, and track your pipeline.",
  },
};

export const dynamic = "force-dynamic";

type DashboardLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  monthly_bill: number;
  estimated_savings: number | null;
  panel_count?: number | null;
  system_size_kw?: number | null;
  annual_savings?: number | null;
  annual_energy_kwh?: number | null;
  roi_years?: number | null;
  selected_panel_brand?: string | null;
  selected_panel_model?: string | null;
  selected_panel_watts?: number | null;
  system_cost_before_incentives?: number | null;
  federal_tax_credit?: number | null;
  net_system_cost?: number | null;
  selected_inverter_type?: string | null;
  energy_offset_pct?: number | null;
  lead_score?: number | null;
  lead_score_label?: string | null;
  pdf_downloaded?: boolean | null;
  pdf_generated?: boolean | null;
  solar_suitability_score?: number | null;
  twenty_year_savings?: number | null;
  utility_bill_uploaded?: boolean | null;
  status?: string | null;
  created_at: string;
};

type LeadsQueryResult = {
  data: DashboardLead[] | null;
  error: { message: string } | null;
};

export default async function DashboardPage({
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
    "id, name, email, phone, address, monthly_bill, estimated_savings, panel_count, system_size_kw, annual_savings, annual_energy_kwh, roi_years, selected_panel_brand, selected_panel_model, selected_panel_watts, system_cost_before_incentives, federal_tax_credit, net_system_cost, selected_inverter_type, energy_offset_pct, lead_score, lead_score_label, pdf_downloaded, pdf_generated, solar_suitability_score, twenty_year_savings, utility_bill_uploaded, status, created_at";
  const extendedLeadSelect =
    "id, name, email, phone, address, monthly_bill, estimated_savings, panel_count, system_size_kw, annual_savings, annual_energy_kwh, roi_years, selected_panel_brand, selected_panel_model, selected_panel_watts, system_cost_before_incentives, federal_tax_credit, net_system_cost, selected_inverter_type, status, created_at";
  const baseLeadSelect =
    "id, name, email, phone, address, monthly_bill, estimated_savings, created_at";

  let leadsResult = await supabase
    .from("leads")
    .select(scoredLeadSelect)
    .order("created_at", { ascending: false })
    .limit(10) as unknown as LeadsQueryResult;

  if (
    leadsResult.error &&
    shouldRetryLegacySelect(leadsResult.error.message)
  ) {
    leadsResult = await supabase
      .from("leads")
      .select(extendedLeadSelect)
      .order("created_at", { ascending: false })
      .limit(10) as unknown as LeadsQueryResult;
  }

  if (
    leadsResult.error &&
    shouldRetryLegacySelect(leadsResult.error.message)
  ) {
    leadsResult = await supabase
      .from("leads")
      .select(baseLeadSelect)
      .order("created_at", { ascending: false })
      .limit(10) as unknown as LeadsQueryResult;
  }

  const { data: leads, error: leadsError } = leadsResult;

  if (leadsError) {
    const issue = describeDashboardIssue(leadsError.message);

    return (
      <main className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-6 py-10 text-slate-100 md:px-10 lg:px-12">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Homeowner dashboard
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Dashboard data is not ready yet.
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            {issue.summary}
          </p>
          <p className="mt-3 rounded-[1.1rem] border border-white/10 bg-slate-950/40 px-4 py-3 text-xs leading-6 text-slate-300">
            {issue.detail}
          </p>
          <p className="mt-3 rounded-[1.1rem] border border-amber-300/15 bg-amber-300/10 px-4 py-3 text-xs leading-6 text-amber-100">
            Supabase response: {leadsError.message}
          </p>
        </div>
      </main>
    );
  }

  const { data: followUps, error: followUpsError } = await supabase
    .from("lead_followups")
    .select(
      "id, lead_id, step_order, channel, title, body, scheduled_for, status, attempts, processed_at, delivery_message"
    )
    .order("scheduled_for", { ascending: false })
    .limit(30);

  const leadList = leads ?? [];
  const followUpList = followUpsError ? [] : followUps ?? [];
  const totalLeads = leadList.length;
  const totalSavings = leadList.reduce(
    (sum, lead) => sum + (lead.estimated_savings || 0),
    0
  );
  const averageSavings = totalLeads ? Math.round(totalSavings / totalLeads) : 0;
  const queuedFollowUps = followUpList.filter(
    (item) => item.status === "queued"
  ).length;

  const followUpsByLeadId = new Map<string, typeof followUpList>();
  followUpList.forEach((followUp) => {
    const existing = followUpsByLeadId.get(followUp.lead_id) ?? [];
    existing.push(followUp);
    followUpsByLeadId.set(followUp.lead_id, existing);
  });

  const crmLeads: DashboardCrmLead[] = leadList.map((lead) => {
    const annualSavings = Number(
      lead.annual_savings ?? lead.estimated_savings ?? 0
    );
    const panelCount = Number(lead.panel_count ?? 0);
    const systemSizeKw = Number(lead.system_size_kw ?? panelCount * 0.4);
    const report = buildSolarReportFromSolarValues({
      annualSavings,
      annualKwh: Number(lead.annual_energy_kwh ?? 0),
      panelCount,
      systemKw: systemSizeKw,
      monthlyBill: Number(lead.monthly_bill),
    });
    const calculatedScore = calculateLeadScore({
      annualSavings: report.annualSavings,
      email: lead.email,
      energyOffsetPct: lead.energy_offset_pct ?? report.annualEnergyOffset,
      panelCount: report.panelCount,
      pdfDownloaded: lead.pdf_downloaded,
      pdfGenerated: lead.pdf_generated ?? true,
      phone: lead.phone,
      solarSuitabilityScore: lead.solar_suitability_score,
      systemSizeKw,
      twentyYearSavings:
        Number(lead.twenty_year_savings ?? 0) || report.annualSavings * 20,
      utilityBillUploaded: lead.utility_bill_uploaded,
    });
    const storedScore =
      lead.lead_score === null || lead.lead_score === undefined
        ? null
        : Number(lead.lead_score);
    const leadScore = storedScore !== null && Number.isFinite(storedScore)
      ? Math.round(storedScore)
      : calculatedScore.score;

    return {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      monthlyBill: Number(lead.monthly_bill ?? 0),
      createdAt: lead.created_at,
      annualSavings: report.annualSavings,
      co2OffsetLbs: report.annualImpactLbs,
      estimatedRoiYears: Number(lead.roi_years ?? report.estimatedRoiYears),
      panelCount: report.panelCount,
      selectedInverterType: lead.selected_inverter_type ?? null,
      selectedPanelBrand: lead.selected_panel_brand ?? null,
      selectedPanelModel: lead.selected_panel_model ?? null,
      selectedPanelWatts: Number(lead.selected_panel_watts ?? 0) || null,
      energyOffsetPct: Number(lead.energy_offset_pct ?? report.annualEnergyOffset),
      systemCostBeforeIncentives:
        Number(lead.system_cost_before_incentives ?? 0) || null,
      federalTaxCredit: Number(lead.federal_tax_credit ?? 0) || null,
      netSystemCost: Number(lead.net_system_cost ?? 0) || null,
      systemSizeKw,
      leadScore,
      leadScoreExplanation: calculatedScore.explanation,
      leadScoreLabel: normalizeLeadScoreLabel(lead.lead_score_label, leadScore),
      reportUrl: buildReportPdfPath(lead.id),
      status:
        normalizeLeadStatus(lead.status) ??
        getLeadStatus(followUpsByLeadId.get(lead.id) ?? []),
      pdfStatus: "ready",
    };
  });
  const averageLeadScore = crmLeads.length
    ? Math.round(
        crmLeads.reduce((sum, lead) => sum + lead.leadScore, 0) /
          crmLeads.length
      )
    : 0;

  const crmFollowUps: DashboardCrmFollowUp[] = followUpList.map((item) => ({
    id: item.id,
    leadId: item.lead_id,
    stepOrder: item.step_order,
    channel: item.channel,
    title: item.title,
    message: item.body,
    scheduledFor: item.scheduled_for,
    status: item.status as DashboardCrmFollowUp["status"],
    attempts: item.attempts ?? 0,
    processedAt: item.processed_at ?? null,
    deliveryMessage: item.delivery_message ?? null,
  }));

  return (
    <DashboardCrm
      leads={crmLeads}
      followUps={crmFollowUps}
      stats={{
        totalLeads,
        averageSavings,
        queuedFollowUps,
        pdfsGenerated: leadList.length,
        averageLeadScore,
        conversionRate: null,
      }}
    />
  );
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
          Homeowner dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          {configurationMissing ? "Dashboard is not configured." : "Access required."}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          {configurationMissing
            ? "Set DASHBOARD_ACCESS_TOKEN in Vercel to protect lead history before using this dashboard in production."
            : "Enter the dashboard access token to view lead history, PDF links, and follow-up status."}
        </p>

        {configurationMissing ? null : (
          <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              name="token"
              type="password"
              placeholder="Dashboard token"
              className="flex-1 rounded-[1.1rem] border border-white/10 bg-slate-950/45 px-4 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
            />
            <Button type="submit" className="px-5 py-3 text-sm">
              Unlock dashboard
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

function shouldRetryLegacySelect(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find")
  );
}

function getLeadStatus(
  followUps: Array<{ status?: string }>
): DashboardLeadStatus {
  if (followUps.some((followUp) => followUp.status === "sent")) {
    return "contacted";
  }

  if (
    followUps.some(
      (followUp) =>
        followUp.status === "queued" || followUp.status === "scheduled"
    )
  ) {
    return "contacted";
  }

  return "new";
}

function normalizeLeadStatus(value?: string | null): DashboardLeadStatus | null {
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

function describeDashboardIssue(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid api key")) {
    return {
      summary:
        "Supabase rejected `SUPABASE_SERVICE_ROLE_KEY`. The dashboard cannot read saved leads until the service-role key matches the project in `SUPABASE_URL`.",
      detail:
        "In Supabase, open the same project shown in `SUPABASE_URL`, copy a fresh service_role key from Project Settings -> Data API / API Keys, update `SUPABASE_SERVICE_ROLE_KEY` in Vercel and `.env.local`, then redeploy or refresh.",
    };
  }

  if (normalized.includes("relation") || normalized.includes("does not exist")) {
    return {
      summary:
        "The dashboard connected to Supabase, but the lead dashboard tables are missing.",
      detail:
        "Dashboard data is not available yet. Confirm the lead, follow-up, and request event tables are configured for the same Supabase project used by Vercel.",
    };
  }

  return {
    summary:
      "Make sure the dashboard environment variables and Supabase tables are configured in the same project, then refresh this page.",
    detail:
      "If Vercel is pointed at the wrong Supabase project, or the `leads` table was not created there, this page will show the setup warning instead of the data view.",
  };
}
