import jpeg from "jpeg-js";
import {
  buildFallbackRoofAnalysis,
  buildInvalidRoofAnalysis,
  insetPolygon,
  normalizeRoofAnalysis,
  type AnalysisConfidence,
  type RoofAnalysis,
  type RoofPlaneLabel,
  type RoofPoint,
  type RoofShape,
  type ShadingRisk,
} from "@/lib/roof-analysis";

type DeterministicParams = {
  address: string;
  lat: number;
  lng: number;
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  zoom?: number;
};

type SampleCell = {
  x: number;
  y: number;
  luma: number;
  saturation: number;
  hue: number;
  score: number;
  centrality: number;
  vegetation: boolean;
  water: boolean;
  shadow: boolean;
  roofLike: boolean;
};

type RoofComponent = {
  cells: Array<{ x: number; y: number }>;
  area: number;
  centroidX: number;
  centroidY: number;
  averageScore: number;
  averageLuma: number;
  averageSaturation: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  angleRad: number;
  halfWidth: number;
  halfHeight: number;
  compactness: number;
  widthPx: number;
  depthPx: number;
};

type ContextStats = {
  nearbyPavedRatio: number;
  nearbyVegetationRatio: number;
  nearbyRoofLikeRatio: number;
  nearbyRoofCount: number;
  nearbyLargeRoofCount: number;
  surroundingUniformity: number;
};

type BoundingBox = {
  centerX: number;
  centerY: number;
  axisX: { x: number; y: number };
  axisY: { x: number; y: number };
  halfWidth: number;
  halfHeight: number;
};

const SAMPLE_SIZE = 160;
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const analysisCache = new Map<string, { createdAt: number; analysis: RoofAnalysis }>();

