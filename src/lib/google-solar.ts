import {
  buildInvalidRoofAnalysis,
  insetPolygon,
  normalizeRoofAnalysis,
  type RoofGeoBounds,
  type RoofAnalysis,
  type RoofPlaneLabel,
  type RoofPoint,
  type RoofSegment,
  type SolarPanelConfigEstimate,
  type SolarPanelPlacement,
  type ShadingRisk,
} from "@/lib/roof-analysis";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_SOLAR_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY;

const AZ_RATE_PER_KWH = 0.13;

export type GeocodedAddress = {
  formattedAddress: string;
  lat: number;
  lng: number;
  types: string[];
  locationType?: string;
  viewport?: {
    northeast: {
      lat: number;
      lng: number;
    };
    southwest: {
      lat: number;
      lng: number;
    };
  };
};

type GeocodeViewport = GeocodedAddress["viewport"];

export type SolarBuildingInsights = {
  boundingBox?: LatLngBox;
  center?: {
    latitude?: number;
    longitude?: number;
  };
  imageryQuality?: string;
  solarPotential?: SolarPotential;
};

type LatLngBox = {
  sw?: {
    latitude?: number;
    longitude?: number;
  };
  ne?: {
    latitude?: number;
    longitude?: number;
  };
};

type SolarPotential = {
  maxArrayPanelsCount?: number;
  panelCapacityWatts?: number;
  panelHeightMeters?: number;
  panelWidthMeters?: number;
  maxArrayAreaMeters2?: number;
  maxSunshineHoursPerYear?: number;
  carbonOffsetFactorKgPerMwh?: number;
  wholeRoofStats?: SizeAndSunshineStats;
  buildingStats?: SizeAndSunshineStats;
  roofSegmentStats?: RoofSegmentStats[];
  solarPanels?: SolarPanel[];
  solarPanelConfigs?: SolarPanelConfig[];
};

type SolarPanel = {
  center?: {
    latitude?: number;
    longitude?: number;
  };
  orientation?: "PORTRAIT" | "LANDSCAPE";
  azimuthDegrees?: number;
  rowIndex?: number;
  columnIndex?: number;
  yearlyEnergyDcKwh?: number;
  segmentIndex?: number;
};

export type SolarDataLayers = {
  annualFluxUrl?: string;
  dsmUrl?: string;
  maskUrl?: string;
  rgbUrl?: string;
  imageryQuality?: string;
  imageryDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
  imageryProcessedDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
};

type SizeAndSunshineStats = {
  areaMeters2?: number;
  groundAreaMeters2?: number;
  sunshineQuantiles?: number[];
};

type RoofSegmentStats = {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  stats?: SizeAndSunshineStats;
  center?: {
    latitude?: number;
    longitude?: number;
  };
  boundingBox?: LatLngBox;
  planeHeightAtCenterMeters?: number;
};

type SolarPanelConfig = {
  panelsCount?: number;
  yearlyEnergyDcKwh?: number;
  roofSegmentSummaries?: Array<{
    panelsCount?: number;
    yearlyEnergyDcKwh?: number;
    pitchDegrees?: number;
    azimuthDegrees?: number;
    segmentIndex?: number;
  }>;
};

export async function geocodeAddress(
  address: string,
  signal?: AbortSignal
): Promise<GeocodedAddress> {
  if (!GOOGLE_MAPS_KEY) {
    throw new Error("Google Maps API key is not configured.");
  }

  const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  geocodeUrl.searchParams.set("address", address);
  geocodeUrl.searchParams.set("key", GOOGLE_MAPS_KEY);

  const response = await fetch(geocodeUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: Array<{
      formatted_address?: string;
      partial_match?: boolean;
      geometry?: {
        location?: {
          lat?: number;
          lng?: number;
        };
        location_type?: string;
        viewport?: GeocodeViewport;
      };
      types?: string[];
    }>;
    status?: string;
    error_message?: string;
  };

  const result = payload.results?.[0];
  const location = result?.geometry?.location;

  if (!response.ok || !result || !location || payload.status !== "OK") {
    throw new Error(
      payload.error_message || "Google Geocoding is unavailable for this project."
    );
  }

  if (result.partial_match) {
    throw new Error("Please choose a full street address with a visible rooftop.");
  }

  return {
    formattedAddress: result.formatted_address ?? address,
    lat: Number(location.lat),
    lng: Number(location.lng),
    types: result.types ?? [],
    locationType: result.geometry?.location_type,
    viewport: result.geometry?.viewport,
  };
}

