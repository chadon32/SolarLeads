import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
  type SolarPanelConfigEstimate,
} from "@/lib/roof-analysis";

export const ARIZONA_AVG_RATE_PER_KWH = 0.13;
export const ARIZONA_AVG_ANNUAL_HOME_KWH = 14_000;
export const STANDARD_PANEL_WATTS = 400;
export const INSTALLED_COST_PER_WATT = 2.75;

const compassLabels = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

export type SharedSolarMetrics = {
  panelCount: number;
  maxPanelCount: number;
  originalCandidateCount: number;
  rejectedCandidateCount: number;
  systemKw: number;
  grossRoofAreaM2: number;
  usableRoofAreaM2: number;
  usablePctRoof: number;
  avgPitchDeg: number;
  annualKwh: number;
  monthlySavings: number;
  annualSavings: number;
  paybackYears: number;
  co2OffsetLbs: number;
  coveragePct: number;
  widthM: number;
  depthM: number;
  primaryOrientationLabel: string;
  annualSunlightHours: number;
};

export function buildSolarMetrics(
  analysis: RoofAnalysis,
  options: {
    monthlyBill?: number | null;
    selectedPanelCount?: number | null;
  } = {}
): SharedSolarMetrics {
  const maxPanelCount = Math.max(
    0,
    analysis.solarPanels.length,
    analysis.acceptedPanelCount ?? 0,
    analysis.panelCount
  );
  const panelCount =
    maxPanelCount > 0
      ? Math.round(
          clamp(options.selectedPanelCount ?? maxPanelCount, 1, maxPanelCount)
        )
      : 0;
  const grossRoofAreaM2 = getRoofAreaM2(analysis);
  const usableRoofAreaM2 = getUsableAreaM2(analysis);
  const avgPitchDeg = getAveragePitchDeg(analysis);
  const annualKwh = getAnnualKwhForPanelCount(analysis, panelCount);
  const utilitySavingsValue = annualKwh * ARIZONA_AVG_RATE_PER_KWH;
  const annualBill =
    options.monthlyBill && options.monthlyBill > 0 ? options.monthlyBill * 12 : null;
  const annualSavings = Math.round(
    annualBill ? annualBill * Math.min(utilitySavingsValue / annualBill, 1) : utilitySavingsValue
  );
  const systemKw = roundTo((panelCount * STANDARD_PANEL_WATTS) / 1000, 1);
  const installedCost = panelCount * STANDARD_PANEL_WATTS * INSTALLED_COST_PER_WATT;
  const netInstalledCost = installedCost * 0.7;
  const paybackYears =
    annualSavings > 0 ? roundTo(netInstalledCost / annualSavings, 1) : 0;
  const carbonFactorKgPerMwh =
    analysis.carbonOffsetFactorKgPerMwh && analysis.carbonOffsetFactorKgPerMwh > 0
      ? analysis.carbonOffsetFactorKgPerMwh
      : 390;

  return {
    panelCount,
    maxPanelCount,
    originalCandidateCount: Math.max(
      analysis.originalPanelCandidateCount ?? maxPanelCount,
      maxPanelCount
    ),
    rejectedCandidateCount: Math.max(
      0,
      analysis.rejectedPanelCandidateCount ??
        (analysis.originalPanelCandidateCount ?? maxPanelCount) - maxPanelCount
    ),
    systemKw,
    grossRoofAreaM2,
    usableRoofAreaM2,
    usablePctRoof: Math.round(
      grossRoofAreaM2 > 0 ? (usableRoofAreaM2 / grossRoofAreaM2) * 100 : 0
    ),
    avgPitchDeg,
    annualKwh,
    monthlySavings: Math.round(annualSavings / 12),
    annualSavings,
    paybackYears,
    co2OffsetLbs: Math.round((annualKwh / 1000) * carbonFactorKgPerMwh * 2.205),
    coveragePct: Math.min(
      100,
      Math.round(
        annualBill
          ? (utilitySavingsValue / annualBill) * 100
          : (annualKwh / ARIZONA_AVG_ANNUAL_HOME_KWH) * 100
      )
    ),
    widthM: roundTo(analysis.widthM, 1),
    depthM: roundTo(analysis.depthM, 1),
    primaryOrientationLabel: formatCompassDirection(analysis.primaryRoofAzimuth),
    annualSunlightHours: analysis.annualSunlightHours,
  };
}

export function formatCompassDirection(value: number) {
  const index = Math.round((((value % 360) + 360) % 360) / 22.5) % compassLabels.length;
  return compassLabels[index];
}

export function findNearestPanelConfig(
  configs: SolarPanelConfigEstimate[],
  panelCount: number
) {
  if (!configs.length || panelCount <= 0) {
    return null;
  }

  return (
    configs.find((config) => config.panelsCount === panelCount) ??
    configs
      .filter((config) => config.panelsCount <= panelCount)
      .at(-1) ??
    configs.reduce((closest, config) =>
      Math.abs(config.panelsCount - panelCount) <
      Math.abs(closest.panelsCount - panelCount)
        ? config
        : closest
    )
  );
}

function getAnnualKwhForPanelCount(analysis: RoofAnalysis, panelCount: number) {
  if (panelCount <= 0) {
    return 0;
  }

  const selectedConfig = findNearestPanelConfig(analysis.solarPanelConfigs, panelCount);
  const panelEnergyTotal = analysis.solarPanels
    .slice(0, panelCount)
    .reduce((sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0), 0);
  const perPanelKwh =
    analysis.panelCount > 0 ? analysis.annualKwh / Math.max(analysis.panelCount, 1) : 0;

  return Math.max(
    0,
    Math.round(
      selectedConfig?.yearlyEnergyDcKwh ??
        (panelEnergyTotal > 0 ? panelEnergyTotal : perPanelKwh * panelCount)
    )
  );
}

function getAveragePitchDeg(analysis: RoofAnalysis) {
  if (!analysis.roofSegments.length) {
    return roundTo(analysis.pitchDeg, 1);
  }

  return roundTo(
    analysis.roofSegments.reduce(
      (sum, segment) => sum + Math.max(segment.pitchDeg, 0),
      0
    ) / analysis.roofSegments.length,
    1
  );
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
