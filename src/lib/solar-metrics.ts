import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
  type RoofGeoBounds,
  type SolarPanelConfigEstimate,
} from "@/lib/roof-analysis";
import { calculateFederalResidentialSolarCredit } from "@/lib/financial-model";
import {
  ARIZONA_AVG_ANNUAL_HOME_KWH,
  ARIZONA_AVG_RATE_PER_KWH,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
} from "@/lib/solar-assumptions";

export {
  ARIZONA_AVG_ANNUAL_HOME_KWH,
  ARIZONA_AVG_RATE_PER_KWH,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
} from "@/lib/solar-assumptions";

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

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Planning allowances only. An installer must replace these with the
 * setbacks, pathways, obstructions, and module spacing required for the site.
 */
export const PRELIMINARY_ROOF_EDGE_RESERVE_METERS = 0.9144;
export const PRELIMINARY_PANEL_PACKING_FACTOR = 0.85;

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

/** Raw module candidates returned by the roof model before planning reserves. */
export function getProviderPanelCandidateCount(analysis: RoofAnalysis) {
  if (analysis.solarPanels.length > 0) {
    return analysis.solarPanels.length;
  }

  return Math.max(
    0,
    analysis.acceptedPanelCount ?? 0,
    analysis.panelCount
  );
}

/**
 * Conservative preliminary ceiling used by homeowner-facing controls.
 *
 * Each usable roof plane is evaluated independently so attached garages are
 * included without treating the entire building as one perfectly packable
 * rectangle. The result reserves three feet around every modeled plane, adds
 * a 15% layout allowance, and never exceeds the provider candidate count.
 */
export function getMaxPanelCount(analysis: RoofAnalysis) {
  const providerCandidateCount = getProviderPanelCandidateCount(analysis);

  if (providerCandidateCount <= 0) {
    return 0;
  }

  const panelAreaM2 = Math.max(
    analysis.panelWidthMeters * analysis.panelHeightMeters,
    0.1
  );
  const placementCounts = new Map<number, number>();

  for (const panel of analysis.solarPanels) {
    placementCounts.set(
      panel.segmentIndex,
      (placementCounts.get(panel.segmentIndex) ?? 0) + 1
    );
  }

  let preliminaryCapacity = 0;
  let segmentsWithCandidates = 0;

  analysis.roofSegments.forEach((segment, index) => {
    if (!segment.usable || segment.areaM2 <= 0) {
      return;
    }

    const segmentIndex = segment.segmentIndex ?? index;
    const placementCount = placementCounts.get(segmentIndex) ?? 0;
    const candidateCount =
      analysis.solarPanels.length > 0
        ? placementCount
        : Math.max(segment.panelsFit, 0);

    if (candidateCount <= 0) {
      return;
    }

    segmentsWithCandidates += 1;
    const insetRatio = getInsetAreaRatio(
      segment.bounds,
      PRELIMINARY_ROOF_EDGE_RESERVE_METERS
    );
    const areaLimitedCapacity = Math.max(
      0,
      Math.floor(
        (segment.areaM2 * insetRatio * PRELIMINARY_PANEL_PACKING_FACTOR) /
          panelAreaM2
      )
    );

    preliminaryCapacity += Math.min(candidateCount, areaLimitedCapacity);
  });

  if (segmentsWithCandidates > 0) {
    return Math.min(providerCandidateCount, preliminaryCapacity);
  }

  const wholeRoofInsetRatio = getDimensionInsetAreaRatio(
    analysis.widthM,
    analysis.depthM,
    PRELIMINARY_ROOF_EDGE_RESERVE_METERS
  );
  const areaLimitedCapacity = Math.max(
    0,
    Math.floor(
      (getUsableAreaM2(analysis) *
        wholeRoofInsetRatio *
        PRELIMINARY_PANEL_PACKING_FACTOR) /
        panelAreaM2
    )
  );

  return Math.min(providerCandidateCount, areaLimitedCapacity);
}

/**
 * Annual kWh a practical default should try to cover: bill-based usage when
 * known, otherwise a typical Arizona home.
 */
export function getTargetAnnualUsageKwh(monthlyBill?: number | null) {
  if (monthlyBill && monthlyBill > 0) {
    return (monthlyBill * 12) / ARIZONA_AVG_RATE_PER_KWH;
  }

  return ARIZONA_AVG_ANNUAL_HOME_KWH;
}

/**
 * Practical default system size: smallest layout that covers ~100% of the
 * target annual usage (bill or AZ average), capped at max roof capacity.
 * Raw provider packing is never used as the homeowner-facing upper bound.
 */
export function getRecommendedPanelCount(
  analysis: RoofAnalysis,
  options: { monthlyBill?: number | null } = {}
) {
  return getRecommendedPanelCountForTarget({
    maxPanelCount: getMaxPanelCount(analysis),
    solarPanelConfigs: analysis.solarPanelConfigs,
    solarPanels: analysis.solarPanels,
    targetAnnualKwh: getTargetAnnualUsageKwh(options.monthlyBill),
    fallbackAnnualKwh:
      analysis.panelCount > 0
        ? analysis.annualKwh / Math.max(analysis.panelCount, 1)
        : 0,
  });
}

