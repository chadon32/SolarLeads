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
export type PropertyType = "residential" | "commercial" | "parking" | "road" | "vacant_lot" | "unknown";

export type RoofPoint = {
  x: number;
  y: number;
};

export type RoofPlaneLabel = "primary" | "secondary" | "garage";

export type RoofSegment = {
  label: RoofPlaneLabel;
  pitchDeg: number;
  azimuthDeg: number;
  areaM2: number;
  panelsFit: number;
  usable: boolean;
  outline: RoofPoint[];
};

export type RoofAnalysis = {
  propertyType: PropertyType;
  rooftopDetected: boolean;
  validSite: boolean;
  invalidReason: string | null;
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
  roofOutline: RoofPoint[];
  usableOutline: RoofPoint[];
  obstructionOutlines: RoofPoint[][];
  roofSegments: RoofSegment[];
  confidence: AnalysisConfidence;
  confidenceNote: string;
  source: "solar-api" | "vision-api" | "modeled";
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

  const roofShape: RoofShape =
    widthM > 15 ? "complex" : widthM > 13.4 ? "hip" : "gable";
  const roofOutline = getDefaultRoofOutline(roofShape);
  const usableOutline = insetPolygon(
    roofOutline,
    10 - Math.min(usablePctRoof / 25, 3)
  );
  const obstructionOutlines = buildDefaultObstructionOutlines("low");

  const garageArea = roundTo(Math.max(usableAreaM2 * 0.28, 10), 1);
  const primaryArea = roundTo(Math.max(usableAreaM2 * 0.52, 18), 1);
  const secondaryArea = roundTo(
    Math.max(usableAreaM2 - primaryArea - garageArea, 8),
    1
  );

  const defaultSegments = getDefaultSegmentOutlines(roofShape);
  const roofSegments: RoofSegment[] = [
    {
      label: "primary",
      pitchDeg,
      azimuthDeg: 182,
      areaM2: primaryArea,
      panelsFit: Math.max(Math.round(panelCount * 0.52), 8),
      usable: true,
      outline: defaultSegments.primary,
    },
    {
      label: "secondary",
      pitchDeg: Math.max(pitchDeg - 2, 12),
      azimuthDeg: 208,
      areaM2: secondaryArea,
      panelsFit: Math.max(Math.round(panelCount * 0.22), 3),
      usable: true,
      outline: defaultSegments.secondary,
    },
    {
      label: "garage",
      pitchDeg: Math.max(pitchDeg - 4, 8),
      azimuthDeg: 176,
      areaM2: garageArea,
      panelsFit: Math.max(panelCount - Math.round(panelCount * 0.74), 2),
      usable: true,
      outline: defaultSegments.garage,
    },
  ];

  return {
    propertyType: "residential",
    rooftopDetected: true,
    validSite: true,
    invalidReason: null,
    roofShape,
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
    roofOutline,
    usableOutline,
    obstructionOutlines,
    roofSegments,
    confidence: span < 0.005 ? "medium" : "low",
    confidenceNote:
      "Using a conservative Arizona fallback because detailed roof analysis was unavailable.",
    source: "modeled",
  };
}

