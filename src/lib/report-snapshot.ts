import {
  buildInvalidRoofAnalysis,
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
import { getSelectedPanelEnergy } from "@/lib/selected-panel-energy";
import { buildActiveSolarEstimate } from "@/lib/active-solar-estimate";
import { getPanelDimensionsMeters, type SolarPanel } from "@/lib/solarPanels";
import { calculateSolarReadinessScore } from "@/lib/solar-advisor";

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
  const normalizedMonthlyBill = finiteNumberOrNull(monthlyBill);
  const sharedMetrics =
    metrics ??
    buildSolarMetrics(analysis, {
      monthlyBill: normalizedMonthlyBill,
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
    monthlyBill: normalizedMonthlyBill,
    panelCount: sharedMetrics.panelCount,
    renderedPanelCount: Math.min(
      sharedMetrics.panelCount,
      getRenderedPanelCapacity(analysis)
    ),
    roofAnalysis: analysis,
    roofModelConfidence: clampScore(analysis.rooftopConfidenceScore),
    solarReadinessScore: calculateSolarReadinessScore({
      annualSunlightHours: analysis.annualSunlightHours,
      coveragePct: sharedMetrics.coveragePct,
      panelCount: sharedMetrics.panelCount,
      usablePctRoof: sharedMetrics.usablePctRoof,
    }),
    viewport,
  };
}

export function normalizeSolarReportSnapshot(
  input: unknown
): SolarReportSnapshot | null {
  if (!isRecord(input)) {
    return null;
  }

  const candidate = input as Partial<SolarReportSnapshot>;
  if (!hasPersistedRoofModel(candidate.roofAnalysis)) {
    return null;
  }

  const fallbackCenter = getValidPoint(candidate.home);
  const fallback = buildInvalidRoofAnalysis({
    propertyType: "unknown",
    invalidReason: "The saved roof model is incomplete.",
  });
  const roofAnalysis = normalizeRoofAnalysis(candidate.roofAnalysis, fallback);

  if (!roofAnalysis.validSite) {
    return null;
  }

  const rawMetrics = isRecord(candidate.metrics) ? candidate.metrics : null;
  const normalizedMonthlyBill = finiteNumberOrNull(candidate.monthlyBill);
  const capacityMetrics = buildSolarMetrics(roofAnalysis, {
    monthlyBill: normalizedMonthlyBill,
  });
  const requestedPanelCount =
    nonNegativeInteger(candidate.panelCount) ??
    nonNegativeInteger(rawMetrics?.panelCount);
  const panelCount = clampInteger(
    requestedPanelCount ?? capacityMetrics.panelCount,
    0,
    capacityMetrics.maxPanelCount
  );
  const normalizedMetrics = buildSnapshotMetrics(
    roofAnalysis,
    normalizedMonthlyBill,
    panelCount
  );
  const rawMetricPanelCount = nonNegativeInteger(rawMetrics?.panelCount);
  const metrics =
    panelCount > 0 && rawMetrics && rawMetricPanelCount === panelCount
      ? rawMetrics
      : normalizedMetrics;
  const requestedRenderedPanelCount = nonNegativeInteger(candidate.renderedPanelCount);
  const renderedPanelCount =
    Math.min(
      panelCount,
      getRenderedPanelCapacity(roofAnalysis),
      requestedRenderedPanelCount ?? panelCount
    );
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
      annualKwh: nonNegativeNumberOr(metrics.annualKwh, normalizedMetrics.annualKwh),
      annualSavings: nonNegativeNumberOr(
        metrics.annualSavings,
        normalizedMetrics.annualSavings
      ),
      avgPitchDeg: numberOr(metrics.avgPitchDeg, normalizedMetrics.avgPitchDeg),
      coveragePct: clampScore(
        numberOr(metrics.coveragePct, normalizedMetrics.coveragePct)
      ),
      grossRoofAreaM2: nonNegativeNumberOr(
        metrics.grossRoofAreaM2,
        normalizedMetrics.grossRoofAreaM2
      ),
      monthlySavings: nonNegativeNumberOr(
        metrics.monthlySavings,
        normalizedMetrics.monthlySavings
      ),
      panelCount,
      paybackYears: nonNegativeNumberOr(
        metrics.paybackYears,
        normalizedMetrics.paybackYears
      ),
      systemKw: nonNegativeNumberOr(metrics.systemKw, normalizedMetrics.systemKw),
      usablePctRoof: clampScore(
        numberOr(metrics.usablePctRoof, normalizedMetrics.usablePctRoof)
      ),
      usableRoofAreaM2: nonNegativeNumberOr(
        metrics.usableRoofAreaM2,
        normalizedMetrics.usableRoofAreaM2
      ),
    },
    monthlyBill: normalizedMonthlyBill,
    panelCount,
    renderedPanelCount,
    roofAnalysis,
    roofModelConfidence: clampScore(
      candidate.roofModelConfidence ?? roofAnalysis.rooftopConfidenceScore
    ),
    solarReadinessScore: calculateSolarReadinessScore({
      annualSunlightHours: roofAnalysis.annualSunlightHours,
      coveragePct: clampScore(
        numberOr(metrics.coveragePct, normalizedMetrics.coveragePct)
      ),
      panelCount,
      usablePctRoof: clampScore(
        numberOr(metrics.usablePctRoof, normalizedMetrics.usablePctRoof)
      ),
    }),
    viewport,
  };
}

