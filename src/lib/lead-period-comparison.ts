import { dashboardDay, type DashboardPeriod } from "./dashboard-analytics";
import { CONTACT_REQUEST_LABELS, type ContactRequest } from "./dashboard-contact";
import type { LeadStatus } from "./lead-status";

type Submission = { status: LeadStatus; createdAt: string; contact: { request: ContactRequest } };
const metrics = { total: "Lead submissions", ...CONTACT_REQUEST_LABELS } as const;
const dayMs = 86_400_000;
const keyFor = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
const counts = () => ({ total: 0, requested: 0, report: 0, unknown: 0 });

export function compareLeadPeriods(leads: Submission[], period: DashboardPeriod, asOf: string, includeTests: boolean, limited: boolean) {
  if (period === "all") return { mode: "all" } as const;
  const day = dashboardDay(asOf);
  if (!day) return { mode: "undated" } as const;
  const days = Number(period);
  const today = Date.parse(day + "T00:00:00Z") / dayMs;
  const recent = { start: keyFor(today - days), end: keyFor(today - 1), counts: counts() };
  const previous = { start: keyFor(today - days * 2), end: keyFor(today - days - 1), counts: counts() };
  let oldest: string | null = null;
  let unplaceable = false;
  for (const lead of leads) {
    const submitted = lead.createdAt ? dashboardDay(lead.createdAt) : null;
    if (submitted && (oldest === null || submitted < oldest)) oldest = submitted;
    if (!includeTests && lead.status === "test-lead") continue;
    if (!submitted) { unplaceable = true; continue; }
    const window = submitted >= recent.start && submitted <= recent.end ? recent
      : submitted >= previous.start && submitted <= previous.end ? previous : null;
    if (!window) continue;
    window.counts.total++;
    window.counts[lead.contact.request]++;
  }
  // The server loads newest first. Older omitted rows can tie the oldest loaded day.
  const covered = (start: string) => !unplaceable && (!limited || (oldest !== null && oldest < start));
  const recentCovered = covered(recent.start);
  const previousCovered = covered(previous.start);
  const rows = (Object.keys(metrics) as (keyof typeof metrics)[]).map(key => {
    const current = recentCovered ? recent.counts[key] : null;
    const prior = previousCovered ? previous.counts[key] : null;
    return { label: metrics[key], recent: current, previous: prior, change: current === null || prior === null ? null : current - prior };
  });
  return { mode: "comparison", recent: { start: recent.start, end: recent.end }, previous: { start: previous.start, end: previous.end },
    days, rows, recentCovered, previousCovered, unplaceable, includeTests } as const;
}

export type LeadPeriodComparison = ReturnType<typeof compareLeadPeriods>;

export function comparisonCsv(data: Extract<LeadPeriodComparison, { mode: "comparison" }>) {
  const lines = [["metric", "recent_start_phoenix", "recent_end_phoenix", "recent_count", "previous_start_phoenix",
    "previous_end_phoenix", "previous_count", "change_in_count", "test_leads_included"]];
  for (const row of data.rows) lines.push([row.label, data.recent.start, data.recent.end, String(row.recent ?? "Unavailable"),
    data.previous.start, data.previous.end, String(row.previous ?? "Unavailable"), String(row.change ?? "Unavailable"), String(data.includeTests)]);
  return lines.map(line => line.join(",")).join("\r\n") + "\r\n";
}