export function buildInvalidRoofAnalysis(params: {
  propertyType?: PropertyType;
  invalidReason: string;
  confidenceNote?: string;
}): RoofAnalysis {
  const fallback = buildFallbackRoofAnalysis({
    address: "Arizona property",
    lat: 33.4942,
    lng: -111.9261,
  });

  return {
    ...fallback,
    propertyType: params.propertyType ?? "unknown",
    rooftopDetected: false,
    validSite: false,
    invalidReason: params.invalidReason,
    panelCount: 0,
    systemKw: 0,
    annualKwh: 0,
    annualSavingsUSD: 0,
    usablePctRoof: 0,
    roofOutline: [],
    usableOutline: [],
    obstructionOutlines: [],
    roofSegments: [],
    confidence: "low",
    confidenceNote:
      params.confidenceNote ??
      "The satellite image did not show a usable residential rooftop.",
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
  const propertyType = propertyTypeOrFallback(input.propertyType, fallback.propertyType);
  const rooftopDetected =
    typeof input.rooftopDetected === "boolean"
      ? input.rooftopDetected
      : fallback.rooftopDetected;
  const validSite =
    typeof input.validSite === "boolean"
      ? input.validSite
      : fallback.validSite;
  const invalidReason = stringOrNullable(input.invalidReason, fallback.invalidReason);
  const roofShape = roofShapeOrFallback(input.roofShape, fallback.roofShape);
  const widthM = roundTo(numberOrFallback(input.widthM, fallback.widthM), 1);
  const depthM = roundTo(numberOrFallback(input.depthM, fallback.depthM), 1);
  const pitchDeg = roundTo(
    clamp(numberOrFallback(input.pitchDeg, fallback.pitchDeg), 0, 45),
    1
  );
  const usablePctRoof = clamp(
    Math.round(numberOrFallback(input.usablePctRoof, fallback.usablePctRoof)),
    0,
    100
  );
  const panelCount = Math.max(
    0,
    Math.round(numberOrFallback(input.panelCount, fallback.panelCount))
  );
  const systemKw = roundTo(
    Math.max(0, numberOrFallback(input.systemKw, fallback.systemKw)),
    1
  );
  const annualKwh = Math.max(
    0,
    Math.round(numberOrFallback(input.annualKwh, fallback.annualKwh))
  );
  const annualSavingsUSD = Math.max(
    0,
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

  const roofOutline = normalizeOutline(
    input.roofOutline,
    fallback.roofOutline.length ? fallback.roofOutline : getDefaultRoofOutline(roofShape)
  );
  const usableOutline = normalizeOutline(
    input.usableOutline,
    fallback.usableOutline.length
      ? fallback.usableOutline
      : insetPolygon(roofOutline, 10 - Math.min(usablePctRoof / 25, 3))
  );
  const obstructionOutlines = normalizeObstructionOutlines(
    input.obstructionOutlines,
    fallback.obstructionOutlines.length
      ? fallback.obstructionOutlines
      : buildDefaultObstructionOutlines(shadingRiskOrFallback(input.shadingRisk, fallback.shadingRisk))
  );

  const roofSegments = normalizeRoofSegments(
    input.roofSegments,
    fallback.roofSegments,
    pitchDeg,
    primaryRoofAzimuth,
    roofShape
  );
  const source =
    input.source === "modeled" ||
    input.source === "vision-api" ||
    input.source === "solar-api"
      ? input.source
      : fallback.source;

  return {
    propertyType,
    rooftopDetected,
    validSite:
      validSite &&
      rooftopDetected &&
      propertyType === "residential" &&
      roofOutline.length >= 3,
    invalidReason:
      validSite && rooftopDetected && propertyType === "residential"
        ? null
        : invalidReason ??
          "A usable residential rooftop could not be confirmed for this address.",
    roofShape,
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
    roofOutline,
    usableOutline,
    obstructionOutlines,
    roofSegments,
    confidence: confidenceOrFallback(input.confidence, fallback.confidence),
    confidenceNote: stringOrFallback(
      input.confidenceNote,
      fallback.confidenceNote
    ),
    source,
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

export function getDefaultRoofOutline(shape: RoofShape): RoofPoint[] {
  switch (shape) {
    case "complex":
      return [
        { x: 20, y: 24 },
        { x: 68, y: 18 },
        { x: 80, y: 32 },
        { x: 75, y: 62 },
        { x: 62, y: 68 },
        { x: 58, y: 80 },
        { x: 28, y: 78 },
        { x: 18, y: 58 },
      ];
    case "hip":
      return [
        { x: 26, y: 24 },
        { x: 72, y: 24 },
        { x: 80, y: 38 },
        { x: 73, y: 73 },
        { x: 27, y: 73 },
        { x: 20, y: 38 },
      ];
    case "shed":
      return [
        { x: 24, y: 30 },
        { x: 74, y: 22 },
        { x: 82, y: 64 },
        { x: 31, y: 72 },
      ];
    case "flat":
      return [
        { x: 23, y: 28 },
        { x: 77, y: 28 },
        { x: 77, y: 72 },
        { x: 23, y: 72 },
      ];
    case "gable":
    default:
      return [
        { x: 24, y: 26 },
        { x: 76, y: 26 },
        { x: 79, y: 66 },
        { x: 50, y: 76 },
        { x: 21, y: 66 },
      ];
  }
}

export function insetPolygon(points: RoofPoint[], inset: number): RoofPoint[] {
  if (!points.length) {
    return [];
  }

  const center = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x / points.length,
      y: accumulator.y + point.y / points.length,
    }),
    { x: 0, y: 0 }
  );

  return points.map((point) => ({
    x: roundTo(point.x + ((center.x - point.x) * inset) / 100, 1),
    y: roundTo(point.y + ((center.y - point.y) * inset) / 100, 1),
  }));
}

function normalizeRoofSegments(
  value: unknown,
  fallback: RoofSegment[],
  defaultPitchDeg: number,
  defaultAzimuth: number,
  roofShape: RoofShape
) {
  const defaultOutlines = getDefaultSegmentOutlines(roofShape);

  if (!Array.isArray(value) || value.length === 0) {
    return fallback.map((segment) => ({
      ...segment,
      outline: segment.outline.length
        ? segment.outline
        : defaultOutlines[segment.label],
    }));
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
            numberOrFallback(
              input.pitchDeg,
              fallbackSegment?.pitchDeg ?? defaultPitchDeg
            ),
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
          Math.round(
            numberOrFallback(
              input.panelsFit,
              fallbackSegment?.panelsFit ?? 0
            )
          )
        ),
        usable:
          typeof input.usable === "boolean"
            ? input.usable
            : (fallbackSegment?.usable ?? true),
        outline: normalizeOutline(
          input.outline,
          fallbackSegment?.outline?.length
            ? fallbackSegment.outline
            : defaultOutlines[label]
        ),
      } satisfies RoofSegment;
    })
    .filter((segment): segment is RoofSegment => Boolean(segment));

  return nextSegments.length ? nextSegments : fallback;
}

