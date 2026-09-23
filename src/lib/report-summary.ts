import type { SolarReportSnapshot } from "@/lib/report-snapshot";
import { nonNegativeNumberOrNull } from "@/lib/dashboard-data";

type SavedReportValues = {
  annual_savings?: number | null;
  estimated_savings?: number | null;
  system_size_kw?: number | null;
  panel_count?: number | null;
  roi_years?: number | null;
  energy_offset_pct?: number | null;
};

/** Missing stored metrics are unknown, not zero or a new generic estimate. */
export function buildSavedReportSummary(
  lead: SavedReportValues,
  snapshot: SolarReportSnapshot | null
) {
  const metrics = snapshot?.metrics;
  return {
    annualSavings: firstKnown(metrics?.annualSavings, lead.annual_savings, lead.estimated_savings),
    systemSizeKw: firstKnown(metrics?.systemKw, lead.system_size_kw),
    panelCount: firstKnown(snapshot?.panelCount, metrics?.panelCount, lead.panel_count),
    roiYears: firstKnown(metrics?.paybackYears, lead.roi_years),
    energyOffset: firstKnown(metrics?.coveragePct, lead.energy_offset_pct),
  };
}

export function formatSavedReportValue(
  value: number | null,
  unit: "money" | "kw" | "panels" | "years" | "percent"
) {
  if (value === null || !Number.isFinite(value) || value < 0 || (unit === "years" && value === 0)) {
    return "Unavailable";
  }
  if (unit === "money") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  const digits = unit === "kw" || unit === "years" ? 1 : 0;
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
  const suffix = { kw: " kW", panels: "", years: " yrs", percent: "%" };
  return `${formatted}${suffix[unit]}`;
}

function firstKnown(...values: unknown[]) {
  for (const value of values) {
    const parsed = nonNegativeNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}
