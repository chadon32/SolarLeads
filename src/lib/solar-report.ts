import type { RoofAnalysis } from "@/lib/roof-analysis";
import {
  calculateFederalResidentialSolarCredit,
  calculateTwentyYearSolarCosts,
} from "@/lib/financial-model";
import {
  ARIZONA_AVG_RATE_PER_KWH,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
} from "@/lib/solar-assumptions";
import { buildSolarMetrics, calculateEnergyOffsetPct } from "@/lib/solar-metrics";

export type SolarReport = {
  annualSavings: number;
  estimatedRoiYears: number;
  annualImpactLbs: number;
  annualEnergyOffset: number;
  netSystemCost: number;
  panelCount: number;
  systemCostBeforeIncentives: number;
  twentyYearSavings: number;
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
  const panelCount = Math.max(0, Math.floor(toFiniteNumber(values.panelCount)));
  const annualKwh =
    toFiniteNumber(values.annualKwh) > 0
      ? Number(values.annualKwh)
      : annualSavings > 0
        ? annualSavings / ARIZONA_AVG_RATE_PER_KWH
        : 0;
  const systemKw =
    toFiniteNumber(values.systemKw) > 0
      ? Number(values.systemKw)
      : (panelCount * STANDARD_PANEL_WATTS) / 1000;
  const estimatedSystemCost =
    panelCount > 0
      ? panelCount * STANDARD_PANEL_WATTS * INSTALLED_COST_PER_WATT
      : systemKw > 0
        ? systemKw * 1000 * INSTALLED_COST_PER_WATT
        : 0;
  const netEstimatedSystemCost =
    estimatedSystemCost -
    calculateFederalResidentialSolarCredit(estimatedSystemCost);
  const estimatedRoiYears =
    annualSavings > 0
      ? Number((netEstimatedSystemCost / annualSavings).toFixed(1))
      : 0;
  const annualImpactLbs = Math.round(annualKwh * 0.39 * 2.205);
  const annualHouseholdKwh =
    toFiniteNumber(values.monthlyBill) > 0
      ? (Number(values.monthlyBill) * 12) / ARIZONA_AVG_RATE_PER_KWH
      : 0;
  const annualEnergyOffset =
    annualHouseholdKwh > 0
      ? calculateEnergyOffsetPct(annualKwh, Number(values.monthlyBill))
      : 0;
  const twentyYearSavings = calculateTwentyYearSolarCosts({
    annualSavings,
    monthlyBill: toFiniteNumber(values.monthlyBill),
    totalSolarPayments: netEstimatedSystemCost,
  }).totalSavings;

  return {
    annualSavings,
    estimatedRoiYears,
    annualImpactLbs,
    annualEnergyOffset,
    netSystemCost: netEstimatedSystemCost,
    panelCount,
    systemCostBeforeIncentives: estimatedSystemCost,
    twentyYearSavings,
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
  const metrics = buildSolarMetrics(analysis, { monthlyBill });

  return buildSolarReportFromSolarValues({
    annualSavings: metrics.annualSavings,
    annualKwh: metrics.annualKwh,
    panelCount: metrics.panelCount,
    systemKw: metrics.systemKw,
    monthlyBill,
  });
}