export function validateGeocodedResidentialSite(geocoded: GeocodedAddress) {
  const disallowedTypes = new Set([
    "route",
    "intersection",
    "plus_code",
    "point_of_interest",
    "airport",
    "park",
    "natural_feature",
    "premise",
    "subpremise",
  ]);
  const hasResidentialAddressSignal = geocoded.types.some((type) =>
    ["street_address", "premise"].includes(type)
  );

  if (geocoded.locationType === "APPROXIMATE") {
    return "This location is too approximate for rooftop analysis. Please choose a full residential address.";
  }

  if (geocoded.types.some((type) => disallowedTypes.has(type)) && !hasResidentialAddressSignal) {
    return "This location does not look like a residential rooftop. Please choose a detached home address.";
  }

  return null;
}

export async function fetchSolarBuildingInsights(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<SolarBuildingInsights> {
  const solarKey = GOOGLE_SOLAR_KEY;

  if (!solarKey) {
    throw new Error("Google Solar API key is not configured.");
  }

  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "HIGH");
  url.searchParams.set("key", solarKey);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  const payload = (await response.json().catch(() => ({}))) as SolarBuildingInsights & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message || "Google Solar API could not return building insights."
    );
  }

  return payload;
}

export async function fetchSolarDataLayers(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<SolarDataLayers> {
  const solarKey = GOOGLE_SOLAR_KEY;

  if (!solarKey) {
    throw new Error("Google Solar API key is not configured.");
  }

  const url = new URL("https://solar.googleapis.com/v1/dataLayers:get");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("radiusMeters", "50");
  url.searchParams.set("view", "FULL_LAYERS");
  url.searchParams.set("requiredQuality", "HIGH");
  url.searchParams.set("exactQualityRequired", "true");
  url.searchParams.set("pixelSizeMeters", "0.5");
  url.searchParams.set("key", solarKey);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  const payload = (await response.json().catch(() => ({}))) as SolarDataLayers & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Google Solar API could not return data layers.");
  }

  return payload;
}