export function analyzeRoofDeterministically(
  params: DeterministicParams
): RoofAnalysis {
  const cacheKey = `${params.address}:${params.lat.toFixed(5)}:${params.lng.toFixed(
    5
  )}`;
  const cached = analysisCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.analysis;
  }

  const fallback = buildFallbackRoofAnalysis({
    address: params.address,
    lat: params.lat,
    lng: params.lng,
  });

  try {
    if (params.mimeType !== "image/jpeg") {
      const normalized = normalizeRoofAnalysis(
        {
          ...fallback,
          confidence: "low",
          confidenceNote:
            "The deterministic rooftop pipeline expects JPEG imagery and is using a modeled estimate instead.",
          source: "modeled",
        },
        fallback
      );
      setCache(cacheKey, normalized);
      return normalized;
    }

    const image = jpeg.decode(Buffer.from(params.base64, "base64"), {
      useTArray: true,
      formatAsRGBA: true,
    });
    const sampled = sampleImage(image.width, image.height, image.data);
    const components = extractRoofComponents(sampled);
    const component = components[0];

    if (!component) {
      const invalid = buildInvalidRoofAnalysis({
        propertyType: "unknown",
        invalidReason:
          "The deterministic rooftop scan could not isolate a roof footprint near the property center.",
        confidenceNote:
          "No stable roof-like image region was detected in the rooftop viewport.",
      });
      setCache(cacheKey, invalid);
      return invalid;
    }

    const metersPerPixel =
      (156543.03392 * Math.cos((params.lat * Math.PI) / 180)) /
      2 ** (params.zoom ?? 20);
    const widthM = roundTo(
      clamp(component.widthPx * metersPerPixel * 1.24, 7.5, 32),
      1
    );
    const depthM = roundTo(
      clamp(component.depthPx * metersPerPixel * 1.24, 7, 28),
      1
    );
    const roofAreaM2 = widthM * depthM;
    const contextStats = summarizeContext(sampled, component, components);
    const propertyType = classifyPropertyType(
      params.address,
      component,
      contextStats,
      widthM,
      depthM,
      roofAreaM2
    );

    if (propertyType !== "residential") {
      const invalid = buildInvalidRoofAnalysis({
        propertyType,
        invalidReason:
          propertyType === "commercial"
            ? "This rooftop appears too large or too uniform to be a detached residential home."
            : "A detached residential roof could not be confirmed from the rooftop image.",
        confidenceNote:
          "The deterministic scan identified a site pattern that does not match a typical detached house roof.",
      });
      setCache(cacheKey, invalid);
      return invalid;
    }

    const roofShape = inferRoofShape(component);
    const roofBox = createBoundingBox(component);
    const roofOutline = buildRoofOutline(roofBox, roofShape);
    const obstructionOutlines = detectObstructionOutlines(sampled, component, roofBox);
    const obstructionRatio = estimateObstructionRatio(obstructionOutlines, roofOutline);
    const usablePctRoof = clamp(
      Math.round(82 - obstructionRatio * 120 - (1 - component.compactness) * 18),
      56,
      88
    );
    const usableOutline = insetPolygon(
      roofOutline,
      10 - Math.min(usablePctRoof / 24, 3.2)
    );
    const shadingRisk = classifyShadingRisk(obstructionRatio);
    const primaryRoofAzimuth = inferAzimuth(component.angleRad);
    const pitchDeg = inferPitch(component, obstructionRatio);
    const roofSegments = buildRoofSegments({
      roofBox,
      roofShape,
      widthM,
      depthM,
      pitchDeg,
      primaryRoofAzimuth,
      usablePctRoof,
    });
    const usableAreaM2 = roofSegments
      .filter((segment) => segment.usable)
      .reduce((sum, segment) => sum + segment.areaM2, 0);
    const panelCount = clamp(Math.floor(usableAreaM2 / 2.2), 8, 36);
    const systemKw = roundTo(panelCount * 0.4, 1);
    const productionFactor =
      shadingRisk === "high" ? 1470 : shadingRisk === "medium" ? 1590 : 1715;
    const annualKwh = Math.round(systemKw * productionFactor);
    const annualSavingsUSD = Math.round(annualKwh * 0.13);
    const confidence = classifyConfidence(component, obstructionRatio);
    const normalized = normalizeRoofAnalysis(
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
        systemKw,
        annualKwh,
        annualSavingsUSD,
        shadingRisk,
        shadeNote: buildShadeNote(shadingRisk, obstructionOutlines.length),
        roofOutline,
        usableOutline,
        obstructionOutlines,
        roofSegments,
        confidence,
        confidenceNote:
          confidence === "high"
            ? "Roof geometry was generated directly from the satellite image using the deterministic rooftop pipeline."
            : "Roof geometry was estimated from satellite image features using the deterministic rooftop pipeline.",
        source: "modeled",
      },
      fallback
    );

    setCache(cacheKey, normalized);
    return normalized;
  } catch (error) {
    const normalized = normalizeRoofAnalysis(
      {
        ...fallback,
        confidence: "low",
        confidenceNote:
          error instanceof Error
            ? `The deterministic rooftop scan fell back to a modeled estimate: ${error.message}`
            : "The deterministic rooftop scan fell back to a modeled estimate.",
        source: "modeled",
      },
      fallback
    );
    setCache(cacheKey, normalized);
    return normalized;
  }
}

function setCache(key: string, analysis: RoofAnalysis) {
  analysisCache.set(key, {
    createdAt: Date.now(),
    analysis,
  });
}

