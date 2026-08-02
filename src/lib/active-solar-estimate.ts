import {
  calculateFederalResidentialSolarCredit,
  calculateTwentyYearSolarCosts,
} from "@/lib/financial-model";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import {
  buildSolarMetrics,
  calculateEnergyOffsetPct,
  getRecommendedPanelCount,
  type SharedSolarMetrics,
} from "@/lib/solar-metrics";
import { getPanelFit, type PanelFit, type SolarPanel } from "@/lib/solarPanels";

/**
 * The homeowner-facing estimate currently being adjusted in the UI.
 * Keep every surface on this model so an active panel selection cannot drift
 * into different savings, payback, or 20-year values elsewhere in the app.
 */
export type ActiveSolarEstimate = {
  baseMetrics: SharedSolarMetrics;
  billWithSolar: number;
  energyOffsetPct: number;
  excludedCandidateCount: number;
  installedCost: number;
  maxPanelCount: number;
  monthlySavings: number;
  netCostAfterCredit: number;
  panelCount: number;
  recommendedPanelCount: number;
  remainingPanelCapacity: number;
  selectedPanelFit: PanelFit;
  taxCredit: number;
  twentyYearCashCosts: ReturnType<typeof calculateTwentyYearSolarCosts>;
  annualKwh: number;
  annualSavings: number;
  paybackYears: number;
  systemKw: number;
};

export function buildActiveSolarEstimate({
  analysis,
  batteryCost = 0,
  inverterCostAdderPerWatt = 0,
  monthlyBill,
  selectedPanel,
  selectedPanelCount,
}: {
  analysis: RoofAnalysis;
  batteryCost?: number | null;
  inverterCostAdderPerWatt?: number | null;
  monthlyBill?: number | null;
  selectedPanel: SolarPanel;
  selectedPanelCount?: number | null;
}): ActiveSolarEstimate {
  const roofMetrics = buildSolarMetrics(analysis);
  const roofModelMaxPanelCount = Math.max(0, roofMetrics.maxPanelCount);
  const moduleCapacity = getPanelFit(selectedPanel, {
    roofData: analysis,
    monthlyBill,
    inverterCostAdderPerWatt: finiteNumber(inverterCostAdderPerWatt),
  }).maxPanelsFit;
  const maxPanelCount = Math.max(
    0,
    Math.min(
      roofModelMaxPanelCount,
      moduleCapacity > 0 ? moduleCapacity : roofModelMaxPanelCount
    )
  );
  const recommendedPanelCount = clamp(
    getRecommendedPanelCount(analysis, { monthlyBill }),
    maxPanelCount > 0 ? 1 : 0,
    maxPanelCount
  );
  const requestedPanelCount = positiveInteger(selectedPanelCount);
  const panelCount =
    maxPanelCount > 0
      ? clamp(requestedPanelCount ?? recommendedPanelCount, 1, maxPanelCount)
      : 0;
  const baseMetrics = buildSolarMetrics(analysis, {
    monthlyBill,
    selectedPanelCount: panelCount,
  });
  const selectedPanelFit = getPanelFit(selectedPanel, {
    roofData: analysis,
    monthlyBill,
    selectedPanelCount: panelCount,
    inverterCostAdderPerWatt: finiteNumber(inverterCostAdderPerWatt),
  });
  const annualKwh = selectedPanelFit.annualKwh;
  const annualSavings = selectedPanelFit.annualSavings;
  const monthlySavings = Math.round(annualSavings / 12);
  const installedCost = Math.round(
    selectedPanelFit.systemCost + Math.max(0, finiteNumber(batteryCost))
  );
  const taxCredit = calculateFederalResidentialSolarCredit(installedCost);
  const netCostAfterCredit = Math.max(installedCost - taxCredit, 0);
  const paybackYears =
    annualSavings > 0 ? roundTo(netCostAfterCredit / annualSavings, 1) : 0;
  const safeMonthlyBill = Math.max(0, finiteNumber(monthlyBill));
  const energyOffsetPct = calculateEnergyOffsetPct(annualKwh, safeMonthlyBill);
  const rawCandidateCount = Math.max(
    baseMetrics.originalCandidateCount,
    analysis.originalPanelCandidateCount ?? 0
  );
  const excludedCandidateCount = Math.max(0, rawCandidateCount - maxPanelCount);
  const remainingPanelCapacity = Math.max(0, maxPanelCount - panelCount);
  const twentyYearCashCosts = calculateTwentyYearSolarCosts({
    annualSavings,
    monthlyBill: safeMonthlyBill,
    totalSolarPayments: netCostAfterCredit,
  });

  return {
    annualKwh,
    annualSavings,
    baseMetrics,
    billWithSolar: Math.max(safeMonthlyBill - monthlySavings, 0),
    energyOffsetPct,
    excludedCandidateCount,
    installedCost,
    maxPanelCount,
    monthlySavings,
    netCostAfterCredit,
    panelCount: selectedPanelFit.maxPanelsFit,
    paybackYears,
    recommendedPanelCount,
    remainingPanelCapacity,
    selectedPanelFit,
    systemKw: selectedPanelFit.systemKw,
    taxCredit,
    twentyYearCashCosts,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