export function buildSolarRoofAnalysis(params: {
  address: string;
  lat: number;
  lng: number;
  insights: SolarBuildingInsights;
}): RoofAnalysis {
  const solarPotential = params.insights.solarPotential;

  if (!solarPotential) {
    return buildInvalidRoofAnalysis({
      propertyType: "unknown",
      invalidReason:
        "Solar API did not return rooftop insight data for this location.",
      confidenceNote:
        "The Google Solar API could not return a rooftop model for this address.",
    });
  }

  const roofStats = solarPotential.wholeRoofStats ?? solarPotential.buildingStats;
  const roofAreaM2 = Math.max(
    roofStats?.areaMeters2 ??
      roofStats?.groundAreaMeters2 ??
      solarPotential.maxArrayAreaMeters2 ??
      0,
    0
  );
  const usableRoofAreaM2 = Math.max(
    0,
    Math.min(solarPotential.maxArrayAreaMeters2 ?? 0, roofAreaM2)
  );
  const maxArrayPanelsCount = Math.max(
    Math.round(solarPotential.maxArrayPanelsCount ?? 0),
    0
  );
  const panelCapacityWatts = 400;
  const panelWidthMeters = Math.max(
    Number(solarPotential.panelWidthMeters ?? 1.1),
    0.5
  );
  const panelHeightMeters = Math.max(
    Number(solarPotential.panelHeightMeters ?? 1.7),
    1
  );
  const rawSolarPanelConfigs = [...(solarPotential.solarPanelConfigs ?? [])].sort(
    (left, right) => (left.panelsCount ?? 0) - (right.panelsCount ?? 0)
  );
  const solarPanelConfigs = normalizeSolarPanelConfigs(
    rawSolarPanelConfigs
  );
  const maxConfig =
    findPanelConfig(solarPanelConfigs, maxArrayPanelsCount) ??
    solarPanelConfigs.at(-1);
  const rawMaxConfig =
    rawSolarPanelConfigs.find(
      (config) => Math.round(config.panelsCount ?? 0) === maxConfig?.panelsCount
    ) ?? rawSolarPanelConfigs.at(-1);
  const recommendedPanelCount = Math.max(
    0,
    Math.round(maxConfig?.panelsCount ?? maxArrayPanelsCount)
  );
  const roofSegments = [...(solarPotential.roofSegmentStats ?? [])].sort(
    (left, right) =>
      (right.stats?.areaMeters2 ?? right.stats?.groundAreaMeters2 ?? 0) -
      (left.stats?.areaMeters2 ?? left.stats?.groundAreaMeters2 ?? 0)
  );
  const roofBox = params.insights.boundingBox;
  const solarPanels = (solarPotential.solarPanels ?? []).map((panel) =>
    normalizeSolarPanel(panel)
  );

  if (!roofBox?.sw || !roofBox?.ne) {
    return buildInvalidRoofAnalysis({
      propertyType: "unknown",
      invalidReason: "Solar API did not return a usable building bounding box.",
      confidenceNote:
        "The Google Solar API response was missing the building bounding box.",
    });
  }

  const roofBounds = toRoofGeoBounds(roofBox);
  const usableOutlineFromPanels = buildUsableOutlineFromPanels(
    solarPanels,
    roofBox
  );
  const roofOutline = buildDetectedRoofOutline(
    roofSegments,
    roofBox,
    usableOutlineFromPanels
  );
  const usablePctRoof = clamp(
    Math.round(
      roofAreaM2 > 0 ? (usableRoofAreaM2 / roofAreaM2) * 100 : 0
    ),
    0,
    100
  );
  const usableOutline =
    usableOutlineFromPanels.length >= 3
      ? insetPolygon(usableOutlineFromPanels, 2.5)
      : insetPolygon(roofOutline, 10 - Math.min(usablePctRoof / 25, 3.5));
  const roofShape = deriveRoofShape(roofSegments);
  const primarySegment = roofSegments[0];
  const primaryRoofAzimuth = clamp(
    Math.round(primarySegment?.azimuthDegrees ?? 180),
    0,
    359
  );
  const pitchDeg = roundTo(
    roofSegments.length > 0
      ? roofSegments.reduce(
          (sum, segment) => sum + Math.max(Number(segment.pitchDegrees ?? 0), 0),
          0
        ) / roofSegments.length
      : Number(primarySegment?.pitchDegrees ?? 0),
    1
  );
  const rawWidthM = estimateLongitudeSpanMeters(roofBox);
  const rawDepthM = estimateLatitudeSpanMeters(roofBox);
  const inferredFootprint = inferRoofDimensions({
    roofAreaM2,
    rawWidthM,
    rawDepthM,
  });
  const widthM = roundTo(rawWidthM > 0 ? rawWidthM : inferredFootprint.widthM, 1);
  const depthM = roundTo(rawDepthM > 0 ? rawDepthM : inferredFootprint.depthM, 1);
  const shadingRisk = classifyShadingRisk(solarPotential, roofSegments);
  const obstructionOutlines = buildObstructionOutlines(roofSegments, roofBox, shadingRisk);
  const panelCount = recommendedPanelCount || maxArrayPanelsCount;
  const trimmedSolarPanels =
    solarPanels.length > panelCount ? solarPanels.slice(0, panelCount) : solarPanels;
  const energyPerPanelKwh =
    panelCount > 0 && Number(maxConfig?.yearlyEnergyDcKwh ?? 0) > 0
      ? Number(maxConfig?.yearlyEnergyDcKwh ?? 0) / panelCount
      : panelCapacityWatts * 4.8;
  const annualKwh = Math.round(
    Number(maxConfig?.yearlyEnergyDcKwh ?? 0) > 0
      ? Number(maxConfig?.yearlyEnergyDcKwh ?? 0)
      : trimmedSolarPanels.length > 0
        ? trimmedSolarPanels.reduce(
            (sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0),
            0
          )
        : panelCount * energyPerPanelKwh
  );
  const annualSavingsUSD = Math.round(annualKwh * AZ_RATE_PER_KWH);
  const roofSegmentsOut = buildRoofSegmentOutlines(
    roofSegments,
    roofBox,
    rawMaxConfig?.roofSegmentSummaries ?? [],
    panelCount,
    pitchDeg,
    primaryRoofAzimuth,
    solarPanels,
    panelWidthMeters,
    panelHeightMeters
  );
  const propertyType = inferPropertyType({
    roofAreaM2,
    panelCount,
    widthM,
    depthM,
    roofSegments,
    imageryQuality: params.insights.imageryQuality,
  });
  const confidence =
    String(params.insights.imageryQuality ?? "").toUpperCase() === "HIGH"
      ? "high"
      : roofSegments.length > 0
        ? "medium"
        : "low";
  const rooftopConfidenceScore = computeRooftopConfidenceScore({
    roofAreaM2,
    panelCount,
    roofSegmentsCount: roofSegments.length,
    imageryQuality: params.insights.imageryQuality,
    usablePctRoof,
    roofBounds,
  });

  if (
    propertyType !== "residential" ||
    !roofBounds ||
    panelCount < 4 ||
    roofAreaM2 < 25 ||
    roofSegmentsOut.length === 0 ||
    rooftopConfidenceScore < 55
  ) {
    return buildInvalidRoofAnalysis({
      propertyType,
      invalidReason:
        propertyType === "residential"
          ? "A usable residential roof was not confidently confirmed for this property."
          : "This property does not appear to be a detached residential rooftop.",
      confidenceNote: buildConfidenceNote(
        params.insights.imageryQuality ?? "UNKNOWN",
        roofSegments.length
      ),
    });
  }

  return normalizeRoofAnalysis(
    {
      propertyType,
      rooftopDetected: true,
      validSite: true,
      invalidReason: null,
      roofShape,
      widthM,
      depthM,
      grossRoofAreaM2: roundTo(roofAreaM2, 1),
      usableRoofAreaM2: roundTo(usableRoofAreaM2, 1),
      pitchDeg,
      usablePctRoof,
      primaryRoofAzimuth,
      panelCount,
      originalPanelCandidateCount: solarPanels.length || panelCount,
      acceptedPanelCount: panelCount,
      rejectedPanelCandidateCount: 0,
      systemKw: roundTo((panelCount * panelCapacityWatts) / 1000, 1),
      annualKwh,
      annualSavingsUSD,
      carbonOffsetFactorKgPerMwh: Math.max(
        0,
        Number(solarPotential.carbonOffsetFactorKgPerMwh ?? 390)
      ),
      panelCapacityWatts,
      panelWidthMeters,
      panelHeightMeters,
      annualSunlightHours: Math.round(solarPotential.maxSunshineHoursPerYear ?? 1800),
      shadingRisk,
      shadeNote: buildShadeNote(shadingRisk, roofSegments.length),
      rooftopConfidenceScore,
      roofOutline,
      usableOutline,
      obstructionOutlines,
      roofBounds,
      roofSegments: roofSegmentsOut,
      solarPanels: trimmedSolarPanels,
      solarPanelConfigs,
      confidence,
      confidenceNote: buildConfidenceNote(
        params.insights.imageryQuality ?? "UNKNOWN",
        roofSegments.length
      ),
      source: "solar-api",
    },
    buildInvalidRoofAnalysis({
      propertyType: "unknown",
      invalidReason: "Solar API did not return a usable rooftop model.",
      confidenceNote: "Solar API roof data was not sufficient for a rooftop estimate.",
    })
  );
}