function sampleImage(width: number, height: number, rgba: Uint8Array) {
  const cells: SampleCell[] = [];
  const xStep = width / SAMPLE_SIZE;
  const yStep = height / SAMPLE_SIZE;

  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      const sourceX = clamp(Math.floor((x + 0.5) * xStep), 0, width - 1);
      const sourceY = clamp(Math.floor((y + 0.5) * yStep), 0, height - 1);
      const offset = (sourceY * width + sourceX) * 4;
      const r = rgba[offset] ?? 0;
      const g = rgba[offset + 1] ?? 0;
      const b = rgba[offset + 2] ?? 0;
      const { h, s, v } = rgbToHsv(r, g, b);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const centrality = getCentrality(x, y, SAMPLE_SIZE);
      const vegetation =
        h >= 60 && h <= 170 && s > 0.22 && v > 0.18 && luma < 0.78;
      const water = h >= 155 && h <= 255 && s > 0.2 && v > 0.2;
      const shadow = luma < 0.19;
      const roofLike =
        !vegetation &&
        !water &&
        !shadow &&
        s < 0.42 &&
        luma > 0.2 &&
        luma < 0.86;
      const score =
        centrality * 1.2 +
        (roofLike ? 0.85 : -0.45) -
        (vegetation ? 1.1 : 0) -
        (water ? 1.5 : 0) -
        (shadow ? 0.5 : 0) -
        Math.abs(luma - 0.54) * 0.55 -
        Math.max(0, s - 0.18) * 0.35;

      cells.push({
        x,
        y,
        luma,
        saturation: s,
        hue: h,
        score,
        centrality,
        vegetation,
        water,
        shadow,
        roofLike,
      });
    }
  }

  return cells;
}

