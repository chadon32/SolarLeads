import {
  buildFallbackRoofAnalysis,
  normalizeRoofAnalysis,
  type RoofAnalysis,
  type RoofGeoBounds,
  type RoofPoint,
} from "@/lib/roof-analysis";
import {
  ARIZONA_AVG_RATE_PER_KWH,
  buildSolarMetrics,
  calculateEnergyOffsetPct,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
  type SharedSolarMetrics,
} from "@/lib/solar-metrics";
import {
  getRoofAnalysisViewport,
  type RoofAnalysisViewport,
  type RoofViewportPoint,
} from "@/lib/roof-analysis-viewport";
import { calculateFederalResidentialSolarCredit } from "@/lib/financial-model";
import {
  buildPanelCornerLatLngPoints,
  inferPanelRotationDeg,
} from "@/lib/panel-geometry";
import { selectCohesiveSolarPanels } from "@/lib/panel-layout";

export type ReportSnapshotMetrics = Pick<
  SharedSolarMetrics,
  | "annualKwh"
  | "annualSavings"
  | "avgPitchDeg"
  | "coveragePct"
  | "grossRoofAreaM2"
  | "monthlySavings"
  | "panelCount"
  | "paybackYears"
  | "systemKw"
  | "usablePctRoof"
  | "usableRoofAreaM2"
>;

export type SolarReportSnapshot = {
  version: 1;
  address: string;
  createdAt: string;
  home: RoofViewportPoint | null;
  metrics: ReportSnapshotMetrics;
  monthlyBill: number | null;
  panelCount: number;
  renderedPanelCount: number;
  roofAnalysis: RoofAnalysis;
  roofModelConfidence: number;
  solarReadinessScore: number;
  viewport: RoofAnalysisViewport;
};

export function buildSolarReportSnapshot({
  activePanelCount,
  address,
  analysis,
  lat,
  lng,
  metrics,
  monthlyBill,
}: {
  activePanelCount?: number | null;
  address: string;
  analysis: RoofAnalysis;
  lat?: number | null;
  lng?: number | null;
  metrics?: SharedSolarMetrics | null;
  monthlyBill?: number | null;
}): SolarReportSnapshot {
  const sharedMetrics =
    metrics ??
    buildSolarMetrics(analysis, {
      monthlyBill,
      selectedPanelCount: activePanelCount,
    });
  const home = getRoofBoundsCenter(analysis.roofBounds) ?? getValidPoint({ lat, lng });
  const points = getRoofAnalysisSnapshotPoints(analysis, home);
  const viewport = getRoofAnalysisViewport({
    bounds: analysis.roofBounds,
    fallbackCenter: home,
    points,
  });

  return {
    version: 1,
    address,
    createdAt: new Date().toISOString(),
    home,
    metrics: {
      annualKwh: sharedMetrics.annualKwh,
      annualSavings: sharedMetrics.annualSavings,
      avgPitchDeg: sharedMetrics.avgPitchDeg,
      coveragePct: sharedMetrics.coveragePct,
      grossRoofAreaM2: sharedMetrics.grossRoofAreaM2,
      monthlySavings: sharedMetrics.monthlySavings,
      panelCount: sharedMetrics.panelCount,
      paybackYears: sharedMetrics.paybackYears,
      systemKw: sharedMetrics.systemKw,
      usablePctRoof: sharedMetrics.usablePctRoof,
      usableRoofAreaM2: sharedMetrics.usableRoofAreaM2,
    },
    monthlyBill: Number.isFinite(Number(monthlyBill)) ? Number(monthlyBill) : null,
    panelCount: sharedMetrics.panelCount,
    renderedPanelCount: Math.min(
      sharedMetrics.panelCount,
      Math.max(analysis.solarPanels.length, analysis.acceptedPanelCount ?? 0)
    ),
    roofAnalysis: analysis,
    roofModelConfidence: clampScore(analysis.rooftopConfidenceScore),
    solarReadinessScore: clampScore(analysis.rooftopConfidenceScore),
    viewport,
  };
}