export function getRecommendedPanelCountForTarget(params: {
  maxPanelCount: number;
  solarPanelConfigs: SolarPanelConfigEstimate[];
  solarPanels: Array<{ yearlyEnergyDcKwh: number }>;
  targetAnnualKwh: number;
  fallbackAnnualKwh?: number;
}) {
  const maxPanelCount = Math.max(0, Math.floor(params.maxPanelCount));
  if (maxPanelCount <= 0) {
    return 0;
  }

  const targetAnnualKwh = Math.max(0, params.targetAnnualKwh);
  const configs = [...params.solarPanelConfigs]
    .filter((config) => config.panelsCount > 0 && config.yearlyEnergyDcKwh > 0)
    .sort((left, right) => left.panelsCount - right.panelsCount);

  let recommended = maxPanelCount;

  if (configs.length) {
    const meetingTarget = configs.find(
      (config) => config.yearlyEnergyDcKwh >= targetAnnualKwh
    );
    recommended = meetingTarget?.panelsCount ?? configs.at(-1)!.panelsCount;
  } else if (params.solarPanels.length) {
    let energySum = 0;
    recommended = maxPanelCount;
    for (let index = 0; index < params.solarPanels.length; index += 1) {
      energySum += Math.max(params.solarPanels[index]?.yearlyEnergyDcKwh ?? 0, 0);
      if (energySum >= targetAnnualKwh) {
        recommended = index + 1;
        break;
      }
    }
  } else if (params.fallbackAnnualKwh && params.fallbackAnnualKwh > 0) {
    recommended = Math.ceil(targetAnnualKwh / params.fallbackAnnualKwh);
  }

  // Keep a usable residential floor when the roof can support it, without
  // forcing max packing on large multi-face homes.
  const practicalFloor = Math.min(8, maxPanelCount);
  recommended = Math.max(practicalFloor, Math.floor(recommended));

  return clamp(recommended, 1, maxPanelCount);
}

export function buildSolarMetrics(
  analysis: RoofAnalysis,
  options: {
    monthlyBill?: number | null;
    selectedPanelCount?: number | null;
  } = {}
): SharedSolarMetrics {
  const maxPanelCount = getMaxPanelCount(analysis);
  const defaultPanelCount = getRecommendedPanelCount(analysis, {
    monthlyBill: options.monthlyBill,
  });
  const panelCount =
    maxPanelCount > 0
      ? Math.floor(
          clamp(
            options.selectedPanelCount ?? defaultPanelCount,
            1,
            maxPanelCount
          )
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
  const netInstalledCost =
    installedCost - calculateFederalResidentialSolarCredit(installedCost);
  const paybackYears =
    annualSavings > 0 ? roundTo(netInstalledCost / annualSavings, 1) : 0;
  const carbonFactorKgPerMwh =
    analysis.carbonOffsetFactorKgPerMwh && analysis.carbonOffsetFactorKgPerMwh > 0
      ? analysis.carbonOffsetFactorKgPerMwh
      : 390;
  const originalCandidateCount = Math.max(
    analysis.originalPanelCandidateCount ?? 0,
    getProviderPanelCandidateCount(analysis),
    maxPanelCount
  );
  const rejectedCandidateCount = Math.max(
    analysis.rejectedPanelCandidateCount ?? 0,
    originalCandidateCount - maxPanelCount,
    0
  );

  return {
    panelCount,
    maxPanelCount,
    originalCandidateCount,
    rejectedCandidateCount,
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
    coveragePct: annualBill
      ? calculateEnergyOffsetPct(annualKwh, options.monthlyBill)
      : Math.min(100, Math.round((annualKwh / ARIZONA_AVG_ANNUAL_HOME_KWH) * 100)),
    widthM: roundTo(analysis.widthM, 1),
    depthM: roundTo(analysis.depthM, 1),
    primaryOrientationLabel: formatCompassDirection(analysis.primaryRoofAzimuth),
    annualSunlightHours: analysis.annualSunlightHours,
  };
}

export function calculateEnergyOffsetPct(
  annualKwh: number | null | undefined,
  monthlyBill: number | null | undefined,
  ratePerKwh = ARIZONA_AVG_RATE_PER_KWH
) {
  const kwh = Number(annualKwh);
  const bill = Number(monthlyBill);
  const rate = Number(ratePerKwh);

  if (!Number.isFinite(kwh) || kwh <= 0) {
    return 0;
  }

  if (!Number.isFinite(bill) || bill <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(((kwh * rate) / (bill * 12)) * 100)));
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

function getInsetAreaRatio(
  bounds: RoofGeoBounds | null,
  edgeReserveMeters: number
) {
  if (!bounds) {
    return 1;
  }

  const centerLat = (bounds.northeast.lat + bounds.southwest.lat) / 2;
  const widthM =
    Math.abs(bounds.northeast.lng - bounds.southwest.lng) *
    METERS_PER_DEGREE_LAT *
    Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const depthM =
    Math.abs(bounds.northeast.lat - bounds.southwest.lat) *
    METERS_PER_DEGREE_LAT;

  return getDimensionInsetAreaRatio(widthM, depthM, edgeReserveMeters);
}

function getDimensionInsetAreaRatio(
  widthM: number,
  depthM: number,
  edgeReserveMeters: number
) {
  if (widthM <= 0 || depthM <= 0) {
    return 1;
  }

  const insetWidthM = Math.max(0, widthM - edgeReserveMeters * 2);
  const insetDepthM = Math.max(0, depthM - edgeReserveMeters * 2);

  return clamp((insetWidthM * insetDepthM) / (widthM * depthM), 0, 1);
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