function extractRoofComponents(cells: SampleCell[]) {
  const mask = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);

  for (const cell of cells) {
    const index = cell.y * SAMPLE_SIZE + cell.x;
    mask[index] =
      cell.score > 0.72 || (cell.roofLike && cell.centrality > 0.36) ? 1 : 0;
  }

  const visited = new Uint8Array(mask.length);
  const components: RoofComponent[] = [];
  const neighborhood = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let startIndex = 0; startIndex < mask.length; startIndex += 1) {
    if (!mask[startIndex] || visited[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    visited[startIndex] = 1;
    const points: Array<{ x: number; y: number }> = [];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let sumX = 0;
    let sumY = 0;
    let scoreSum = 0;
    let lumaSum = 0;
    let saturationSum = 0;

    while (stack.length) {
      const index = stack.pop()!;
      const x = index % SAMPLE_SIZE;
      const y = Math.floor(index / SAMPLE_SIZE);
      const cell = cells[index];

      points.push({ x, y });
      sumX += x;
      sumY += y;
      scoreSum += cell.score;
      lumaSum += cell.luma;
      saturationSum += cell.saturation;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      for (const [dx, dy] of neighborhood) {
        const nextX = x + dx;
        const nextY = y + dy;

        if (
          nextX < 0 ||
          nextX >= SAMPLE_SIZE ||
          nextY < 0 ||
          nextY >= SAMPLE_SIZE
        ) {
          continue;
        }

        const nextIndex = nextY * SAMPLE_SIZE + nextX;

        if (!mask[nextIndex] || visited[nextIndex]) {
          continue;
        }

        visited[nextIndex] = 1;
        stack.push(nextIndex);
      }
    }

    if (points.length < 160) {
      continue;
    }

    const centroidX = sumX / points.length;
    const centroidY = sumY / points.length;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const bboxArea = width * height;
    const compactness = clamp(points.length / Math.max(1, bboxArea), 0, 1);
    const centrality = getCentrality(centroidX, centroidY, SAMPLE_SIZE);

    if (centrality < 0.25) {
      continue;
    }

    const { angleRad, widthPx, depthPx } = getPrincipalAxes(points, centroidX, centroidY);

    components.push({
      cells: points,
      area: points.length,
      centroidX,
      centroidY,
      averageScore: scoreSum / points.length,
      averageLuma: lumaSum / points.length,
      averageSaturation: saturationSum / points.length,
      minX,
      maxX,
      minY,
      maxY,
      angleRad,
      halfWidth: width / 2,
      halfHeight: height / 2,
      compactness,
      widthPx,
      depthPx,
    });
  }

  return components.sort((left, right) => scoreComponent(right) - scoreComponent(left));
}

function scoreComponent(component: RoofComponent) {
  return (
    component.area *
    component.averageScore *
    getCentrality(component.centroidX, component.centroidY, SAMPLE_SIZE) *
    (0.72 + component.compactness)
  );
}

function createBoundingBox(component: RoofComponent): BoundingBox {
  const angle = component.angleRad;
  const axisX = { x: Math.cos(angle), y: Math.sin(angle) };
  const axisY = { x: -Math.sin(angle), y: Math.cos(angle) };

  return {
    centerX: component.centroidX,
    centerY: component.centroidY,
    axisX,
    axisY,
    halfWidth: component.widthPx / 2,
    halfHeight: component.depthPx / 2,
  };
}

function summarizeContext(
  cells: SampleCell[],
  component: RoofComponent,
  components: RoofComponent[]
): ContextStats {
  const ringMinX = Math.max(0, component.minX - 18);
  const ringMaxX = Math.min(SAMPLE_SIZE - 1, component.maxX + 18);
  const ringMinY = Math.max(0, component.minY - 18);
  const ringMaxY = Math.min(SAMPLE_SIZE - 1, component.maxY + 18);
  let ringCount = 0;
  let pavedCount = 0;
  let vegetationCount = 0;
  let roofLikeCount = 0;
  let lumaSum = 0;
  let lumaSqSum = 0;

  for (const cell of cells) {
    if (
      cell.x < ringMinX ||
      cell.x > ringMaxX ||
      cell.y < ringMinY ||
      cell.y > ringMaxY
    ) {
      continue;
    }

    const insideComponentBounds =
      cell.x >= component.minX &&
      cell.x <= component.maxX &&
      cell.y >= component.minY &&
      cell.y <= component.maxY;

    if (insideComponentBounds) {
      continue;
    }

    ringCount += 1;
    lumaSum += cell.luma;
    lumaSqSum += cell.luma * cell.luma;

    if (
      !cell.vegetation &&
      !cell.water &&
      !cell.shadow &&
      cell.saturation < 0.16 &&
      cell.luma > 0.28 &&
      cell.luma < 0.78
    ) {
      pavedCount += 1;
    }

    if (cell.vegetation) {
      vegetationCount += 1;
    }

    if (cell.roofLike) {
      roofLikeCount += 1;
    }
  }

  const nearbyComponents = components.filter((candidate) => {
    if (candidate === component) {
      return false;
    }

    const distance = Math.hypot(
      candidate.centroidX - component.centroidX,
      candidate.centroidY - component.centroidY
    );

    return distance < 54;
  });

  const lumaMean = ringCount ? lumaSum / ringCount : 0;
  const lumaVariance = ringCount ? lumaSqSum / ringCount - lumaMean ** 2 : 0;

  return {
    nearbyPavedRatio: ringCount ? pavedCount / ringCount : 0,
    nearbyVegetationRatio: ringCount ? vegetationCount / ringCount : 0,
    nearbyRoofLikeRatio: ringCount ? roofLikeCount / ringCount : 0,
    nearbyRoofCount: nearbyComponents.length,
    nearbyLargeRoofCount: nearbyComponents.filter((candidate) => candidate.area > 220)
      .length,
    surroundingUniformity: clamp(1 - lumaVariance * 9, 0, 1),
  };
}

function buildRoofOutline(box: BoundingBox, roofShape: RoofShape): RoofPoint[] {
  const corners = [
    pointFromBox(box, -1, -1),
    pointFromBox(box, 1, -1),
    pointFromBox(box, 1, 1),
    pointFromBox(box, -1, 1),
  ];

  if (roofShape === "flat") {
    return corners;
  }

  if (roofShape === "shed") {
    return [
      pointFromBox(box, -0.95, -1),
      pointFromBox(box, 1, -0.92),
      pointFromBox(box, 0.9, 1),
      pointFromBox(box, -1, 0.88),
    ];
  }

  if (roofShape === "gable") {
    return [
      pointFromBox(box, -0.96, -0.92),
      pointFromBox(box, 0.96, -0.92),
      pointFromBox(box, 1, 0.62),
      pointFromBox(box, 0.14, 1),
      pointFromBox(box, -1, 0.72),
    ];
  }

  if (roofShape === "complex") {
    return [
      pointFromBox(box, -0.9, -0.96),
      pointFromBox(box, 0.42, -1),
      pointFromBox(box, 0.96, -0.64),
      pointFromBox(box, 1, 0.48),
      pointFromBox(box, 0.48, 1),
      pointFromBox(box, -0.28, 0.94),
      pointFromBox(box, -1, 0.44),
      pointFromBox(box, -0.96, -0.42),
    ];
  }

  return [
    pointFromBox(box, -0.82, -1),
    pointFromBox(box, 0.82, -1),
    pointFromBox(box, 1, -0.12),
    pointFromBox(box, 0.86, 1),
    pointFromBox(box, -0.86, 1),
    pointFromBox(box, -1, -0.12),
  ];
}

function pointFromBox(box: BoundingBox, localX: number, localY: number): RoofPoint {
  return {
    x: roundTo(
      ((box.centerX +
        box.axisX.x * box.halfWidth * localX +
        box.axisY.x * box.halfHeight * localY) /
        SAMPLE_SIZE) *
        100,
      1
    ),
    y: roundTo(
      ((box.centerY +
        box.axisX.y * box.halfWidth * localX +
        box.axisY.y * box.halfHeight * localY) /
        SAMPLE_SIZE) *
        100,
      1
    ),
  };
}

function detectObstructionOutlines(
  cells: SampleCell[],
  component: RoofComponent,
  box: BoundingBox
) {
  const componentSet = new Set(component.cells.map((cell) => `${cell.x},${cell.y}`));
  const shadowIndices: number[] = [];

  cells.forEach((cell, index) => {
    if (!componentSet.has(`${cell.x},${cell.y}`)) {
      return;
    }

    if (cell.shadow || (cell.luma < component.averageLuma * 0.72 && cell.saturation < 0.24)) {
      shadowIndices.push(index);
    }
  });

  if (!shadowIndices.length) {
    return [];
  }

  const shadowMask = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);

  for (const index of shadowIndices) {
    shadowMask[index] = 1;
  }

  const visited = new Uint8Array(shadowMask.length);
  const outlines: RoofPoint[][] = [];

  for (const startIndex of shadowIndices) {
    if (visited[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    visited[startIndex] = 1;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let count = 0;

    while (stack.length) {
      const index = stack.pop()!;
      const x = index % SAMPLE_SIZE;
      const y = Math.floor(index / SAMPLE_SIZE);
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nextX = x + dx;
        const nextY = y + dy;

        if (
          nextX < 0 ||
          nextX >= SAMPLE_SIZE ||
          nextY < 0 ||
          nextY >= SAMPLE_SIZE
        ) {
          continue;
        }

        const nextIndex = nextY * SAMPLE_SIZE + nextX;

        if (!shadowMask[nextIndex] || visited[nextIndex]) {
          continue;
        }

        visited[nextIndex] = 1;
        stack.push(nextIndex);
      }
    }

    if (count < 24) {
      continue;
    }

    const normalized = rectangleToPolygon(minX, minY, maxX, maxY);

    if (polygonCenterDistance(normalized, buildRoofOutline(box, "flat")) > 48) {
      continue;
    }

    outlines.push(normalized);
  }

  return outlines.slice(0, 3);
}

function rectangleToPolygon(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    toNormalizedPoint(minX, minY),
    toNormalizedPoint(maxX, minY),
    toNormalizedPoint(maxX, maxY),
    toNormalizedPoint(minX, maxY),
  ];
}