export function rebuildTrustedSolarReportSnapshot(
  snapshot: SolarReportSnapshot,
  options: {
    selectedPanel?: SolarPanel;
    batteryCost?: number | null;
    installedCostPerWatt?: number | null;
    monthlyBill?: number | null;
    panelWatts?: number | null;
  } = {}
): SolarReportSnapshot {
  const monthlyBill =
    options.monthlyBill === undefined
      ? finiteNumberOrNull(snapshot.monthlyBill)
      : finiteNumberOrNull(options.monthlyBill);
  if (options.selectedPanel) {
    const installedCostPerWatt =
      positiveNumber(options.installedCostPerWatt) ??
      options.selectedPanel.installedCostPerWatt;
    const active = buildActiveSolarEstimate({
      analysis: snapshot.roofAnalysis,
      selectedPanel: options.selectedPanel,
      selectedPanelCount: snapshot.panelCount,
      monthlyBill,
      batteryCost: options.batteryCost,
      inverterCostAdderPerWatt:
        installedCostPerWatt - options.selectedPanel.installedCostPerWatt,
    });
    const dimensions = getPanelDimensionsMeters(options.selectedPanel);
    return buildSolarReportSnapshot({
      activePanelCount: active.panelCount,
      address: snapshot.address,
      analysis: {
        ...snapshot.roofAnalysis,
        panelWidthMeters: dimensions.widthMeters,
        panelHeightMeters: dimensions.heightMeters,
      },
      lat: snapshot.home?.lat,
      lng: snapshot.home?.lng,
      monthlyBill,
      metrics: {
        ...active.baseMetrics,
        panelCount: active.panelCount,
        annualKwh: active.annualKwh,
        annualSavings: active.annualSavings,
        monthlySavings: active.monthlySavings,
        systemKw: active.systemKw,
        paybackYears: active.paybackYears,
        coveragePct: active.energyOffsetPct,
      },
    });
  }
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
  const annualKwh = Math.round(getSelectedPanelEnergy(
    { ...analysis, solarPanels: acceptedPanels }, acceptedPanelCount,
    { widthMeters: panelWidthMeters, heightMeters: panelHeightMeters }
  ));
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
      panelsFit: segmentPanelCounts.get(segment.segmentIndex ?? index) ?? 0,
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

function hasPersistedRoofModel(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasRoofOutline(value.roofOutline)
  ) {
    return false;
  }

  if (value.roofSegments === undefined || value.roofSegments === null) {
    return true;
  }

  return (
    Array.isArray(value.roofSegments) &&
    value.roofSegments.every(
      (segment) => isRecord(segment) && hasRoofOutline(segment.outline)
    )
  );
}

function hasRoofOutline(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every(
      (point) =>
        isRecord(point) &&
        finiteNumberOrNull(point.x) !== null &&
        finiteNumberOrNull(point.y) !== null
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildSnapshotMetrics(
  analysis: RoofAnalysis,
  monthlyBill: number | null,
  panelCount: number
) {
  if (panelCount > 0) {
    return buildSolarMetrics(analysis, {
      monthlyBill,
      selectedPanelCount: panelCount,
    });
  }

  const baseMetrics = buildSolarMetrics(analysis, {
    monthlyBill,
    selectedPanelCount: 1,
  });

  return {
    ...baseMetrics,
    annualKwh: 0,
    annualSavings: 0,
    coveragePct: 0,
    monthlySavings: 0,
    panelCount: 0,
    paybackYears: 0,
    systemKw: 0,
  };
}

function getRenderedPanelCapacity(analysis: RoofAnalysis) {
  if (analysis.source === "solar-api") {
    return analysis.solarPanels.length;
  }

  return Math.max(analysis.solarPanels.length, analysis.acceptedPanelCount ?? 0);
}

function nonNegativeInteger(value: unknown) {
  const parsed = finiteNumberOrNull(value);
  return parsed !== null && parsed >= 0 ? Math.floor(parsed) : null;
}

function positiveNumber(value: unknown) {
  const parsed = finiteNumberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function numberOr(value: unknown, fallback: number) {
  return finiteNumberOrNull(value) ?? fallback;
}

function nonNegativeNumberOr(value: unknown, fallback: number) {
  const parsed = finiteNumberOrNull(value);
  return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function finiteNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