function normalizeSolarPanel(panel: SolarPanel): SolarPanelPlacement {
  return {
    center: {
      lat: Number(panel.center?.latitude ?? 0),
      lng: Number(panel.center?.longitude ?? 0),
    },
    orientation: panel.orientation === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
    azimuthDeg: clamp(Math.round(Number(panel.azimuthDegrees ?? 180)), 0, 359),
    rowIndex: Number.isFinite(Number(panel.rowIndex))
      ? Math.round(Number(panel.rowIndex))
      : null,
    columnIndex: Number.isFinite(Number(panel.columnIndex))
      ? Math.round(Number(panel.columnIndex))
      : null,
    yearlyEnergyDcKwh: Math.max(0, Number(panel.yearlyEnergyDcKwh ?? 0)),
    segmentIndex: Math.max(0, Math.round(Number(panel.segmentIndex ?? 0))),
  };
}

function normalizeSolarPanelConfigs(
  configs: SolarPanelConfig[]
): SolarPanelConfigEstimate[] {
  return configs
    .map((config) => ({
      panelsCount: Math.max(0, Math.round(Number(config.panelsCount ?? 0))),
      yearlyEnergyDcKwh: Math.max(0, Number(config.yearlyEnergyDcKwh ?? 0)),
    }))
    .filter((config) => config.panelsCount > 0 && config.yearlyEnergyDcKwh > 0)
    .sort((left, right) => left.panelsCount - right.panelsCount);
}

