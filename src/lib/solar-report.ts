import type { RoofAnalysis } from "@/lib/roof-analysis";
import { buildSolarMetrics } from "@/lib/solar-metrics";

export type SolarReport = {
  annualSavings: number;
  estimatedRoiYears: number;
  annualImpactLbs: number;
  annualEnergyOffset: number;
  panelCount: number;
};

type SolarReportValues = {
  annualSavings: number;
  panelCount: number;
  annualKwh?: number | null;
  systemKw?: number | null;
  monthlyBill?: number | null;
};

export function buildSolarReportFromSolarValues(values: SolarReportValues): SolarReport {
  const annualSavings = Math.max(
    0,
    Math.round(toFiniteNumber(values.annualSavings))
  );
  const panelCount = Math.max(0, Math.round(toFiniteNumber(values.panelCount)));
  const annualKwh =
    toFiniteNumber(values.annualKwh) > 0
      ? Number(values.annualKwh)
      : annualSavings > 0
        ? annualSavings / 0.13
        : 0;
  const systemKw =
    toFiniteNumber(values.systemKw) > 0
      ? Number(values.systemKw)
      : (panelCount * 400) / 1000;
  const estimatedSystemCost =
    panelCount > 0
      ? panelCount * 400 * 2.75
      : systemKw > 0
        ? systemKw * 1000 * 2.75
        : 0;
  const estimatedRoiYears =
    annualSavings > 0
      ? Number((estimatedSystemCost / annualSavings).toFixed(1))
      : 0;
  const annualImpactLbs = Math.round(annualKwh * 0.39 * 2.205);
  const annualHouseholdKwh =
    toFiniteNumber(values.monthlyBill) > 0
      ? (Number(values.monthlyBill) * 12) / 0.13
      : 0;
  const annualEnergyOffset =
    annualHouseholdKwh > 0
      ? Math.min(100, Math.round((annualKwh / annualHouseholdKwh) * 100))
      : 0;

  return {
    annualSavings,
    estimatedRoiYears,
    annualImpactLbs,
    annualEnergyOffset,
    panelCount,
  };
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildSolarReportFromAnalysis(
  analysis: RoofAnalysis,
  monthlyBill: number
): SolarReport {
  const metrics = buildSolarMetrics(analysis);

  return buildSolarReportFromSolarValues({
    annualSavings: metrics.annualSavings,
    annualKwh: metrics.annualKwh,
    panelCount: metrics.panelCount,
    systemKw: metrics.systemKw,
    monthlyBill,
  });
}
