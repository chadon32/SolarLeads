import type { RoofAnalysis } from "@/lib/roof-analysis";

export type SolarReport = {
  annualSavings: number;
  estimatedRoiYears: number;
  annualImpactLbs: number;
  annualEnergyOffset: number;
  panelCount: number;
};

export function buildSolarReport(monthlyBill: number): SolarReport {
  const annualSavings = Math.round(monthlyBill * 12 * 0.78);
  const estimatedRoiYears = Number(Math.max(4.2, Math.min(8.8, 19.5 - monthlyBill / 110)).toFixed(1));
  const annualImpactLbs = Math.round(annualSavings * 2.48);
  const annualEnergyOffset = Math.min(92, Math.round(58 + monthlyBill / 8));
  const panelCount = Math.max(16, Math.round(monthlyBill / 10));

  return {
    annualSavings,
    estimatedRoiYears,
    annualImpactLbs,
    annualEnergyOffset,
    panelCount,
  };
}

export function buildSolarReportFromAnalysis(
  analysis: RoofAnalysis,
  monthlyBill: number
): SolarReport {
  const annualSavings = analysis.estimatedAnnualSavings;
  const estimatedSystemCost = analysis.estimatedSystemSizeKw * 1000 * 2.8;
  const estimatedRoiYears = Number(
    Math.max(4.2, Math.min(12.8, estimatedSystemCost / Math.max(annualSavings, 1))).toFixed(1)
  );
  const annualImpactLbs = Math.round(analysis.estimatedAnnualEnergyKwh * 1.54);
  const billBasedOffset = Number.isFinite(monthlyBill) && monthlyBill > 0 ? monthlyBill * 12 : 2400;
  const annualEnergyOffset = Math.min(
    96,
    Math.max(42, Math.round((analysis.estimatedAnnualEnergyKwh / billBasedOffset) * 100))
  );

  return {
    annualSavings,
    estimatedRoiYears,
    annualImpactLbs,
    annualEnergyOffset,
    panelCount: analysis.estimatedPanelCount,
  };
}