function findPanelConfig(
  configs: SolarPanelConfigEstimate[],
  panelsCount: number
) {
  if (!configs.length) {
    return null;
  }

  return (
    configs.find((config) => config.panelsCount === panelsCount) ??
    configs.reduce((closest, config) =>
      Math.abs(config.panelsCount - panelsCount) <
      Math.abs(closest.panelsCount - panelsCount)
        ? config
        : closest
    )
  );
}

function deriveRoofShape(segments: RoofSegmentStats[]) {
  if (segments.length >= 4) {
    return "complex";
  }

  if (segments.length === 1) {
    return (segments[0]?.pitchDegrees ?? 0) < 4 ? "flat" : "shed";
  }

  if (segments.length === 2) {
    const first = segments[0];
    const second = segments[1];
    const pitchDiff = Math.abs((first?.pitchDegrees ?? 0) - (second?.pitchDegrees ?? 0));
    const azimuthDiff = angularDistance(
      first?.azimuthDegrees ?? 0,
      second?.azimuthDegrees ?? 0
    );

    if ((first?.pitchDegrees ?? 0) < 4 && (second?.pitchDegrees ?? 0) < 4) {
      return "flat";
    }

    if (pitchDiff <= 3 && (azimuthDiff > 135 || azimuthDiff < 45)) {
      return "gable";
    }

    return "hip";
  }

  if (segments.length === 3) {
    return "hip";
  }

  return (segments[0]?.pitchDegrees ?? 0) < 4 ? "flat" : "gable";
}

function classifyShadingRisk(
  solarPotential: SolarPotential,
  segments: RoofSegmentStats[]
): ShadingRisk {
  const sunshine = solarPotential.maxSunshineHoursPerYear ?? averageSunshine(segments);

  if (sunshine < 1500) {
    return "high";
  }

  if (sunshine < 1700) {
    return "medium";
  }

  return "low";
}

