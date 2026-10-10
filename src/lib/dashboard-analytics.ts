import { LEAD_STATUS_OPTIONS, type LeadStatus } from "@/lib/lead-status";
import { averageKnown, sumKnown } from "@/lib/dashboard-data";

export const DASHBOARD_RECORD_LIMIT = 500;
export type DashboardView =
  "overview" | "pipeline" | "analytics" | "follow-ups";
export type DashboardPeriod = "7" | "30" | "90" | "all";

export function normalizeDashboardView(value: unknown): DashboardView {
  return value === "pipeline" || value === "analytics" || value === "follow-ups"
    ? value
    : "overview";
}

type MetricLead = {
  id: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string | null;
  annualSavings: number | null;
  systemCostBeforeIncentives: number | null;
  leadScore: number | null;
  pdfStatus: "ready" | "pending";
  utilityBillUploaded: boolean;
  selectedPanelBrand: string | null;
  referredBy: string | null;
  dataQuality: "complete" | "partial" | "legacy";
};

const phoenixDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Phoenix",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DAY_MS = 86_400_000;

export function dashboardDay(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = phoenixDay.formatToParts(date);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(day: string) {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;
}

export function scopeDashboardLeads<T extends MetricLead>(
  leads: T[],
  period: DashboardPeriod,
  includeTests: boolean,
  now: string,
) {
  const today = dashboardDay(now);
  if (!today) return [];
  const cutoff =
    period === "all" ? -Infinity : dayNumber(today) - Number(period) + 1;
  return leads.filter((lead) => {
    if (!includeTests && lead.status === "test-lead") return false;
    const createdDay = dashboardDay(lead.createdAt);
    return Boolean(
      createdDay &&
      dayNumber(createdDay) >= cutoff &&
      dayNumber(createdDay) <= dayNumber(today),
    );
  });
}

export function buildDashboardAnalytics<T extends MetricLead>(
  leads: T[],
  now: string,
  period: DashboardPeriod,
) {
  const today = dashboardDay(now) ?? "1970-01-01";
  const todayNumber = dayNumber(today);
  const open = leads.filter((lead) =>
    ["new", "contacted", "quoted"].includes(lead.status),
  );
  const won = leads.filter((lead) => lead.status === "closed-won").length;
  const lost = leads.filter((lead) => lead.status === "closed-lost").length;
  const stages = LEAD_STATUS_OPTIONS.map((stage) => ({
    ...stage,
    count: leads.filter((lead) => lead.status === stage.id).length,
    value: sumKnown(
      leads
        .filter((lead) => lead.status === stage.id)
        .map((lead) => lead.systemCostBeforeIncentives),
    ),
  }));
  const brandCounts = new Map<string, number>();
  for (const lead of leads) {
    const brand = lead.selectedPanelBrand?.trim() || "Not captured";
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
  }
  const trendDays = period === "all" ? 30 : Number(period);
  const dayCounts = new Map<string, number>();
  for (const lead of leads) {
    const day = dashboardDay(lead.createdAt);
    if (day) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const trend = Array.from({ length: trendDays }, (_, index) => {
    const day = new Date((todayNumber - trendDays + index + 1) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    return { day, count: dayCounts.get(day) ?? 0 };
  });
  const stale = open.filter((lead) => {
    const updated = dashboardDay(lead.updatedAt ?? lead.createdAt);
    return updated !== null && todayNumber - dayNumber(updated) >= 7;
  });
  return {
    total: leads.length,
    open: open.length,
    won,
    lost,
    winRate: won + lost > 0 ? (won / (won + lost)) * 100 : null,
    openValue: sumKnown(open.map((lead) => lead.systemCostBeforeIncentives)),
    openValueKnown: open.filter(
      (lead) => lead.systemCostBeforeIncentives !== null,
    ).length,
    averageSavings: averageKnown(leads.map((lead) => lead.annualSavings)),
    averageScore: averageKnown(leads.map((lead) => lead.leadScore)),
    today: dayCounts.get(today) ?? 0,
    newLeads: leads.filter((lead) => lead.status === "new"),
    stale,
    reportsReady: leads.filter((lead) => lead.pdfStatus === "ready").length,
    billsUploaded: leads.filter((lead) => lead.utilityBillUploaded).length,
    completeModels: leads.filter((lead) => lead.dataQuality === "complete")
      .length,
    referrals: leads.filter((lead) => Boolean(lead.referredBy)).length,
    stages,
    brands: [...brandCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    trend,
    trendDays,
  };
}

export type DashboardAnalytics = ReturnType<typeof buildDashboardAnalytics>;
