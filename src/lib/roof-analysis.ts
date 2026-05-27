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

export type RoofShape = "gable" | "hip" | "flat" | "shed" | "complex";
export type ShadingRisk = "low" | "medium" | "high";
export type AnalysisConfidence = "high" | "medium" | "low";

export type RoofSegment = {
  label: "primary" | "secondary" | "garage";
  pitchDeg: number;
  azimuthDeg: number;
  areaM2: number;
  panelsFit: number;
  usable: boolean;
};

export type RoofAnalysis = {
  roofShape: RoofShape;
  widthM: number;
  depthM: number;
  pitchDeg: number;
  usablePctRoof: number;
  primaryRoofAzimuth: number;
  panelCount: number;
  systemKw: number;
  annualKwh: number;
  annualSavingsUSD: number;
  shadingRisk: ShadingRisk;
  shadeNote: string;
  roofSegments: RoofSegment[];
  confidence: AnalysisConfidence;
  confidenceNote: string;
  source: "vision-api" | "modeled";
};

export function buildFallbackRoofAnalysis(params: {
  address: string;
  lat: number;
  lng: number;
  viewport?: RoofViewport;
}): RoofAnalysis {
  const spanLat = params.viewport
    ? Math.abs(params.viewport.northeast.lat - params.viewport.southwest.lat)
    : 0.008;
  const spanLng = params.viewport
    ? Math.abs(params.viewport.northeast.lng - params.viewport.southwest.lng)
    : 0.008;
  const span = Math.max(spanLat, spanLng);

  const widthM = roundTo(clamp(10 + (0.012 - span) * 440, 10, 19), 1);
  const depthM = roundTo(clamp(8.5 + (0.01 - span) * 360, 8, 16), 1);
  const pitchDeg = clamp(Math.round(16 + widthM * 0.55), 16, 28);
  const usablePctRoof = clamp(Math.round(62 + widthM * 0.8), 58, 86);
  const usableAreaM2 = getUsableAreaM2FromFootprint(widthM, depthM, usablePctRoof);
  const panelCount = clamp(Math.round(usableAreaM2 / 2.2), 14, 30);
  const systemKw = roundTo(panelCount * 0.4, 1);
  const annualKwh = Math.round(systemKw * 1706);
  const annualSavingsUSD = Math.round(annualKwh * 0.13);

  const garageArea = roundTo(Math.max(usableAreaM2 * 0.28, 10), 1);
  const primaryArea = roundTo(Math.max(usableAreaM2 * 0.52, 18), 1);
  const secondaryArea = roundTo(
    Math.max(usableAreaM2 - primaryArea - garageArea, 8),
    1
  );

  const roofSegments: RoofSegment[] = [
    {
      label: "primary",
      pitchDeg,
      azimuthDeg: 182,
      areaM2: primaryArea,
      panelsFit: Math.max(Math.round(panelCount * 0.52), 8),
      usable: true,
    },
    {
      label: "secondary",
      pitchDeg: Math.max(pitchDeg - 2, 12),
      azimuthDeg: 208,
      areaM2: secondaryArea,
      panelsFit: Math.max(Math.round(panelCount * 0.22), 3),
      usable: true,
    },
    {
      label: "garage",
      pitchDeg: Math.max(pitchDeg - 4, 8),
      azimuthDeg: 176,
      areaM2: garageArea,
      panelsFit: Math.max(panelCount - Math.round(panelCount * 0.74), 2),
      usable: true,
    },
  ];

  return {
    roofShape: widthM > 15 ? "complex" : widthM > 13.4 ? "hip" : "gable",
    widthM,
    depthM,
    pitchDeg,
    usablePctRoof,
    primaryRoofAzimuth: 182,
    panelCount,
    systemKw,
    annualKwh,
    annualSavingsUSD,
    shadingRisk: "low",
    shadeNote: "No significant shading detected.",
    roofSegments,
    confidence: span < 0.005 ? "medium" : "low",
    confidenceNote:
      "Using a conservative Arizona fallback because detailed roof analysis was unavailable.",
    source: "modeled",
  };
}