export function normalizeSolarReportSnapshot(
  input: unknown
): SolarReportSnapshot | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<SolarReportSnapshot>;
  const fallbackCenter = getValidPoint(candidate.home);
  const fallback = buildFallbackRoofAnalysis({
    address: typeof candidate.address === "string" ? candidate.address : "Saved report",
    lat: fallbackCenter?.lat ?? 33.4152,
    lng: fallbackCenter?.lng ?? -111.8315,
  });
  const roofAnalysis = normalizeRoofAnalysis(candidate.roofAnalysis, fallback);

  if (!roofAnalysis.validSite) {
    return null;
  }

  const metrics =
    candidate.metrics && typeof candidate.metrics === "object"
      ? candidate.metrics
      : buildSolarMetrics(roofAnalysis, {
          monthlyBill: candidate.monthlyBill,
          selectedPanelCount: candidate.panelCount,
        });
  const panelCount = positiveInteger(candidate.panelCount) ?? metrics.panelCount;
  const renderedPanelCount =
    positiveInteger(candidate.renderedPanelCount) ??
    Math.min(panelCount, roofAnalysis.solarPanels.length);
  const home =
    fallbackCenter ??
    getRoofBoundsCenter(roofAnalysis.roofBounds) ??
    roofAnalysis.solarPanels[0]?.center ??
    null;
  const viewport =
    normalizeSnapshotViewport(candidate.viewport) ??
    getRoofAnalysisViewport({
      bounds: roofAnalysis.roofBounds,
      fallbackCenter: home,
      points: getRoofAnalysisSnapshotPoints(roofAnalysis, home),
    });

  return {
    version: 1,
    address: typeof candidate.address === "string" ? candidate.address : "",
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    home,
    metrics: {
      annualKwh: numberOr(metrics.annualKwh, 0),
      annualSavings: numberOr(metrics.annualSavings, 0),
      avgPitchDeg: numberOr(metrics.avgPitchDeg, roofAnalysis.pitchDeg),
      coveragePct: clampScore(numberOr(metrics.coveragePct, 0)),
      grossRoofAreaM2: numberOr(metrics.grossRoofAreaM2, roofAnalysis.grossRoofAreaM2),
      monthlySavings: numberOr(metrics.monthlySavings, 0),
      panelCount,
      paybackYears: numberOr(metrics.paybackYears, 0),
      systemKw: numberOr(metrics.systemKw, roofAnalysis.systemKw),
      usablePctRoof: numberOr(metrics.usablePctRoof, roofAnalysis.usablePctRoof),
      usableRoofAreaM2: numberOr(
        metrics.usableRoofAreaM2,
        roofAnalysis.usableRoofAreaM2
      ),
    },
    monthlyBill: Number.isFinite(Number(candidate.monthlyBill))
      ? Number(candidate.monthlyBill)
      : null,
    panelCount,
    renderedPanelCount,
    roofAnalysis,
    roofModelConfidence: clampScore(
      candidate.roofModelConfidence ?? roofAnalysis.rooftopConfidenceScore
    ),
    solarReadinessScore: clampScore(
      candidate.solarReadinessScore ?? roofAnalysis.rooftopConfidenceScore
    ),
    viewport,
  };
}

export function rebuildTrustedSolarReportSnapshot(
  snapshot: SolarReportSnapshot,
  options: {
    batteryCost?: number | null;
    installedCostPerWatt?: number | null;
    monthlyBill?: number | null;
    panelWatts?: number | null;
  } = {}
): SolarReportSnapshot {
  const monthlyBill = Number.isFinite(Number(options.monthlyBill))
    ? Number(options.monthlyBill)
    : snapshot.monthlyBill;
  const baseMetrics = buildSolarMetrics(snapshot.roofAnalysis, {
    monthlyBill,
    selectedPanelCount: snapshot.panelCount,
  });
  const panelWatts = positiveNumber(options.panelWatts) ?? STANDARD_PANEL_WATTS;
  const providerPanelWatts =
    positiveNumber(snapshot.roofAnalysis.panelCapacityWatts) ?? STANDARD_PANEL_WATTS;
  const annualKwh = Math.round(
    baseMetrics.annualKwh * (panelWatts / providerPanelWatts)
  );
  const annualBill = monthlyBill && monthlyBill > 0 ? monthlyBill * 12 : null;
  const annualSavings = Math.round(
    annualBill
      ? Math.min(annualKwh * ARIZONA_AVG_RATE_PER_KWH, annualBill)
      : annualKwh * ARIZONA_AVG_RATE_PER_KWH
  );
  const systemKw = roundTo((baseMetrics.panelCount * panelWatts) / 1000, 2);
  const installedCostPerWatt =
    positiveNumber(options.installedCostPerWatt) ?? INSTALLED_COST_PER_WATT;
  const installedCost =
    systemKw * 1000 * installedCostPerWatt +
    Math.max(0, numberOr(options.batteryCost, 0));
  const netCost =
    installedCost - calculateFederalResidentialSolarCredit(installedCost);
  const metrics: SharedSolarMetrics = {
    ...baseMetrics,
    annualKwh,
    annualSavings,
    coveragePct: annualBill
      ? calculateEnergyOffsetPct(annualKwh, monthlyBill)
      : baseMetrics.coveragePct,
    monthlySavings: Math.round(annualSavings / 12),
    paybackYears:
      annualSavings > 0 ? roundTo(netCost / annualSavings, 1) : 0,
    systemKw,
  };

  return buildSolarReportSnapshot({
    activePanelCount: metrics.panelCount,
    address: snapshot.address,
    analysis: snapshot.roofAnalysis,
    lat: snapshot.home?.lat,
    lng: snapshot.home?.lng,
    metrics,
    monthlyBill,
  });
}

