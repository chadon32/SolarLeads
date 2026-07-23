import {
  ARIZONA_AVG_RATE_PER_KWH,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
  calculateEnergyOffsetPct,
} from "@/lib/solar-metrics";
import type { SolarReportSnapshot } from "@/lib/report-snapshot";
import {
  calculateFederalResidentialSolarCredit,
  calculateTwentyYearSolarCosts,
} from "@/lib/financial-model";

export type LeadSubmissionNumberInput = {
  annualEnergyKwh?: number | null;
  annualSavings?: number | null;
  batteryCost?: number | null;
  batteryAdded?: boolean | null;
  energyOffsetPct?: number | null;
  federalTaxCredit?: number | null;
  installedCostPerWatt?: number | null;
  monthlyBill?: number | null;
  monthlySavings?: number | null;
  netSystemCost?: number | null;
  panelCount?: number | null;
  selectedPanelWatts?: number | null;
  systemCostBeforeIncentives?: number | null;
  systemSizeKw?: number | null;
  twentyYearSavings?: number | null;
};

export type LeadSubmissionNumbers = {
  annualEnergyKwh: number | null;
  annualSavings: number | null;
  energyOffsetPct: number | null;
  federalTaxCredit: number | null;
  monthlyBill: number;
  monthlySavings: number | null;
  netSystemCost: number | null;
  panelCount: number | null;
  roiYears: number | null;
  systemCostBeforeIncentives: number | null;
  systemSizeKw: number | null;
  twentyYearSavings: number | null;
};

export function deriveLeadSubmissionNumbers(
  input: LeadSubmissionNumberInput,
  snapshot: SolarReportSnapshot | null
): LeadSubmissionNumbers {
  const metrics = snapshot?.metrics ?? null;
  const monthlyBill =
    positiveNumber(input.monthlyBill) ??
    positiveNumber(snapshot?.monthlyBill) ??
    Number.NaN;
  const panelCount =
    positiveInteger(snapshot?.panelCount) ??
    positiveInteger(metrics?.panelCount) ??
    positiveInteger(input.panelCount);
  const panelWatts =
    positiveNumber(input.selectedPanelWatts) ?? STANDARD_PANEL_WATTS;
  const systemSizeKw =
    positiveNumber(metrics?.systemKw) ??
    positiveNumber(input.systemSizeKw) ??
    (panelCount ? roundTo((panelCount * panelWatts) / 1000, 2) : null);
  const annualSavings =
    positiveNumber(metrics?.annualSavings) ?? positiveNumber(input.annualSavings);
  const annualEnergyKwh =
    positiveNumber(metrics?.annualKwh) ??
    positiveNumber(input.annualEnergyKwh) ??
    (annualSavings ? Math.round(annualSavings / ARIZONA_AVG_RATE_PER_KWH) : null);
  const monthlySavings =
    nonNegativeNumber(metrics?.monthlySavings) ??
    nonNegativeNumber(input.monthlySavings) ??
    (annualSavings ? Math.round(annualSavings / 12) : null);
  const batteryCost = input.batteryAdded
    ? nonNegativeNumber(input.batteryCost) ?? 0
    : 0;
  const solarSystemCost =
    systemSizeKw
      ? Math.round(
          systemSizeKw *
            1000 *
            (positiveNumber(input.installedCostPerWatt) ??
              INSTALLED_COST_PER_WATT)
        )
      : panelCount
        ? Math.round(panelCount * panelWatts * INSTALLED_COST_PER_WATT)
        : null;
  const systemCostBeforeIncentives =
    solarSystemCost !== null
      ? solarSystemCost + batteryCost
      : positiveNumber(input.systemCostBeforeIncentives);
  const federalTaxCredit =
    systemCostBeforeIncentives !== null
      ? calculateFederalResidentialSolarCredit(systemCostBeforeIncentives)
      : nonNegativeNumber(input.federalTaxCredit);
  const netSystemCost =
    systemCostBeforeIncentives !== null && federalTaxCredit !== null
      ? Math.max(systemCostBeforeIncentives - federalTaxCredit, 0)
      : nonNegativeNumber(input.netSystemCost);
  const energyOffsetPct =
    percentNumber(metrics?.coveragePct) ??
    percentNumber(input.energyOffsetPct) ??
    (annualEnergyKwh && Number.isFinite(monthlyBill) && monthlyBill > 0
      ? calculateEnergyOffsetPct(annualEnergyKwh, monthlyBill)
      : null);
  const twentyYearSavings =
    annualSavings !== null &&
    Number.isFinite(monthlyBill) &&
    monthlyBill > 0 &&
    netSystemCost !== null
      ? calculateTwentyYearSolarCosts({
          annualSavings,
          monthlyBill,
          totalSolarPayments: netSystemCost,
        }).totalSavings
      : nonNegativeNumber(input.twentyYearSavings);
  const roiYears =
    annualSavings && annualSavings > 0 && netSystemCost !== null && netSystemCost > 0
      ? roundTo(netSystemCost / annualSavings, 1)
      : null;

  return {
    annualEnergyKwh,
    annualSavings,
    energyOffsetPct,
    federalTaxCredit,
    monthlyBill,
    monthlySavings,
    netSystemCost,
    panelCount,
    roiYears,
    systemCostBeforeIncentives,
    systemSizeKw,
    twentyYearSavings,
  };
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function percentNumber(value: unknown) {
  const parsed = nonNegativeNumber(value);

  return parsed === null ? null : Math.min(100, parsed);
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
