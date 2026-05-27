export type RoofViewport = {
  northeast: {
    lat: number;
    lng: number;
  };
  southwest: {
    lat: number;
    lng: number;
  };
};

export type RoofAnalysis = {
  zoom: number;
  usableRoofPercent: number;
  estimatedPanelCount: number;
  estimatedSystemSizeKw: number;
  estimatedAnnualSavings: number;
  estimatedMonthlySavings: number;
  estimatedAnnualEnergyKwh: number;
  estimatedRoofAreaSqm: number;
  estimatedUsableSolarAreaSqm: number;
  estimatedRoofLengthMeters: number;
  estimatedRoofWidthMeters: number;
  roofPitchDegrees: number;
  maxPanelCount: number;
  sunshineHours: number | null;
  source: "solar-api" | "modeled";
  confidence: "low" | "medium" | "high";
};

export type SolarBuildingInsights = {
  solarPotential?: {
    panelCapacityWatts?: number;
    maxArrayPanelsCount?: number;
    maxSunshineHoursPerYear?: number;
    wholeRoofStats?: {
      areaMeters2?: number;
    };
    roofSegmentStats?: Array<{
      pitchDegrees?: number;
      stats?: {
        areaMeters2?: number;
      };
    }>;
    solarPanelConfigs?: Array<{
      panelsCount?: number;
      yearlyEnergyDcKwh?: number;
      roofSegmentSummaries?: Array<{
        panelsCount?: number;
        pitchDegrees?: number;
      }>;
    }>;
  };
};

export function buildRoofAnalysis(params: {
  address: string;
  lat: number;
  lng: number;
  viewport?: RoofViewport;
}): RoofAnalysis {
  const spanLat = params.viewport
    ? Math.abs(params.viewport.northeast.lat - params.viewport.southwest.lat)
    : 0.01;
  const spanLng = params.viewport
    ? Math.abs(params.viewport.northeast.lng - params.viewport.southwest.lng)
    : 0.01;
  const span = Math.max(spanLat, spanLng);
  const zoom = getRoofZoom(span);

  const usableRoofPercent = clamp(
    Math.round(64 + (zoom - 18) * 7 + (span < 0.006 ? 5 : 0)),
    60,
    88
  );
  const estimatedPanelCount = clamp(
    Math.round(usableRoofPercent / 3.1),
    18,
    32
  );
  const estimatedSystemSizeKw = Number((estimatedPanelCount * 0.42).toFixed(1));
  const estimatedAnnualEnergyKwh = Math.round(estimatedSystemSizeKw * 1830);
  const estimatedAnnualSavings = Math.round(estimatedAnnualEnergyKwh * 0.13);
  const estimatedMonthlySavings = Math.round(estimatedAnnualSavings / 12);
  const estimatedRoofAreaSqm = Number(
    ((estimatedPanelCount * 1.95) / (usableRoofPercent / 100)).toFixed(1)
  );
  const estimatedUsableSolarAreaSqm = Number(
    (estimatedRoofAreaSqm * (usableRoofPercent / 100)).toFixed(1)
  );
  const estimatedRoofLengthMeters = Number(
    Math.sqrt(estimatedRoofAreaSqm * 1.55).toFixed(1)
  );
  const estimatedRoofWidthMeters = Number(
    (estimatedRoofAreaSqm / estimatedRoofLengthMeters).toFixed(1)
  );
  const roofPitchDegrees = clamp(
    Math.round(18 + (estimatedPanelCount - 16) * 0.35),
    18,
    31
  );
  const confidence = zoom >= 21 ? "high" : zoom >= 20 ? "medium" : "low";

  return {
    zoom,
    usableRoofPercent,
    estimatedPanelCount,
    estimatedSystemSizeKw,
    estimatedAnnualSavings,
    estimatedMonthlySavings,
    estimatedAnnualEnergyKwh,
    estimatedRoofAreaSqm,
    estimatedUsableSolarAreaSqm,
    estimatedRoofLengthMeters,
    estimatedRoofWidthMeters,
    roofPitchDegrees,
    maxPanelCount: estimatedPanelCount,
    sunshineHours: null,
    source: "modeled",
    confidence,
  };
}