export function buildAcceptedPanelAnalysisForReport(
  analysis: RoofAnalysis,
  panelDimensions?: { heightMeters: number; widthMeters: number }
): RoofAnalysis {
  const originalPanelCandidateCount = Math.max(
    analysis.originalPanelCandidateCount ?? 0,
    analysis.solarPanels.length,
    analysis.panelCount
  );

  if (!analysis.validSite || !analysis.solarPanels.length) {
    return {
      ...analysis,
      acceptedPanelCount: 0,
      originalPanelCandidateCount,
      rejectedPanelCandidateCount: originalPanelCandidateCount,
      solarPanels: [],
    };
  }

  const modeledAcceptedCount = clampInteger(
    analysis.acceptedPanelCount ?? analysis.panelCount,
    1,
    analysis.solarPanels.length
  );
  const panelHeightMeters =
    positiveNumber(panelDimensions?.heightMeters) ?? analysis.panelHeightMeters;
  const panelWidthMeters =
    positiveNumber(panelDimensions?.widthMeters) ?? analysis.panelWidthMeters;
  const acceptedPanels = selectCohesiveSolarPanels({
    panels: analysis.solarPanels,
    targetCount: modeledAcceptedCount,
    panelWidthMeters,
    panelHeightMeters,
  });
  const acceptedPanelCount = acceptedPanels.length;
  const selectedConfig = findNearestPanelConfigForReport(
    analysis.solarPanelConfigs,
    acceptedPanelCount
  );
  const panelEnergyTotal = acceptedPanels.reduce(
    (sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0),
    0
  );
  const fallbackPerPanel =
    analysis.panelCount > 0 ? analysis.annualKwh / analysis.panelCount : 0;
  const annualKwh = Math.max(
    0,
    Math.round(
      selectedConfig?.yearlyEnergyDcKwh ??
        (panelEnergyTotal > 0
          ? panelEnergyTotal
          : fallbackPerPanel * acceptedPanelCount)
    )
  );
  const segmentPanelCounts = acceptedPanels.reduce<Map<number, number>>(
    (counts, panel) => {
      counts.set(panel.segmentIndex, (counts.get(panel.segmentIndex) ?? 0) + 1);
      return counts;
    },
    new Map()
  );

  return {
    ...analysis,
    acceptedPanelCount,
    annualKwh,
    annualSavingsUSD: Math.round(annualKwh * ARIZONA_AVG_RATE_PER_KWH),
    originalPanelCandidateCount,
    panelCount: acceptedPanelCount,
    panelHeightMeters,
    panelWidthMeters,
    rejectedPanelCandidateCount: Math.max(
      0,
      originalPanelCandidateCount - acceptedPanelCount
    ),
    roofSegments: analysis.roofSegments.map((segment, index) => ({
      ...segment,
      panelsFit: segmentPanelCounts.get(index) ?? 0,
    })),
    solarPanelConfigs: analysis.solarPanelConfigs.filter(
      (config) => config.panelsCount <= acceptedPanelCount
    ),
    solarPanels: acceptedPanels,
    systemKw: Math.round(((acceptedPanelCount * STANDARD_PANEL_WATTS) / 1000) * 10) / 10,
  };
}

