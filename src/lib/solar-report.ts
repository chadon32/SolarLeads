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