function averageSunshine(segments: RoofSegmentStats[]) {
  const values = segments
    .map((segment) => medianSunshine(segment.stats?.sunshineQuantiles ?? []))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return 1800;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianSunshine(values: number[]) {
  if (!values.length) {
    return Number.NaN;
  }

  return values[Math.floor(values.length / 2)] ?? Number.NaN;
}

function buildShadeNote(shadingRisk: ShadingRisk, segmentsCount: number) {
  if (shadingRisk === "high") {
    return `Solar API indicates uneven roof sunshine across ${segmentsCount} roof segments.`;
  }

  if (shadingRisk === "medium") {
    return `Solar API indicates some variation in roof sunshine across ${segmentsCount} roof segments.`;
  }

  return "Solar API indicates strong, even roof sunshine across the main roof planes.";
}

function buildConfidenceNote(imageryQuality: string, segmentCount: number) {
  return `Solar API imagery quality: ${imageryQuality.toLowerCase()}. The analysis used ${segmentCount} roof segments from the live building insights response.`;
}

function buildRoofSegmentOutlines(
  segments: RoofSegmentStats[],
  roofBox: LatLngBox,
  segmentSummaries: NonNullable<SolarPanelConfig["roofSegmentSummaries"]>,
  totalPanels: number,
  defaultPitch: number,
  defaultAzimuth: number,
  panels: SolarPanelPlacement[],
  panelWidthMeters: number,
  panelHeightMeters: number
): RoofSegment[] {
  const roofArea = segments.reduce(
    (sum, segment) => sum + (segment.stats?.areaMeters2 ?? segment.stats?.groundAreaMeters2 ?? 0),
    0
  );
  const fallbackOutlines = [
    { label: "primary" as RoofPlaneLabel, inset: 4 },
    { label: "secondary" as RoofPlaneLabel, inset: 10 },
    { label: "garage" as RoofPlaneLabel, inset: 16 },
  ];

  return segments.slice(0, 3).map((segment, index) => {
    const areaM2 = segment.stats?.areaMeters2 ?? segment.stats?.groundAreaMeters2 ?? 0;
    const summary = segmentSummaries.find(
      (entry) => Number(entry.segmentIndex ?? index) === index
    );
    const share = roofArea > 0 ? areaM2 / roofArea : 1 / Math.max(segments.length, 1);
    const panelsFit = Math.max(
      0,
      Math.round(summary?.panelsCount ?? totalPanels * share)
    );
    const label = fallbackOutlines[index]?.label ?? "primary";
    const panelOutline = buildSegmentOutlineFromPanels({
      panels,
      segmentIndex: index,
      roofBox,
      panelWidthMeters,
      panelHeightMeters,
      fallbackAzimuth: segment.azimuthDegrees ?? defaultAzimuth,
    });
    const outline =
      panelOutline.length >= 3
        ? panelOutline
        : segment.boundingBox
          ? boxToOutline(segment.boundingBox, roofBox)
          : buildFallbackSegmentOutline(index);
    const sunshineScore = medianSunshine(segment.stats?.sunshineQuantiles ?? []);
    const usable =
      areaM2 >= 8 &&
      (panelsFit > 0 || !Number.isFinite(sunshineScore) || sunshineScore >= 1450);

    return {
      label,
      pitchDeg: roundTo(segment.pitchDegrees ?? defaultPitch, 1),
      azimuthDeg: clamp(Math.round(segment.azimuthDegrees ?? defaultAzimuth), 0, 359),
      areaM2: roundTo(areaM2, 1),
      panelsFit,
      usable,
      outline,
      bounds: toRoofGeoBounds(segment.boundingBox),
    };
  });
}

function buildDetectedRoofOutline(
  segments: RoofSegmentStats[],
  roofBox: LatLngBox,
  usableOutline: RoofPoint[] = []
): RoofPoint[] {
  if (usableOutline.length >= 3) {
    return insetPolygon(usableOutline, -7.5);
  }

  const segmentPoints = segments
    .flatMap((segment) =>
      segment.boundingBox ? boxToOutline(segment.boundingBox, roofBox) : []
    )
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (segmentPoints.length >= 3) {
    return convexHull(segmentPoints);
  }

  return boxToOutline(roofBox);
}

function buildUsableOutlineFromPanels(
  panels: SolarPanelPlacement[],
  roofBox: LatLngBox
) {
  const points = panels
    .map((panel) =>
      toNormalizedPoint(
        {
          latitude: panel.center.lat,
          longitude: panel.center.lng,
        },
        roofBox
      )
    )
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (points.length < 4) {
    return [];
  }

  return convexHull(points);
}

function buildSegmentOutlineFromPanels({
  panels,
  segmentIndex,
  roofBox,
  panelWidthMeters,
  panelHeightMeters,
  fallbackAzimuth,
}: {
  panels: SolarPanelPlacement[];
  segmentIndex: number;
  roofBox: LatLngBox;
  panelWidthMeters: number;
  panelHeightMeters: number;
  fallbackAzimuth: number;
}) {
  const segmentPanels = panels.filter(
    (panel) =>
      panel.segmentIndex === segmentIndex &&
      Number.isFinite(panel.center.lat) &&
      Number.isFinite(panel.center.lng)
  );

  if (segmentPanels.length < 2) {
    return [];
  }

  const points = segmentPanels.flatMap((panel) =>
    getPanelCornerCoordinates({
      panel,
      panels: segmentPanels,
      panelWidthMeters,
      panelHeightMeters,
      fallbackAzimuth,
    }).map((corner) =>
      toNormalizedPoint(
        {
          latitude: corner.lat,
          longitude: corner.lng,
        },
        roofBox
      )
    )
  );

  if (points.length < 4) {
    return [];
  }

  return insetPolygon(convexHull(points), -1.8);
}

function getPanelCornerCoordinates({
  panel,
  panels,
  panelWidthMeters,
  panelHeightMeters,
  fallbackAzimuth,
}: {
  panel: SolarPanelPlacement;
  panels: SolarPanelPlacement[];
  panelWidthMeters: number;
  panelHeightMeters: number;
  fallbackAzimuth: number;
}) {
  const shortSide = Math.min(panelWidthMeters, panelHeightMeters);
  const longSide = Math.max(panelWidthMeters, panelHeightMeters);
  const widthMeters = panel.orientation === "LANDSCAPE" ? longSide : shortSide;
  const heightMeters = panel.orientation === "LANDSCAPE" ? shortSide : longSide;
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;
  const rotation = (inferPanelRotationDeg(panel, panels, fallbackAzimuth) * Math.PI) / 180;
  const corners = [
    { east: -halfWidth, north: -halfHeight },
    { east: halfWidth, north: -halfHeight },
    { east: halfWidth, north: halfHeight },
    { east: -halfWidth, north: halfHeight },
  ];

  return corners.map((corner) => {
    const rotatedEast =
      corner.east * Math.cos(rotation) + corner.north * Math.sin(rotation);
    const rotatedNorth =
      -corner.east * Math.sin(rotation) + corner.north * Math.cos(rotation);

    return offsetLatLngMeters({
      lat: panel.center.lat,
      lng: panel.center.lng,
      eastMeters: rotatedEast,
      northMeters: rotatedNorth,
    });
  });
}

function inferPanelRotationDeg(
  panel: SolarPanelPlacement,
  panels: SolarPanelPlacement[],
  fallbackAzimuth: number
) {
  const rowNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.rowIndex !== null &&
        candidate.rowIndex === panel.rowIndex &&
        candidate.columnIndex !== null &&
        panel.columnIndex !== null
    )
    .sort(
      (left, right) =>
        Math.abs((left.columnIndex ?? 0) - (panel.columnIndex ?? 0)) -
        Math.abs((right.columnIndex ?? 0) - (panel.columnIndex ?? 0))
    )[0];

  if (rowNeighbor) {
    return normalizeDegrees(
      bearingDegrees(panel.center.lat, panel.center.lng, rowNeighbor.center.lat, rowNeighbor.center.lng) - 90
    );
  }

  const columnNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.columnIndex !== null &&
        candidate.columnIndex === panel.columnIndex &&
        candidate.rowIndex !== null &&
        panel.rowIndex !== null
    )
    .sort(
      (left, right) =>
        Math.abs((left.rowIndex ?? 0) - (panel.rowIndex ?? 0)) -
        Math.abs((right.rowIndex ?? 0) - (panel.rowIndex ?? 0))
    )[0];

  if (columnNeighbor) {
    return normalizeDegrees(
      bearingDegrees(panel.center.lat, panel.center.lng, columnNeighbor.center.lat, columnNeighbor.center.lng)
    );
  }

  return normalizeDegrees((Number.isFinite(panel.azimuthDeg) ? panel.azimuthDeg : fallbackAzimuth) - 90);
}

