import {
  buildInvalidRoofAnalysis,
  insetPolygon,
  normalizeRoofAnalysis,
  type RoofAnalysis,
  type RoofPlaneLabel,
  type RoofPoint,
  type RoofSegment,
  type ShadingRisk,
} from "@/lib/roof-analysis";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_SOLAR_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_SOLAR_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY;

const AZ_RATE_PER_KWH = 0.13;

export type GeocodedAddress = {
  formattedAddress: string;
  lat: number;
  lng: number;
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
  wholeRoofStats?: SizeAndSunshineStats;
  buildingStats?: SizeAndSunshineStats;
  roofSegmentStats?: RoofSegmentStats[];
  solarPanelConfigs?: SolarPanelConfig[];
};

export type SolarDataLayers = {
  annualFluxUrl?: string;
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
    viewport: result.geometry?.viewport,
  };
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
  url.searchParams.set("radiusMeters", "100");
  url.searchParams.set("view", "IMAGERY_AND_ANNUAL_FLUX_LAYERS");
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
  const maxArrayPanelsCount = Math.max(
    Math.round(solarPotential.maxArrayPanelsCount ?? 0),
    0
  );
  const panelCapacityWatts = Math.max(
    Number(solarPotential.panelCapacityWatts ?? 400),
    1
  );
  const solarPanelConfigs = [...(solarPotential.solarPanelConfigs ?? [])].sort(
    (left, right) =>
      (right.yearlyEnergyDcKwh ?? 0) -
      (left.yearlyEnergyDcKwh ?? 0) ||
      (right.panelsCount ?? 0) - (left.panelsCount ?? 0)
  );
  const bestConfig = solarPanelConfigs[0];
  const annualKwh =
    Math.round(bestConfig?.yearlyEnergyDcKwh ?? maxArrayPanelsCount * panelCapacityWatts * 4.8);
  const annualSavingsUSD = Math.round(annualKwh * AZ_RATE_PER_KWH);
  const roofSegments = [...(solarPotential.roofSegmentStats ?? [])].sort(
    (left, right) =>
      (right.stats?.areaMeters2 ?? right.stats?.groundAreaMeters2 ?? 0) -
      (left.stats?.areaMeters2 ?? left.stats?.groundAreaMeters2 ?? 0)
  );
  const roofBox = params.insights.boundingBox;

  if (!roofBox?.sw || !roofBox?.ne) {
    return buildInvalidRoofAnalysis({
      propertyType: "unknown",
      invalidReason: "Solar API did not return a usable building bounding box.",
      confidenceNote:
        "The Google Solar API response was missing the building bounding box.",
    });
  }

  const roofOutline = boxToOutline(roofBox);
  const usablePctRoof = clamp(
    Math.round(
      roofAreaM2 > 0 ? (Math.min(solarPotential.maxArrayAreaMeters2 ?? 0, roofAreaM2) / roofAreaM2) * 100 : 0
    ),
    0,
    100
  );
  const usableOutline = insetPolygon(
    roofOutline,
    10 - Math.min(usablePctRoof / 25, 3.5)
  );
  const roofShape = deriveRoofShape(roofSegments);
  const primarySegment = roofSegments[0];
  const primaryRoofAzimuth = clamp(
    Math.round(primarySegment?.azimuthDegrees ?? 180),
    0,
    359
  );
  const pitchDeg = roundTo(primarySegment?.pitchDegrees ?? 0, 1);
  const widthM = roundTo(
    estimateLongitudeSpanMeters(roofBox) || Math.sqrt(Math.max(roofAreaM2, 0)),
    1
  );
  const depthM = roundTo(
    estimateLatitudeSpanMeters(roofBox) || Math.sqrt(Math.max(roofAreaM2, 0)),
    1
  );
  const shadingRisk = classifyShadingRisk(solarPotential, roofSegments);
  const obstructionOutlines = buildObstructionOutlines(roofSegments, roofBox, shadingRisk);
  const panelCount = maxArrayPanelsCount;
  const roofSegmentsOut = buildRoofSegmentOutlines(
    roofSegments,
    roofBox,
    panelCount,
    pitchDeg,
    primaryRoofAzimuth
  );
  const confidence =
    String(params.insights.imageryQuality ?? "").toUpperCase() === "HIGH"
      ? "high"
      : roofSegments.length > 0
        ? "medium"
        : "low";

  return normalizeRoofAnalysis(
    {
      propertyType: "residential",
      rooftopDetected: true,
      validSite: true,
      invalidReason: null,
      roofShape,
      widthM,
      depthM,
      pitchDeg,
      usablePctRoof,
      primaryRoofAzimuth,
      panelCount,
      systemKw: roundTo((panelCount * panelCapacityWatts) / 1000, 1),
      annualKwh,
      annualSavingsUSD,
      shadingRisk,
      shadeNote: buildShadeNote(shadingRisk, roofSegments.length),
      roofOutline,
      usableOutline,
      obstructionOutlines,
      roofSegments: roofSegmentsOut,
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
  totalPanels: number,
  defaultPitch: number,
  defaultAzimuth: number
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
    const share = roofArea > 0 ? areaM2 / roofArea : 1 / Math.max(segments.length, 1);
    const panelsFit = Math.max(1, Math.round(totalPanels * share));
    const label = fallbackOutlines[index]?.label ?? "primary";
    const outline = segment.boundingBox ? boxToOutline(segment.boundingBox, roofBox) : buildFallbackSegmentOutline(index);

    return {
      label,
      pitchDeg: roundTo(segment.pitchDegrees ?? defaultPitch, 1),
      azimuthDeg: clamp(Math.round(segment.azimuthDegrees ?? defaultAzimuth), 0, 359),
      areaM2: roundTo(areaM2, 1),
      panelsFit,
      usable: true,
      outline,
    };
  });
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