function getDefaultSegmentOutlines(shape: RoofShape): Record<RoofPlaneLabel, RoofPoint[]> {
  const outline = getDefaultRoofOutline(shape);
  const bounds = getBounds(outline);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;

  return {
    primary: [
      { x: bounds.minX + 4, y: bounds.minY + 6 },
      { x: midX + 4, y: bounds.minY + 5 },
      { x: midX + 2, y: midY + 3 },
      { x: bounds.minX + 6, y: midY + 4 },
    ],
    secondary: [
      { x: midX - 2, y: bounds.minY + 5 },
      { x: bounds.maxX - 5, y: bounds.minY + 8 },
      { x: bounds.maxX - 8, y: midY + 5 },
      { x: midX + 1, y: midY + 3 },
    ],
    garage: [
      { x: bounds.minX + 8, y: midY + 6 },
      { x: bounds.maxX - 10, y: midY + 7 },
      { x: bounds.maxX - 14, y: bounds.maxY - 6 },
      { x: bounds.minX + 10, y: bounds.maxY - 4 },
    ],
  };
}

export function buildDefaultObstructionOutlines(risk: ShadingRisk) {
  if (risk === "low") {
    return [
      [
        { x: 24, y: 24 },
        { x: 27, y: 24 },
        { x: 27, y: 28 },
        { x: 24, y: 28 },
      ],
    ];
  }

  if (risk === "medium") {
    return [
      [
        { x: 23, y: 23 },
        { x: 27, y: 23 },
        { x: 27, y: 28 },
        { x: 23, y: 28 },
      ],
      [
        { x: 72, y: 29 },
        { x: 76, y: 29 },
        { x: 76, y: 34 },
        { x: 72, y: 34 },
      ],
    ];
  }

  return [
    [
      { x: 23, y: 23 },
      { x: 27, y: 23 },
      { x: 27, y: 28 },
      { x: 23, y: 28 },
    ],
    [
      { x: 72, y: 28 },
      { x: 76, y: 28 },
      { x: 76, y: 33 },
      { x: 72, y: 33 },
    ],
    [
      { x: 61, y: 68 },
      { x: 66, y: 68 },
      { x: 66, y: 73 },
      { x: 61, y: 73 },
    ],
  ];
}

function normalizeOutline(value: unknown, fallback: RoofPoint[]) {
  if (!Array.isArray(value) || value.length < 3) {
    return fallback;
  }

  const points = value
    .map((point) => normalizePoint(point))
    .filter((point): point is RoofPoint => Boolean(point));

  return points.length >= 3 ? points : fallback;
}

function normalizeObstructionOutlines(value: unknown, fallback: RoofPoint[][]) {
  if (!Array.isArray(value) || !value.length) {
    return fallback;
  }

  const outlines = value
    .map((outline) => normalizeOutline(outline, []))
    .filter((outline): outline is RoofPoint[] => outline.length >= 3);

  return outlines.length ? outlines : fallback;
}

function normalizePoint(value: unknown): RoofPoint | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const x = clamp(numberOrFallback(input.x, Number.NaN), 0, 100);
  const y = clamp(numberOrFallback(input.y, Number.NaN), 0, 100);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: roundTo(x, 1),
    y: roundTo(y, 1),
  };
}

function propertyTypeOrFallback(value: unknown, fallback: PropertyType): PropertyType {
  return value === "residential" ||
    value === "commercial" ||
    value === "parking" ||
    value === "road" ||
    value === "vacant_lot" ||
    value === "unknown"
    ? value
    : fallback;
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
  fallback: RoofPlaneLabel
): RoofPlaneLabel {
  return value === "primary" || value === "secondary" || value === "garage"
    ? value
    : fallback;
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringOrNullable(value: unknown, fallback: string | null) {
  if (value === null) {
    return null;
  }

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

function getBounds(points: RoofPoint[]) {
  return points.reduce(
    (accumulator, point) => ({
      minX: Math.min(accumulator.minX, point.x),
      maxX: Math.max(accumulator.maxX, point.x),
      minY: Math.min(accumulator.minY, point.y),
      maxY: Math.max(accumulator.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );
}