function toNormalizedPoint(x: number, y: number): RoofPoint {
  return {
    x: roundTo((x / SAMPLE_SIZE) * 100, 1),
    y: roundTo((y / SAMPLE_SIZE) * 100, 1),
  };
}

function buildRoofSegments(params: {
  roofBox: BoundingBox;
  roofShape: RoofShape;
  widthM: number;
  depthM: number;
  pitchDeg: number;
  primaryRoofAzimuth: number;
  usablePctRoof: number;
}) {
  const totalArea = params.widthM * params.depthM * (params.usablePctRoof / 100);
  const primaryArea = roundTo(totalArea * 0.5, 1);
  const secondaryArea = roundTo(totalArea * 0.27, 1);
  const garageArea = roundTo(Math.max(totalArea - primaryArea - secondaryArea, 8), 1);

  return [
    createSegment(
      "primary",
      params.roofBox,
      -1,
      -0.28,
      primaryArea,
      params.pitchDeg,
      params.primaryRoofAzimuth,
      true
    ),
    createSegment(
      "secondary",
      params.roofBox,
      -0.12,
      0.3,
      secondaryArea,
      Math.max(params.pitchDeg - 2, 10),
      (params.primaryRoofAzimuth + 18) % 360,
      true
    ),
    createSegment(
      "garage",
      params.roofBox,
      0.34,
      0.92,
      garageArea,
      Math.max(params.pitchDeg - 4, 8),
      (params.primaryRoofAzimuth + 356) % 360,
      true
    ),
  ];
}