export function getRoofAnalysisSnapshotPoints(
  analysis: RoofAnalysis,
  home?: RoofViewportPoint | null
) {
  const roofOutlinePoints = outlineToLatLngPoints(
    analysis.roofOutline,
    analysis.roofBounds
  );
  const usableOutlinePoints = outlineToLatLngPoints(
    analysis.usableOutline,
    analysis.roofBounds
  );
  const segmentPoints = analysis.roofSegments.flatMap((segment) =>
    segment.outline.length >= 3
      ? outlineToLatLngPoints(segment.outline, analysis.roofBounds)
      : boundsToLatLngPoints(segment.bounds)
  );
  const panelPoints = analysis.solarPanels.flatMap((panel) =>
    buildPanelCornerLatLngPoints({
      analysis,
      panel,
      panels: analysis.solarPanels,
    })
  );

  return [
    ...roofOutlinePoints,
    ...usableOutlinePoints,
    ...segmentPoints,
    ...panelPoints,
    home,
  ].filter(isValidLatLngPoint);
}

export function outlineToLatLngPoints(
  outline: RoofPoint[],
  bounds: RoofGeoBounds | null
): RoofViewportPoint[] {
  if (!bounds || outline.length < 3) {
    return [];
  }

  const west = bounds.southwest.lng;
  const east = bounds.northeast.lng;
  const south = bounds.southwest.lat;
  const north = bounds.northeast.lat;

  return outline.map((point) => {
    const x = clamp01(point.x / 100);
    const y = clamp01(point.y / 100);

    return {
      lat: north - (north - south) * y,
      lng: west + (east - west) * x,
    };
  });
}

export function boundsToLatLngPoints(
  bounds: RoofGeoBounds | null
): RoofViewportPoint[] {
  if (!bounds) {
    return [];
  }

  return [
    { lat: bounds.northeast.lat, lng: bounds.northeast.lng },
    { lat: bounds.northeast.lat, lng: bounds.southwest.lng },
    { lat: bounds.southwest.lat, lng: bounds.southwest.lng },
    { lat: bounds.southwest.lat, lng: bounds.northeast.lng },
  ];
}

export { buildPanelCornerLatLngPoints, inferPanelRotationDeg };

function findNearestPanelConfigForReport(
  configs: RoofAnalysis["solarPanelConfigs"],
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

function normalizeSnapshotViewport(
  viewport: SolarReportSnapshot["viewport"] | undefined
) {
  if (!viewport || typeof viewport !== "object") {
    return null;
  }

  const center = getValidPoint(viewport.center);
  const bounds = normalizeBounds(viewport.bounds);
  const zoom = Number(viewport.staticMapZoom);

  if (!center && !bounds) {
    return null;
  }

  return {
    bounds,
    center: center ?? getRoofBoundsCenter(bounds),
    staticMapZoom: Number.isFinite(zoom) ? Math.round(zoom) : 20,
  };
}

function normalizeBounds(bounds: RoofGeoBounds | null | undefined) {
  if (!bounds) {
    return null;
  }

  const northeast = getValidPoint(bounds.northeast);
  const southwest = getValidPoint(bounds.southwest);

  if (!northeast || !southwest) {
    return null;
  }

  return {
    northeast: {
      lat: Math.max(northeast.lat, southwest.lat),
      lng: Math.max(northeast.lng, southwest.lng),
    },
    southwest: {
      lat: Math.min(northeast.lat, southwest.lat),
      lng: Math.min(northeast.lng, southwest.lng),
    },
  };
}

function getRoofBoundsCenter(bounds: RoofGeoBounds | null) {
  if (!bounds) {
    return null;
  }

  return {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
  };
}

function getValidPoint(point: unknown) {
  const candidate = point as
    | { lat?: unknown; lng?: unknown }
    | null
    | undefined;

  if (
    !candidate ||
    candidate.lat === null ||
    candidate.lat === undefined ||
    candidate.lat === "" ||
    candidate.lng === null ||
    candidate.lng === undefined ||
    candidate.lng === ""
  ) {
    return null;
  }

  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

function isValidLatLngPoint(
  point: RoofViewportPoint | null | undefined
): point is RoofViewportPoint {
  return Boolean(getValidPoint(point));
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function numberOr(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clampScore(value: unknown) {
  const parsed = Number(value);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.round(parsed) : 0, 0), 100);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