export function buildRoofAnalysisFromSolarInsights(params: {
  insights: SolarBuildingInsights;
  fallback: RoofAnalysis;
  zoom: number;
}): RoofAnalysis | null {
  const solarPotential = params.insights.solarPotential;
  const panelConfigs = solarPotential?.solarPanelConfigs ?? [];
  const bestConfig = panelConfigs.at(-1);
  const panelsCount = bestConfig?.panelsCount;
  const yearlyEnergyDcKwh = bestConfig?.yearlyEnergyDcKwh;
  const roofAreaSqm = solarPotential?.wholeRoofStats?.areaMeters2;

  if (
    !solarPotential ||
    !Number.isFinite(panelsCount) ||
    !Number.isFinite(yearlyEnergyDcKwh) ||
    !Number.isFinite(roofAreaSqm)
  ) {
    return null;
  }

  const resolvedPanelsCount = Number(panelsCount);
  const resolvedYearlyEnergy = Number(yearlyEnergyDcKwh);
  const resolvedRoofAreaSqm = Number(roofAreaSqm);
  const panelCapacityWatts = solarPotential.panelCapacityWatts ?? 400;
  const estimatedPanelCount = Math.max(1, Math.round(resolvedPanelsCount));
  const estimatedSystemSizeKw = Number(
    ((estimatedPanelCount * panelCapacityWatts) / 1000).toFixed(1)
  );
  const estimatedAnnualEnergyKwh = Math.round(resolvedYearlyEnergy);
  const estimatedAnnualSavings = Math.round(estimatedAnnualEnergyKwh * 0.13);
  const estimatedMonthlySavings = Math.round(estimatedAnnualSavings / 12);
  const estimatedRoofArea = Number(resolvedRoofAreaSqm.toFixed(1));
  const estimatedUsableSolarAreaSqm = Number((estimatedRoofArea * 0.72).toFixed(1));
  const usableRoofPercent = clamp(
    Math.round((estimatedUsableSolarAreaSqm / estimatedRoofArea) * 100),
    48,
    92
  );

  const dominantSegment =
    bestConfig?.roofSegmentSummaries
      ?.slice()
      .sort((left, right) => (right.panelsCount ?? 0) - (left.panelsCount ?? 0))[0] ??
    solarPotential.roofSegmentStats?.[0];
  const roofPitchDegrees = Number(
    (
      dominantSegment?.pitchDegrees ??
      solarPotential.roofSegmentStats?.[0]?.pitchDegrees ??
      params.fallback.roofPitchDegrees
    ).toFixed(1)
  );
  const estimatedRoofLengthMeters = Number(Math.sqrt(estimatedRoofArea * 1.55).toFixed(1));
  const estimatedRoofWidthMeters = Number(
    (estimatedRoofArea / estimatedRoofLengthMeters).toFixed(1)
  );
  const maxPanelCount = Math.max(
    estimatedPanelCount,
    solarPotential.maxArrayPanelsCount ?? estimatedPanelCount
  );
  const sunshineHours = Number.isFinite(solarPotential.maxSunshineHoursPerYear)
    ? Math.round(solarPotential.maxSunshineHoursPerYear as number)
    : null;

  return {
    zoom: params.zoom,
    usableRoofPercent,
    estimatedPanelCount,
    estimatedSystemSizeKw,
    estimatedAnnualSavings,
    estimatedMonthlySavings,
    estimatedAnnualEnergyKwh,
    estimatedRoofAreaSqm: estimatedRoofArea,
    estimatedUsableSolarAreaSqm,
    estimatedRoofLengthMeters,
    estimatedRoofWidthMeters,
    roofPitchDegrees,
    maxPanelCount,
    sunshineHours,
    source: "solar-api",
    confidence: "high",
  };
}

export function getRoofZoom(span: number) {
  if (span <= 0.003) return 21;
  if (span <= 0.008) return 20;
  if (span <= 0.02) return 19;
  return 18;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