export function normalizeRoofAnalysis(
  value: unknown,
  fallback: RoofAnalysis
): RoofAnalysis {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const input = value as Record<string, unknown>;
  const widthM = roundTo(numberOrFallback(input.widthM, fallback.widthM), 1);
  const depthM = roundTo(numberOrFallback(input.depthM, fallback.depthM), 1);
  const pitchDeg = roundTo(
    clamp(numberOrFallback(input.pitchDeg, fallback.pitchDeg), 0, 45),
    1
  );
  const usablePctRoof = clamp(
    Math.round(numberOrFallback(input.usablePctRoof, fallback.usablePctRoof)),
    20,
    100
  );
  const panelCount = Math.max(
    1,
    Math.round(numberOrFallback(input.panelCount, fallback.panelCount))
  );
  const systemKw = roundTo(
    Math.max(0.8, numberOrFallback(input.systemKw, fallback.systemKw)),
    1
  );
  const annualKwh = Math.max(
    1000,
    Math.round(numberOrFallback(input.annualKwh, fallback.annualKwh))
  );
  const annualSavingsUSD = Math.max(
    400,
    Math.round(
      numberOrFallback(input.annualSavingsUSD, Math.round(annualKwh * 0.13))
    )
  );
  const primaryRoofAzimuth = clamp(
    Math.round(
      numberOrFallback(input.primaryRoofAzimuth, fallback.primaryRoofAzimuth)
    ),
    0,
    359
  );

  const roofSegments = normalizeRoofSegments(
    input.roofSegments,
    fallback.roofSegments,
    pitchDeg,
    primaryRoofAzimuth
  );

  return {
    roofShape: roofShapeOrFallback(input.roofShape, fallback.roofShape),
    widthM,
    depthM,
    pitchDeg,
    usablePctRoof,
    primaryRoofAzimuth,
    panelCount,
    systemKw,
    annualKwh,
    annualSavingsUSD,
    shadingRisk: shadingRiskOrFallback(input.shadingRisk, fallback.shadingRisk),
    shadeNote: stringOrFallback(input.shadeNote, fallback.shadeNote),
    roofSegments,
    confidence: confidenceOrFallback(input.confidence, fallback.confidence),
    confidenceNote: stringOrFallback(
      input.confidenceNote,
      fallback.confidenceNote
    ),
    source: "vision-api",
  };
}

export function getRoofAreaM2(analysis: RoofAnalysis) {
  const segmentArea = analysis.roofSegments.reduce(
    (sum, segment) => sum + Math.max(segment.areaM2, 0),
    0
  );

  if (segmentArea > 0) {
    return roundTo(segmentArea, 1);
  }

  return roundTo(analysis.widthM * analysis.depthM, 1);
}

export function getUsableAreaM2(analysis: RoofAnalysis) {
  const usableSegmentArea = analysis.roofSegments
    .filter((segment) => segment.usable)
    .reduce((sum, segment) => sum + Math.max(segment.areaM2, 0), 0);

  if (usableSegmentArea > 0) {
    return roundTo(usableSegmentArea, 1);
  }

  return getUsableAreaM2FromFootprint(
    analysis.widthM,
    analysis.depthM,
    analysis.usablePctRoof
  );
}

export function getMonthlySavings(analysis: RoofAnalysis) {
  return Math.round(analysis.annualSavingsUSD / 12);
}

function normalizeRoofSegments(
  value: unknown,
  fallback: RoofSegment[],
  defaultPitchDeg: number,
  defaultAzimuth: number
) {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback;
  }

  const nextSegments = value
    .map((segment, index) => {
      if (!segment || typeof segment !== "object") {
        return null;
      }

      const input = segment as Record<string, unknown>;
      const fallbackSegment = fallback[index] ?? fallback[0];
      const label = roofSegmentLabelOrFallback(
        input.label,
        fallbackSegment?.label ?? "primary"
      );

      return {
        label,
        pitchDeg: roundTo(
          clamp(
            numberOrFallback(input.pitchDeg, fallbackSegment?.pitchDeg ?? defaultPitchDeg),
            0,
            45
          ),
          1
        ),
        azimuthDeg: clamp(
          Math.round(
            numberOrFallback(
              input.azimuthDeg,
              fallbackSegment?.azimuthDeg ?? defaultAzimuth
            )
          ),
          0,
          359
        ),
        areaM2: roundTo(
          Math.max(
            4,
            numberOrFallback(input.areaM2, fallbackSegment?.areaM2 ?? 12)
          ),
          1
        ),
        panelsFit: Math.max(
          0,
          Math.round(numberOrFallback(input.panelsFit, fallbackSegment?.panelsFit ?? 0))
        ),
        usable:
          typeof input.usable === "boolean"
            ? input.usable
            : (fallbackSegment?.usable ?? true),
      } satisfies RoofSegment;
    })
    .filter((segment): segment is RoofSegment => Boolean(segment));

  return nextSegments.length ? nextSegments : fallback;
}

function roofShapeOrFallback(value: unknown, fallback: RoofShape): RoofShape {
  return value === "gable" ||
    value === "hip" ||
    value === "flat" ||
    value === "shed" ||
    value === "complex"
    ? value
    : fallback;
}

function shadingRiskOrFallback(
  value: unknown,
  fallback: ShadingRisk
): ShadingRisk {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

function confidenceOrFallback(
  value: unknown,
  fallback: AnalysisConfidence
): AnalysisConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : fallback;
}

function roofSegmentLabelOrFallback(
  value: unknown,
  fallback: RoofSegment["label"]
): RoofSegment["label"] {
  return value === "primary" || value === "secondary" || value === "garage"
    ? value
    : fallback;
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOrFallback(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundTo(value: number, precision: number) {
  const power = 10 ** precision;
  return Math.round(value * power) / power;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getUsableAreaM2FromFootprint(
  widthM: number,
  depthM: number,
  usablePctRoof: number
) {
  return roundTo(widthM * depthM * (usablePctRoof / 100), 1);
}