function offsetLatLngMeters({
  lat,
  lng,
  eastMeters,
  northMeters,
}: {
  lat: number;
  lng: number;
  eastMeters: number;
  northMeters: number;
}) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

  return {
    lat: lat + northMeters / metersPerDegreeLat,
    lng: lng + eastMeters / metersPerDegreeLng,
  };
}

function buildObstructionOutlines(
  segments: RoofSegmentStats[],
  roofBox: LatLngBox,
  shadingRisk: ShadingRisk
) {
  if (shadingRisk === "low") {
    return [];
  }

  const sunshineScores = segments
    .map((segment) => ({
      segment,
      score: medianSunshine(segment.stats?.sunshineQuantiles ?? []),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score);

  const worst = sunshineScores.slice(0, shadingRisk === "high" ? 2 : 1);

  return worst
    .filter((entry, index, array) => array.indexOf(entry) === index)
    .map(({ segment }) =>
      segment.boundingBox
        ? insetPolygon(boxToOutline(segment.boundingBox, roofBox), 28)
        : []
    )
    .filter((outline) => outline.length >= 3);
}

function buildFallbackSegmentOutline(index: number): RoofPoint[] {
  const offset = index * 8;
  return [
    { x: 18 + offset, y: 26 + offset },
    { x: 46 + offset, y: 26 + offset },
    { x: 44 + offset, y: 54 + offset },
    { x: 20 + offset, y: 52 + offset },
  ];
}

function convexHull(points: RoofPoint[]) {
  const sorted = [...points].sort((left, right) =>
    left.x === right.x ? left.y - right.y : left.x - right.x
  );

  if (sorted.length <= 3) {
    return sorted;
  }

  const lower: RoofPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: RoofPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(origin: RoofPoint, left: RoofPoint, right: RoofPoint) {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function boxToOutline(box: LatLngBox, rootBox?: LatLngBox): RoofPoint[] {
  if (!box.sw || !box.ne) {
    return [];
  }

  if (!rootBox?.sw || !rootBox?.ne) {
    return [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ];
  }

  const nw = toNormalizedPoint(
    { latitude: box.ne.latitude ?? 0, longitude: box.sw.longitude ?? 0 },
    rootBox
  );
  const ne = toNormalizedPoint(
    { latitude: box.ne.latitude ?? 0, longitude: box.ne.longitude ?? 0 },
    rootBox
  );
  const se = toNormalizedPoint(
    { latitude: box.sw.latitude ?? 0, longitude: box.ne.longitude ?? 0 },
    rootBox
  );
  const sw = toNormalizedPoint(
    { latitude: box.sw.latitude ?? 0, longitude: box.sw.longitude ?? 0 },
    rootBox
  );

  return [nw, ne, se, sw];
}

function toRoofGeoBounds(box?: LatLngBox): RoofGeoBounds | null {
  if (!box?.sw || !box?.ne) {
    return null;
  }

  return {
    southwest: {
      lat: Number(box.sw.latitude ?? 0),
      lng: Number(box.sw.longitude ?? 0),
    },
    northeast: {
      lat: Number(box.ne.latitude ?? 0),
      lng: Number(box.ne.longitude ?? 0),
    },
  };
}

function inferPropertyType(params: {
  roofAreaM2: number;
  panelCount: number;
  widthM: number;
  depthM: number;
  roofSegments: RoofSegmentStats[];
  imageryQuality?: string;
}): RoofAnalysis["propertyType"] {
  if (params.roofSegments.length === 0 || params.roofAreaM2 <= 0) {
    return "unknown";
  }

  if (params.roofAreaM2 < 20 || params.panelCount < 2) {
    return "road";
  }

  if (params.roofAreaM2 > 650 || params.widthM > 40 || params.depthM > 40) {
    return "commercial";
  }

  if (
    String(params.imageryQuality ?? "").toUpperCase() !== "HIGH" &&
    params.panelCount < 6
  ) {
    return "unknown";
  }

  return "residential";
}

function computeRooftopConfidenceScore(params: {
  roofAreaM2: number;
  panelCount: number;
  roofSegmentsCount: number;
  imageryQuality?: string;
  usablePctRoof: number;
  roofBounds: RoofGeoBounds | null;
}) {
  let score = 30;

  if (String(params.imageryQuality ?? "").toUpperCase() === "HIGH") {
    score += 18;
  }

  if (params.roofBounds) {
    score += 10;
  }

  if (params.roofAreaM2 >= 35) {
    score += 12;
  }

  if (params.panelCount >= 8) {
    score += 12;
  }

  if (params.roofSegmentsCount >= 1) {
    score += 10;
  }

  if (params.usablePctRoof >= 40) {
    score += 8;
  }

  return clamp(Math.round(score), 0, 100);
}

function toNormalizedPoint(
  point: { latitude: number; longitude: number },
  rootBox: LatLngBox
): RoofPoint {
  const sw = rootBox.sw!;
  const ne = rootBox.ne!;
  const width = Math.max((ne.longitude ?? 0) - (sw.longitude ?? 0), 0.000001);
  const height = Math.max((ne.latitude ?? 0) - (sw.latitude ?? 0), 0.000001);
  const x = ((point.longitude - (sw.longitude ?? 0)) / width) * 100;
  const y = ((ne.latitude ?? 0) - point.latitude) / height * 100;

  return {
    x: roundTo(clamp(x, 0, 100), 1),
    y: roundTo(clamp(y, 0, 100), 1),
  };
}

function estimateLatitudeSpanMeters(box: LatLngBox) {
  if (!box.sw || !box.ne) {
    return 0;
  }

  return haversineMeters(
    box.sw.latitude ?? 0,
    box.sw.longitude ?? 0,
    box.ne.latitude ?? 0,
    box.sw.longitude ?? 0
  );
}

function estimateLongitudeSpanMeters(box: LatLngBox) {
  if (!box.sw || !box.ne) {
    return 0;
  }

  const latitude = ((box.sw.latitude ?? 0) + (box.ne.latitude ?? 0)) / 2;

  return haversineMeters(
    latitude,
    box.sw.longitude ?? 0,
    latitude,
    box.ne.longitude ?? 0
  );
}

function inferRoofDimensions(params: {
  roofAreaM2: number;
  rawWidthM: number;
  rawDepthM: number;
}) {
  const safeArea = Math.max(params.roofAreaM2, 1);
  const rawAspect =
    params.rawWidthM > 0 && params.rawDepthM > 0
      ? params.rawWidthM / params.rawDepthM
      : 1.25;
  const aspect = clamp(rawAspect, 0.65, 2.4);
  const widthM = roundTo(Math.sqrt(safeArea * aspect), 1);
  const depthM = roundTo(safeArea / Math.max(widthM, 1), 1);

  return {
    widthM,
    depthM,
  };
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const radius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function angularDistance(left: number, right: number) {
  const delta = Math.abs(((left - right) % 360) + 360) % 360;
  return Math.min(delta, 360 - delta);
}

function bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const toDegrees = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const deltaLng = toRadians(toLng - fromLng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