function createSegment(
  label: RoofPlaneLabel,
  box: BoundingBox,
  start: number,
  end: number,
  areaM2: number,
  pitchDeg: number,
  azimuthDeg: number,
  usable: boolean
) {
  const leftInset = label === "secondary" ? 0.12 : 0.06;
  const rightInset = label === "garage" ? 0.14 : 0.08;

  return {
    label,
    pitchDeg,
    azimuthDeg,
    areaM2,
    panelsFit: Math.max(2, Math.round(areaM2 / 3.25)),
    usable,
    outline: [
      pointFromBox(box, -0.88 + leftInset, start),
      pointFromBox(box, 0.88 - rightInset, start + 0.04),
      pointFromBox(box, 0.82 - rightInset, end),
      pointFromBox(box, -0.84 + leftInset, end + 0.02),
    ],
  };
}

function classifyPropertyType(
  address: string,
  component: RoofComponent,
  context: ContextStats,
  widthM: number,
  depthM: number,
  roofAreaM2: number
) {
  const areaShare = component.area / (SAMPLE_SIZE * SAMPLE_SIZE);
  const normalizedAddress = address.toLowerCase();
  const highTrafficAddress =
    /\b(blvd|boulevard|pkwy|parkway|hwy|highway|loop|center|centre)\b/.test(
      normalizedAddress
    );
  const multifamilyHint =
    /\b(apt|apartment|suite|ste|unit|#)\b/.test(normalizedAddress);

  if (
    roofAreaM2 > 360 ||
    widthM > 27 ||
    depthM > 24 ||
    areaShare > 0.32 ||
    context.nearbyLargeRoofCount >= 2
  ) {
    return "commercial" as const;
  }

  if (
    (context.nearbyPavedRatio > 0.42 &&
      context.nearbyVegetationRatio < 0.16 &&
      context.surroundingUniformity > 0.62) ||
    (highTrafficAddress &&
      context.nearbyPavedRatio > 0.22 &&
      context.nearbyVegetationRatio < 0.18) ||
    (context.nearbyRoofLikeRatio > 0.44 && context.nearbyRoofCount >= 3) ||
    (context.nearbyRoofCount >= 3 &&
      context.nearbyPavedRatio > 0.3 &&
      component.compactness < 0.58) ||
    (roofAreaM2 > 210 && context.nearbyPavedRatio > 0.28)
  ) {
    return "commercial" as const;
  }

  if (
    roofAreaM2 < 48 ||
    component.compactness < 0.22 ||
    multifamilyHint ||
    (context.nearbyPavedRatio > 0.52 && context.nearbyVegetationRatio < 0.1) ||
    (context.nearbyRoofCount >= 4 && context.surroundingUniformity > 0.7)
  ) {
    return "unknown" as const;
  }

  return "residential" as const;
}

function inferRoofShape(component: RoofComponent): RoofShape {
  const aspectRatio = component.widthPx / Math.max(component.depthPx, 1);

  if (component.compactness < 0.38) {
    return "complex";
  }

  if (aspectRatio > 1.55) {
    return "gable";
  }

  if (aspectRatio < 0.78) {
    return "shed";
  }

  if (component.compactness > 0.72) {
    return "flat";
  }

  return "hip";
}

function inferPitch(component: RoofComponent, obstructionRatio: number) {
  return clamp(
    Math.round(18 + (0.6 - component.averageLuma) * 18 + obstructionRatio * 24),
    10,
    30
  );
}

function inferAzimuth(angleRad: number) {
  const angleDeg = (((angleRad * 180) / Math.PI) % 180 + 180) % 180;
  const centered = angleDeg - 90;
  return Math.round((180 + clamp(centered, -32, 32) + 360) % 360);
}

function classifyShadingRisk(obstructionRatio: number): ShadingRisk {
  if (obstructionRatio > 0.12) {
    return "high";
  }

  if (obstructionRatio > 0.05) {
    return "medium";
  }

  return "low";
}

function classifyConfidence(
  component: RoofComponent,
  obstructionRatio: number
): AnalysisConfidence {
  if (component.compactness > 0.6 && component.averageScore > 1.2 && obstructionRatio < 0.08) {
    return "high";
  }

  if (component.compactness > 0.38 && component.averageScore > 0.85) {
    return "medium";
  }

  return "low";
}

function buildShadeNote(shadingRisk: ShadingRisk, obstructionCount: number) {
  if (shadingRisk === "high") {
    return `Detected ${obstructionCount} darker rooftop obstruction zones that could meaningfully affect production.`;
  }

  if (shadingRisk === "medium") {
    return `Detected ${obstructionCount} minor rooftop obstruction zones, but the roof still appears broadly usable for solar.`;
  }

  return "No significant shading detected across the main roof planes.";
}

function estimateObstructionRatio(
  obstructions: RoofPoint[][],
  roofOutline: RoofPoint[]
) {
  const obstructionArea = obstructions.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
  const roofArea = Math.max(polygonArea(roofOutline), 1);

  return obstructionArea / roofArea;
}

function polygonArea(points: RoofPoint[]) {
  let area = 0;

  for (let current = 0; current < points.length; current += 1) {
    const next = (current + 1) % points.length;
    area += points[current].x * points[next].y - points[next].x * points[current].y;
  }

  return Math.abs(area) / 2;
}

function polygonCenterDistance(polygon: RoofPoint[], other: RoofPoint[]) {
  const center = averagePoint(polygon);
  const otherCenter = averagePoint(other);

  return Math.hypot(center.x - otherCenter.x, center.y - otherCenter.y);
}

function averagePoint(points: RoofPoint[]) {
  return points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
    }),
    { x: 0, y: 0 }
  );
}

