import "server-only";
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
import {
  isArizonaAddressComponents,
  isArizonaCoordinate,
  looksLikeArizonaAddress,
} from "@/lib/arizona-address";
import {
  ARIZONA_AVG_RATE_PER_KWH,
  getRecommendedPanelCountForTarget,
  getTargetAnnualUsageKwh,
} from "@/lib/solar-metrics";
import { selectPrimaryBuildingSegments } from "@/lib/building-filter";
import { buildPanelPolygonPath, normalizeDegrees } from "@/lib/panel-geometry";
import { regularizeSolarPanels } from "@/lib/panel-layout";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_SOLAR_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY;

export type GeocodedAddress = {
  addressComponents?: Array<{
    long_name?: string;
    short_name?: string;
    types?: string[];
  }>;
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
    signal: withRequestTimeout(signal),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: Array<{
      address_components?: Array<{
        long_name?: string;
        short_name?: string;
        types?: string[];
      }>;
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
    addressComponents: result.address_components,
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

  if (
    !isArizonaCoordinate(geocoded.lat, geocoded.lng) ||
    (!isArizonaAddressComponents(geocoded.addressComponents) &&
      !looksLikeArizonaAddress(geocoded.formattedAddress))
  ) {
    return "Solartelligence currently supports residential properties in Arizona only.";
  }

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
    signal: withRequestTimeout(signal),
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
    signal: withRequestTimeout(signal),
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
  /**
   * Segment indices judged (via terrain evidence) to sit on a structure
   * detached from the queried building — excluded from the analysis.
   */
  detachedSegmentIndices?: Set<number>;
  /**
   * Raw panel-array indices to exclude — modules hanging past the roof edge
   * (terrain far below their plane) or sitting over raised rooftop
   * equipment (terrain far above their plane).
   */
  excludedPanelIndices?: Set<number>;
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

  // Keep API order: solarPanels[].segmentIndex indexes into this array.
  const roofSegments = [...(solarPotential.roofSegmentStats ?? [])];
  const allSolarPanels = (solarPotential.solarPanels ?? []).flatMap(
    (panel, index) => {
      // Preserve Google's original array index when applying terrain-based
      // exclusions, then discard candidates without a drawable coordinate.
      if (params.excludedPanelIndices?.has(index)) {
        return [];
      }

      const normalizedPanel = normalizeSolarPanel(panel, roofSegments);
      return normalizedPanel ? [normalizedPanel] : [];
    }
  );

  // For attached or closely-spaced homes the Solar API can span the
  // neighbor's roof. Keep only the building at the queried address.
  const segmentBoxes = roofSegments.flatMap((segment, index) => {
    const sw = segment.boundingBox?.sw;
    const ne = segment.boundingBox?.ne;
    if (
      !Number.isFinite(sw?.latitude) ||
      !Number.isFinite(sw?.longitude) ||
      !Number.isFinite(ne?.latitude) ||
      !Number.isFinite(ne?.longitude)
    ) {
      return [];
    }
    return [
      {
        index,
        north: Number(ne!.latitude),
        south: Number(sw!.latitude),
        east: Number(ne!.longitude),
        west: Number(sw!.longitude),
      },
    ];
  });
  const primarySegmentIndices = selectPrimaryBuildingSegments({
    boxes: segmentBoxes,
    targetLat: params.lat,
    targetLng: params.lng,
  });
  // Segments without a usable box cannot be excluded fairly.
  roofSegments.forEach((_, index) => {
    if (!segmentBoxes.some((box) => box.index === index)) {
      primarySegmentIndices.add(index);
    }
  });
  // Terrain-verified detachment (panel clusters split by a ground-level
  // gap) overrides box adjacency — fused Solar API footprints have
  // overlapping boxes across genuinely separate homes.
  params.detachedSegmentIndices?.forEach((index) => {
    primarySegmentIndices.delete(index);
  });
  const droppedNeighborSegments =
    roofSegments.length - primarySegmentIndices.size;
  const keptRoofSegments = roofSegments.filter((_, index) =>
    primarySegmentIndices.has(index)
  );
  const solarPanels =
    droppedNeighborSegments > 0
      ? allSolarPanels.filter((panel) =>
          primarySegmentIndices.has(panel.segmentIndex)
        )
      : allSolarPanels;

  const segmentArea = (segment: RoofSegmentStats) =>
    segment.stats?.areaMeters2 ?? segment.stats?.groundAreaMeters2 ?? 0;
  const keptSegmentAreaM2 = keptRoofSegments.reduce(
    (sum, segment) => sum + segmentArea(segment),
    0
  );
  const totalSegmentAreaM2 = roofSegments.reduce(
    (sum, segment) => sum + segmentArea(segment),
    0
  );
  const keptAreaRatio =
    droppedNeighborSegments > 0 && totalSegmentAreaM2 > 0
      ? keptSegmentAreaM2 / totalSegmentAreaM2
      : 1;

  const roofStats = solarPotential.wholeRoofStats ?? solarPotential.buildingStats;
  const wholeRoofAreaM2 = Math.max(
    roofStats?.areaMeters2 ??
      roofStats?.groundAreaMeters2 ??
      solarPotential.maxArrayAreaMeters2 ??
      0,
    0
  );
  const roofAreaM2 =
    droppedNeighborSegments > 0 && keptSegmentAreaM2 > 0
      ? roundTo(keptSegmentAreaM2, 1)
      : wholeRoofAreaM2;
  const usableRoofAreaM2 = Math.max(
    0,
    Math.min((solarPotential.maxArrayAreaMeters2 ?? 0) * keptAreaRatio, roofAreaM2)
  );
  const maxArrayPanelsCount = solarPanels.length;
  const panelCapacityWatts = clamp(
    Number(solarPotential.panelCapacityWatts ?? 400),
    100,
    800
  );
  const panelWidthMeters = Math.max(
    Number(solarPotential.panelWidthMeters ?? 1.1),
    0.5
  );
  const panelHeightMeters = Math.max(
    Number(solarPotential.panelHeightMeters ?? 1.7),
    1
  );
  const rawSolarPanelConfigs = [...(solarPotential.solarPanelConfigs ?? [])]
    .sort((left, right) => (left.panelsCount ?? 0) - (right.panelsCount ?? 0))
    // A configuration is only supportable when every panel has a valid,
    // property-filtered coordinate that the 2D and 3D views can render.
    .filter(
      (config) => Math.round(config.panelsCount ?? 0) <= solarPanels.length
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
  const roofBox =
    droppedNeighborSegments > 0 && segmentBoxes.length
      ? unionSegmentBoxes(
          segmentBoxes.filter((box) => primarySegmentIndices.has(box.index))
        )
      : params.insights.boundingBox;
  // Physical max capacity (slider upper bound). Default homeowner size is
  // chosen later as a bill-offset / typical-usage recommendation.
  const maxPanelCapacity = solarPanels.length;

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
    keptRoofSegments,
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
  const roofShape = deriveRoofShape(keptRoofSegments);
  const primarySegment = [...keptRoofSegments].sort(
    (left, right) =>
      (right.stats?.areaMeters2 ?? right.stats?.groundAreaMeters2 ?? 0) -
      (left.stats?.areaMeters2 ?? left.stats?.groundAreaMeters2 ?? 0)
  )[0];
  const primaryRoofAzimuth = clamp(
    Math.round(primarySegment?.azimuthDegrees ?? 180),
    0,
    359
  );
  const pitchDeg = roundTo(
    keptRoofSegments.length > 0
      ? keptRoofSegments.reduce(
          (sum, segment) => sum + Math.max(Number(segment.pitchDegrees ?? 0), 0),
          0
        ) / keptRoofSegments.length
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
  const shadingRisk = classifyShadingRisk(solarPotential, keptRoofSegments);
  const obstructionOutlines = buildObstructionOutlines(keptRoofSegments, roofBox, shadingRisk);
  // Keep full Google placements for the map slider; default economics use a
  // practical bill-offset size rather than max theoretical packing.
  // Placements are snapped onto per-plane rack grids so the rendered array
  // reads like an installer layout (regularizeSolarPanels reverts any plane
  // it cannot align honestly).
  const trimmedSolarPanels = regularizeSolarPanels({
    panels:
      solarPanels.length > maxPanelCapacity
        ? solarPanels.slice(0, maxPanelCapacity)
        : solarPanels,
    panelWidthMeters,
    panelHeightMeters,
  });
  const panelCount = getRecommendedPanelCountForTarget({
    maxPanelCount: Math.max(maxPanelCapacity, trimmedSolarPanels.length),
    solarPanelConfigs,
    solarPanels: trimmedSolarPanels,
    targetAnnualKwh: getTargetAnnualUsageKwh(null),
    fallbackAnnualKwh:
      maxPanelCapacity > 0 && Number(maxConfig?.yearlyEnergyDcKwh ?? 0) > 0
        ? Number(maxConfig?.yearlyEnergyDcKwh ?? 0) / maxPanelCapacity
        : panelCapacityWatts * 4.8,
  });
  const recommendedConfig =
    findPanelConfig(solarPanelConfigs, panelCount) ?? maxConfig;
  const energyPerPanelKwh =
    panelCount > 0 && Number(recommendedConfig?.yearlyEnergyDcKwh ?? 0) > 0
      ? Number(recommendedConfig?.yearlyEnergyDcKwh ?? 0) / panelCount
      : panelCapacityWatts * 4.8;
  const annualKwh = Math.round(
    Number(recommendedConfig?.yearlyEnergyDcKwh ?? 0) > 0
      ? Number(recommendedConfig?.yearlyEnergyDcKwh ?? 0)
      : trimmedSolarPanels.length > 0
        ? trimmedSolarPanels
            .slice(0, panelCount)
            .reduce((sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0), 0)
        : panelCount * energyPerPanelKwh
  );
  const annualSavingsUSD = Math.round(
    annualKwh * ARIZONA_AVG_RATE_PER_KWH
  );
  const roofSegmentsOut = buildRoofSegmentOutlines(
    roofSegments,
    primarySegmentIndices,
    roofBox,
    rawMaxConfig?.roofSegmentSummaries ?? [],
    maxPanelCapacity || panelCount,
    pitchDeg,
    primaryRoofAzimuth,
    solarPanels,
    panelWidthMeters,
    panelHeightMeters
  );
  const propertyType = inferPropertyType({
    roofAreaM2,
    panelCount: maxPanelCapacity || panelCount,
    widthM,
    depthM,
    roofSegments: keptRoofSegments,
    imageryQuality: params.insights.imageryQuality,
  });
  const confidence =
    String(params.insights.imageryQuality ?? "").toUpperCase() === "HIGH"
      ? "high"
      : keptRoofSegments.length > 0
        ? "medium"
        : "low";
  const rooftopConfidenceScore = computeRooftopConfidenceScore({
    roofAreaM2,
    panelCount: maxPanelCapacity || panelCount,
    roofSegmentsCount: keptRoofSegments.length,
    imageryQuality: params.insights.imageryQuality,
    usablePctRoof,
    roofBounds,
  });

  if (
    propertyType !== "residential" ||
    !roofBounds ||
    (maxPanelCapacity || panelCount) < 4 ||
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
        keptRoofSegments.length
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
      originalPanelCandidateCount:
        solarPanels.length || maxPanelCapacity || panelCount,
      acceptedPanelCount: maxPanelCapacity || panelCount,
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
      shadeNote: buildShadeNote(shadingRisk, keptRoofSegments.length),
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
        keptRoofSegments.length
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

function normalizeSolarPanel(
  panel: SolarPanel,
  roofSegments: RoofSegmentStats[]
): SolarPanelPlacement | null {
  // Google SolarPanel has no azimuth/pitch — only segmentIndex. Orientation,
  // facing direction, and pitch all come from roofSegmentStats[segmentIndex].
  // Bake them onto the panel so drawing stays correct even when the display
  // list only keeps the largest few segments.
  const latitude = Number(panel.center?.latitude);
  const longitude = Number(panel.center?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return null;
  }

  const segmentIndex = Math.max(0, Math.round(Number(panel.segmentIndex ?? 0)));
  const segment = roofSegments[segmentIndex];
  const segmentAzimuth = segment?.azimuthDegrees;
  const panelAzimuth = Number(panel.azimuthDegrees);
  const azimuthSource = Number.isFinite(panelAzimuth)
    ? panelAzimuth
    : Number.isFinite(Number(segmentAzimuth))
      ? Number(segmentAzimuth)
      : 180;
  const pitchSource = Number(segment?.pitchDegrees);
  const pitchDeg = Number.isFinite(pitchSource)
    ? clamp(pitchSource, 0, 89)
    : 0;

  return {
    center: {
      lat: latitude,
      lng: longitude,
    },
    orientation: panel.orientation === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
    azimuthDeg: clamp(Math.round(azimuthSource), 0, 359),
    pitchDeg,
    rowIndex: Number.isFinite(Number(panel.rowIndex))
      ? Math.round(Number(panel.rowIndex))
      : null,
    columnIndex: Number.isFinite(Number(panel.columnIndex))
      ? Math.round(Number(panel.columnIndex))
      : null,
    yearlyEnergyDcKwh: Math.max(0, Number(panel.yearlyEnergyDcKwh ?? 0)),
    segmentIndex,
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

function unionSegmentBoxes(
  boxes: Array<{ north: number; south: number; east: number; west: number }>
): LatLngBox {
  return {
    ne: {
      latitude: Math.max(...boxes.map((box) => box.north)),
      longitude: Math.max(...boxes.map((box) => box.east)),
    },
    sw: {
      latitude: Math.min(...boxes.map((box) => box.south)),
      longitude: Math.min(...boxes.map((box) => box.west)),
    },
  };
}

function buildConfidenceNote(imageryQuality: string, segmentCount: number) {
  return `Solar API imagery quality: ${imageryQuality.toLowerCase()}. The analysis used ${segmentCount} roof segments from the live building insights response.`;
}

function buildRoofSegmentOutlines(
  segments: RoofSegmentStats[],
  keepIndices: Set<number>,
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
  const fallbackLabels = [
    "primary" as RoofPlaneLabel,
    "secondary" as RoofPlaneLabel,
    "garage" as RoofPlaneLabel,
  ];

  // Keep original API segmentIndex (panels reference it). Prefer every segment
  // that actually hosts panels so map outlines wrap the full layout — not only
  // the three largest faces (which left panels looking "off the roof").
  const ranked = segments
    .map((segment, originalIndex) => {
      const areaM2 =
        segment.stats?.areaMeters2 ?? segment.stats?.groundAreaMeters2 ?? 0;
      const panelsOnSegment = panels.filter(
        (panel) => panel.segmentIndex === originalIndex
      ).length;
      return { areaM2, originalIndex, panelsOnSegment, segment };
    })
    .filter((entry) => keepIndices.has(entry.originalIndex))
    .filter((entry) => entry.panelsOnSegment > 0 || entry.areaM2 >= 12)
    .sort((left, right) => {
      if (right.panelsOnSegment !== left.panelsOnSegment) {
        return right.panelsOnSegment - left.panelsOnSegment;
      }
      return right.areaM2 - left.areaM2;
    });

  const selected =
    ranked.length > 0
      ? ranked
      : segments
          .map((segment, originalIndex) => ({
            areaM2:
              segment.stats?.areaMeters2 ??
              segment.stats?.groundAreaMeters2 ??
              0,
            originalIndex,
            panelsOnSegment: 0,
            segment,
          }))
          .filter((entry) => keepIndices.has(entry.originalIndex))
          .sort((left, right) => right.areaM2 - left.areaM2)
          .slice(0, 3);

  return selected.map(({ areaM2, originalIndex, panelsOnSegment, segment }, rank) => {
    const summary = segmentSummaries.find(
      (entry) => Number(entry.segmentIndex ?? originalIndex) === originalIndex
    );
    const share = roofArea > 0 ? areaM2 / roofArea : 1 / Math.max(segments.length, 1);
    const panelsFit = Math.max(
      0,
      Math.round(
        summary?.panelsCount ??
          (panelsOnSegment > 0 ? panelsOnSegment : totalPanels * share)
      )
    );
    const label =
      fallbackLabels[rank] ??
      (`plane ${rank + 1}` as RoofPlaneLabel);
    const panelOutline = buildSegmentOutlineFromPanels({
      panels,
      segmentIndex: originalIndex,
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
          : buildFallbackSegmentOutline(Math.min(rank, 2));
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
      segmentIndex: originalIndex,
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
    buildPanelPolygonPath({
      fallbackAzimuthDeg: Number.isFinite(panel.azimuthDeg)
        ? panel.azimuthDeg
        : fallbackAzimuth,
      panel,
      panelHeightMeters,
      panelWidthMeters,
      panels: segmentPanels,
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
  const delta = Math.abs(normalizeDegrees(left) - normalizeDegrees(right));
  return Math.min(delta, 360 - delta);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function withRequestTimeout(signal?: AbortSignal, timeoutMs = 12_000) {
  const timeout = AbortSignal.timeout(timeoutMs);

  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