function getPrincipalAxes(
  points: Array<{ x: number; y: number }>,
  centroidX: number,
  centroidY: number
) {
  let xx = 0;
  let yy = 0;
  let xy = 0;

  for (const point of points) {
    const dx = point.x - centroidX;
    const dy = point.y - centroidY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }

  const angleRad = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axisX = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const axisY = { x: -Math.sin(angleRad), y: Math.cos(angleRad) };
  let minPrimary = Number.POSITIVE_INFINITY;
  let maxPrimary = Number.NEGATIVE_INFINITY;
  let minSecondary = Number.POSITIVE_INFINITY;
  let maxSecondary = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const dx = point.x - centroidX;
    const dy = point.y - centroidY;
    const alongPrimary = dx * axisX.x + dy * axisX.y;
    const alongSecondary = dx * axisY.x + dy * axisY.y;
    minPrimary = Math.min(minPrimary, alongPrimary);
    maxPrimary = Math.max(maxPrimary, alongPrimary);
    minSecondary = Math.min(minSecondary, alongSecondary);
    maxSecondary = Math.max(maxSecondary, alongSecondary);
  }

  return {
    angleRad,
    widthPx: maxPrimary - minPrimary,
    depthPx: maxSecondary - minSecondary,
  };
}

function getCentrality(x: number, y: number, size: number) {
  const center = (size - 1) / 2;
  const dx = (x - center) / center;
  const dy = (y - center) / center;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return clamp(1 - distance, 0, 1);
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);

  if (hue < 0) {
    hue += 360;
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function roundTo(value: number, precision: number) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
