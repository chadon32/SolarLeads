import {
  latLngToLocalMeters,
  normalizedOutlineToLatLng,
  type LatLng,
  type LocalPoint,
} from "@/lib/roof-scene-geometry";
import { selectCohesiveSolarPanels } from "@/lib/panel-layout";
import type { SolarReportSnapshot } from "@/lib/report-snapshot";
import type { SolarPanelPlacement } from "@/lib/roof-analysis";

/**
 * A small, serializable vector model for the report PDF.
 *
 * Coordinates are projected, but intentionally not fitted to a page or card.
 * The caller can translate and scale `points` using `extents`. The model uses
 * only saved Solar API roof faces and panel placements; it never creates a
 * replacement house or panel array.
 */

export type ReportRoofIllustrationKind = "roof" | "wall" | "panel";

export type ReportRoofIllustrationPoint = {
  x: number;
  y: number;
};

export type ReportRoofIllustrationPolygon = {
  kind: ReportRoofIllustrationKind;
  points: ReportRoofIllustrationPoint[];
  /** Camera-space depth; preserve the returned surface-group draw order. */
  depth: number;
  /** Restrained fill/stroke colors for vector PDF renderers. */
  fill: string;
  stroke: string;
  /** Relative light response, in the inclusive range [0, 1]. */
  shade: number;
  segmentIndex?: number;
  panelIndex?: number;
};

export type ReportRoofIllustrationExtents = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minDepth: number;
  maxDepth: number;
  width: number;
  height: number;
  depth: number;
};

export type ReportRoofIllustration = {
  availability: "available" | "unavailable";
  available: boolean;
  title: string;
  caption: string;
  /** Primary name for the PDF route. */
  projectedPolygons: ReportRoofIllustrationPolygon[];
  /** Alias kept convenient for callers that already use `polygons`. */
  polygons: ReportRoofIllustrationPolygon[];
  extents: ReportRoofIllustrationExtents | null;
  renderedPanelCount: number;
  limitationLabels: string[];
};

type ModelPoint = {
  x: number;
  y: number;
  z: number;
};

type ModelPolygon = {
  kind: ReportRoofIllustrationKind;
  vertices: ModelPoint[];
  fill: string;
  stroke: string;
  shade: number;
  segmentIndex?: number;
  panelIndex?: number;
};

type IllustrationFace = {
  segmentIndex: number;
  points: LocalPoint[];
  pitchDeg: number;
  azimuthDeg: number;
  planeOffsetMeters: number;
  heightAt: (point: LocalPoint) => number;
};

type ValidBounds = {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
};

type Vector3 = ModelPoint;

const APPROXIMATE_HEIGHT_LABEL =
  "Approximate roof-plane height inferred from pitch; not a DSM or elevation scan.";
const UNAVAILABLE_GEOMETRY_LABEL =
  "Saved Solar API roof geometry is unavailable for this report.";
const PANEL_LIMITATION_LABEL =
  "Some saved panel placements were malformed or outside valid saved roof faces.";
const NO_PANEL_LABEL = "No valid saved panel placements were available to render.";

const APPROXIMATE_ROOF_BASE_HEIGHT_METERS = 3.2;
const PANEL_STANDOFF_METERS = 0.08;
const MIN_PANEL_DIMENSION_METERS = 0.1;
const MAX_PITCH_DEG = 75;
const POINT_TOLERANCE_METERS = 0.15;
const CAMERA_AZIMUTH_DEG = 135;
const CAMERA_ELEVATION_DEG = 29;

const ROOF_FILLS = ["#465b70", "#51687c", "#3f5368"];
const ROOF_STROKE = "#26394d";
const WALL_FILLS = ["#263747", "#2d4051", "#213241"];
const WALL_STROKE = "#182737";
const PANEL_FILL = "#102a49";
const PANEL_STROKE = "#6c87a2";

/**
 * Build a server-safe perspective illustration from one immutable report
 * snapshot. The output is suitable for PDF/SVG drawing and contains no DOM,
 * WebGL, image, or network dependency.
 */
export function buildReportRoofIllustration(
  snapshot: SolarReportSnapshot | null | undefined
): ReportRoofIllustration {
  const root = asRecord(snapshot);
  const analysis = asRecord(root?.roofAnalysis);

  if (
    !analysis ||
    analysis.source !== "solar-api" ||
    analysis.validSite !== true ||
    analysis.rooftopDetected !== true
  ) {
    return unavailable(UNAVAILABLE_GEOMETRY_LABEL);
  }

  const bounds = readBounds(analysis.roofBounds);
  if (!bounds) {
    return unavailable(UNAVAILABLE_GEOMETRY_LABEL);
  }

  const rawSegments = Array.isArray(analysis.roofSegments)
    ? analysis.roofSegments
    : [];
  if (!rawSegments.length) {
    return unavailable(UNAVAILABLE_GEOMETRY_LABEL);
  }

  const origin = {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
  };
  const fallbackPitch = finiteNumber(analysis.pitchDeg);
  const fallbackAzimuth = finiteNumber(analysis.primaryRoofAzimuth);
  const faces: IllustrationFace[] = [];
  let skippedFaceCount = 0;

  rawSegments.forEach((value, index) => {
    const segment = asRecord(value);
    const face = segment
      ? buildFace({
          bounds,
          origin,
          segment,
          segmentArrayIndex: index,
          fallbackPitch,
          fallbackAzimuth,
        })
      : null;
    if (face) {
      faces.push(face);
    } else {
      skippedFaceCount += 1;
    }
  });

  if (!faces.length) {
    return unavailable(UNAVAILABLE_GEOMETRY_LABEL);
  }

  const modelPolygons: ModelPolygon[] = [];
  const modelPoints: ModelPoint[] = [];

  for (const face of faces) {
    const roofVertices = face.points.map((point) => ({
      x: point.x,
      y: face.heightAt(point),
      z: point.z,
    }));
    if (!allFiniteModelPoints(roofVertices)) {
      continue;
    }

    const roofShade = getRoofShade(face.pitchDeg, face.azimuthDeg);
    const roofPolygon: ModelPolygon = {
      kind: "roof",
      vertices: roofVertices,
      fill: ROOF_FILLS[Math.min(ROOF_FILLS.length - 1, Math.round((1 - roofShade) * 2))],
      stroke: ROOF_STROKE,
      shade: roofShade,
      segmentIndex: face.segmentIndex,
    };
    modelPolygons.push(roofPolygon);
    modelPoints.push(...roofVertices);

    for (let edgeIndex = 0; edgeIndex < roofVertices.length; edgeIndex += 1) {
      const nextIndex = (edgeIndex + 1) % roofVertices.length;
      const topLeft = roofVertices[edgeIndex];
      const topRight = roofVertices[nextIndex];
      const wallVertices = [
        topLeft,
        topRight,
        { x: topRight.x, y: 0, z: topRight.z },
        { x: topLeft.x, y: 0, z: topLeft.z },
      ];
      if (!allFiniteModelPoints(wallVertices)) {
        continue;
      }

      const wallShade = getWallShade(topLeft, topRight);
      modelPolygons.push({
        kind: "wall",
        vertices: wallVertices,
        fill: WALL_FILLS[Math.min(WALL_FILLS.length - 1, Math.round((1 - wallShade) * 2))],
        stroke: WALL_STROKE,
        shade: wallShade,
        segmentIndex: face.segmentIndex,
      });
      modelPoints.push(...wallVertices);
    }

  }

  const rawPanels = Array.isArray(analysis.solarPanels) ? analysis.solarPanels : [];
  const requestedPanelCount = getRequestedPanelCount(root ?? {}, analysis);
  const panelWidth = positiveNumber(analysis.panelWidthMeters);
  const panelHeight = positiveNumber(analysis.panelHeightMeters);
  let skippedPanelCount = 0;
  let renderedPanelCount = 0;

  const validPanelCandidates: SolarPanelPlacement[] = [];
  const originalPanelIndices = new Map<SolarPanelPlacement, number>();
  if (panelWidth && panelHeight) {
    rawPanels.forEach((value, index) => {
      const panel = asRecord(value);
      // Select the same cohort as the app before testing drawable roof faces.
      // Filtering by roof containment first would silently substitute panels.
      if (panel && readLatLng(panel.center) && integerNumber(panel.segmentIndex) !== null &&
          (panel.orientation === "PORTRAIT" || panel.orientation === "LANDSCAPE") &&
          finiteNumber(panel.pitchDeg) !== null && finiteNumber(panel.azimuthDeg) !== null &&
          finiteNumber(panel.yearlyEnergyDcKwh) !== null) {
        const placement = value as SolarPanelPlacement;
        validPanelCandidates.push(placement);
        originalPanelIndices.set(placement, index);
      } else {
        skippedPanelCount += 1;
      }
    });
  } else {
    skippedPanelCount = rawPanels.length;
  }

  const targetPanelCount = Math.min(
    requestedPanelCount ?? validPanelCandidates.length,
    validPanelCandidates.length
  );
  const selectedPanels =
    panelWidth && panelHeight
      ? selectCohesiveSolarPanels({
          panels: validPanelCandidates,
          targetCount: targetPanelCount,
          panelWidthMeters: panelWidth,
          panelHeightMeters: panelHeight,
        })
      : [];

  if (panelWidth && panelHeight) {
    selectedPanels.forEach((value) => {
      const panel = asRecord(value);
      const panelIndex = originalPanelIndices.get(value) ?? -1;
      const result = panel
        ? buildPanelPolygon({
            faceList: faces,
            panel,
            panelHeight,
            panelWidth,
            origin,
          })
        : null;

      if (!result || panelIndex < 0) {
        skippedPanelCount += 1;
        return;
      }

      modelPolygons.push({
        kind: "panel",
        vertices: result.vertices,
        fill: PANEL_FILL,
        stroke: PANEL_STROKE,
        shade: result.shade,
        segmentIndex: result.segmentIndex,
        panelIndex,
      });
      modelPoints.push(...result.vertices);
      renderedPanelCount += 1;
    });
  }

  if (!modelPolygons.length || !modelPoints.length) {
    return unavailable(UNAVAILABLE_GEOMETRY_LABEL);
  }

  const camera = buildCamera(modelPoints);
  const projected = modelPolygons
    .map((polygon) => projectPolygon(polygon, camera))
    .filter((polygon): polygon is ReportRoofIllustrationPolygon => polygon !== null);
  const orderedProjected = orderProjectedPolygons(projected);

  if (!orderedProjected.length) {
    return unavailable(UNAVAILABLE_GEOMETRY_LABEL);
  }

  const labels = [APPROXIMATE_HEIGHT_LABEL];
  if (skippedFaceCount > 0) {
    labels.push("Some saved roof faces were malformed and were omitted from the illustration.");
  }
  if (!selectedPanels.length || renderedPanelCount === 0) {
    labels.push(NO_PANEL_LABEL);
  } else if (skippedPanelCount > 0) {
    labels.push(PANEL_LIMITATION_LABEL);
  }

  const extents = getExtents(orderedProjected);
  return {
    availability: "available",
    available: true,
    title: "Roof layout illustration",
    caption:
      "Illustrative roof planes and saved panel placements. Roof height is approximate and is not a DSM or elevation scan.",
    projectedPolygons: orderedProjected,
    polygons: orderedProjected,
    extents,
    renderedPanelCount,
    limitationLabels: labels,
  };
}

/** Naming variant for callers that prefer the noun-first form. */
export const buildRoofReportIllustration = buildReportRoofIllustration;

function buildFace({
  bounds,
  origin,
  segment,
  segmentArrayIndex,
  fallbackPitch,
  fallbackAzimuth,
}: {
  bounds: ValidBounds;
  origin: LatLng;
  segment: Record<string, unknown>;
  segmentArrayIndex: number;
  fallbackPitch: number | null;
  fallbackAzimuth: number | null;
}): IllustrationFace | null {
  const rawOutline = segment.outline;
  if (!Array.isArray(rawOutline) || rawOutline.length < 3) {
    return null;
  }

  const outline = rawOutline.map((value) => {
    const point = asRecord(value);
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    return x !== null && y !== null && x >= 0 && x <= 100 && y >= 0 && y <= 100
      ? { x, y }
      : null;
  });
  if (outline.some((point) => point === null)) {
    return null;
  }

  const roofPoints = normalizedOutlineToLatLng(
    outline as Array<{ x: number; y: number }>,
    bounds
  )
    .map((point) => latLngToLocalMeters(point, origin))
    .filter(isFiniteLocalPoint);
  const points = removeDuplicatePoints(roofPoints);
  if (points.length < 3 || Math.abs(polygonArea(points)) < 0.05) {
    return null;
  }

  const pitch = clampPitch(
    finiteNumber(segment.pitchDeg) ?? fallbackPitch
  );
  const azimuth = normalizeAzimuth(
    finiteNumber(segment.azimuthDeg) ?? fallbackAzimuth
  );
  if (pitch === null || azimuth === null) {
    return null;
  }

  const pitchRad = (pitch * Math.PI) / 180;
  const azimuthRad = (azimuth * Math.PI) / 180;
  const tangent = Math.tan(pitchRad);
  const downslope = (point: LocalPoint) =>
    point.x * Math.sin(azimuthRad) - point.z * Math.cos(azimuthRad);
  const minPlaneDelta = Math.min(
    ...points.map((point) => -tangent * downslope(point))
  );
  const planeOffsetMeters =
    APPROXIMATE_ROOF_BASE_HEIGHT_METERS - minPlaneDelta;
  const heightAt = (point: LocalPoint) =>
    planeOffsetMeters - tangent * downslope(point);
  const segmentIndex =
    integerNumber(segment.segmentIndex) ?? segmentArrayIndex;

  return {
    segmentIndex,
    points,
    pitchDeg: pitch,
    azimuthDeg: azimuth,
    planeOffsetMeters,
    heightAt,
  };
}

function buildPanelPolygon({
  faceList,
  panel,
  panelHeight,
  panelWidth,
  origin,
}: {
  faceList: IllustrationFace[];
  panel: Record<string, unknown>;
  panelHeight: number;
  panelWidth: number;
  origin: LatLng;
}): { vertices: ModelPoint[]; shade: number; segmentIndex: number } | null {
  const center = readLatLng(panel.center);
  const orientation = panel.orientation;
  const segmentIndex = integerNumber(panel.segmentIndex);
  if (
    !center ||
    (orientation !== "PORTRAIT" && orientation !== "LANDSCAPE") ||
    segmentIndex === null
  ) {
    return null;
  }

  const face = faceList.find((candidate) => candidate.segmentIndex === segmentIndex);
  if (!face) {
    return null;
  }

  const localCenter = latLngToLocalMeters(center, origin);
  if (!pointInPolygon(localCenter, face.points, POINT_TOLERANCE_METERS)) {
    return null;
  }

  const pitchRad = (face.pitchDeg * Math.PI) / 180;
  const azimuthRad = (face.azimuthDeg * Math.PI) / 180;
  const alongMeters = orientation === "LANDSCAPE" ? panelWidth : panelHeight;
  const acrossMeters = orientation === "LANDSCAPE" ? panelHeight : panelWidth;
  if (
    alongMeters < MIN_PANEL_DIMENSION_METERS ||
    acrossMeters < MIN_PANEL_DIMENSION_METERS
  ) {
    return null;
  }

  const alongUnit = {
    x: Math.sin(azimuthRad),
    z: -Math.cos(azimuthRad),
  };
  const acrossUnit = {
    x: Math.cos(azimuthRad),
    z: Math.sin(azimuthRad),
  };
  const halfAlongGround = (alongMeters * Math.cos(pitchRad)) / 2;
  const halfAlongHeight = (alongMeters * Math.sin(pitchRad)) / 2;
  const halfAcross = acrossMeters / 2;
  const centerHeight = face.heightAt(localCenter) + PANEL_STANDOFF_METERS;
  const makeCorner = (alongSign: number, acrossSign: number): ModelPoint => ({
    x:
      localCenter.x +
      alongUnit.x * halfAlongGround * alongSign +
      acrossUnit.x * halfAcross * acrossSign,
    y: centerHeight - halfAlongHeight * alongSign,
    z:
      localCenter.z +
      alongUnit.z * halfAlongGround * alongSign +
      acrossUnit.z * halfAcross * acrossSign,
  });
  const vertices = [
    makeCorner(1, -1),
    makeCorner(1, 1),
    makeCorner(-1, 1),
    makeCorner(-1, -1),
  ];

  if (
    vertices.some(
      (vertex) =>
        !pointInPolygon(
          { x: vertex.x, z: vertex.z },
          face.points,
          POINT_TOLERANCE_METERS
        )
    )
  ) {
    return null;
  }

  if (!allFiniteModelPoints(vertices)) {
    return null;
  }

  return {
    vertices,
    shade: getPanelShade(face.pitchDeg, face.azimuthDeg),
    segmentIndex,
  };
}

function buildCamera(points: ModelPoint[]) {
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const zValues = points.map((point) => point.z);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 3);
  const distance = Math.max(span * 3.5, 24);
  const target: Vector3 = {
    x: (minX + maxX) / 2,
    y: minY + (maxY - minY) * 0.45,
    z: (minZ + maxZ) / 2,
  };
  const azimuthRad = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
  const elevationRad = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
  const horizontal = {
    x: Math.sin(azimuthRad),
    z: -Math.cos(azimuthRad),
  };
  const cameraPosition: Vector3 = {
    x: target.x + horizontal.x * distance,
    y: target.y + distance * Math.tan(elevationRad),
    z: target.z + horizontal.z * distance,
  };
  const forward = normalizeVector(subtract(target, cameraPosition));
  const right = normalizeVector(crossProduct(forward, { x: 0, y: 1, z: 0 }));
  const up = normalizeVector(crossProduct(right, forward));

  return {
    cameraPosition,
    forward,
    right,
    up,
    focalLength: distance * 0.95,
  };
}

function projectPolygon(
  polygon: ModelPolygon,
  camera: ReturnType<typeof buildCamera>
): ReportRoofIllustrationPolygon | null {
  const projected: ReportRoofIllustrationPoint[] = [];
  const depths: number[] = [];
  for (const point of polygon.vertices) {
    const relative = subtract(point, camera.cameraPosition);
    const depth = dotProduct(relative, camera.forward);
    if (!Number.isFinite(depth) || depth <= 0.001) {
      return null;
    }
    const x = (camera.focalLength * dotProduct(relative, camera.right)) / depth;
    const y = (camera.focalLength * dotProduct(relative, camera.up)) / depth;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    projected.push({ x, y });
    depths.push(depth);
  }

  return {
    kind: polygon.kind,
    points: projected,
    depth: depths.reduce((sum, value) => sum + value, 0) / depths.length,
    fill: polygon.fill,
    stroke: polygon.stroke,
    shade: polygon.shade,
    segmentIndex: polygon.segmentIndex,
    panelIndex: polygon.panelIndex,
  };
}

function getExtents(
  polygons: ReportRoofIllustrationPolygon[]
): ReportRoofIllustrationExtents {
  const points = polygons.flatMap((polygon) => polygon.points);
  const depths = polygons.map((polygon) => polygon.depth);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const minDepth = Math.min(...depths);
  const maxDepth = Math.max(...depths);
  return {
    minX,
    maxX,
    minY,
    maxY,
    minDepth,
    maxDepth,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxDepth - minDepth,
  };
}

function orderProjectedPolygons(
  polygons: ReportRoofIllustrationPolygon[]
): ReportRoofIllustrationPolygon[] {
  const groups = new Map<number, ReportRoofIllustrationPolygon[]>();
  for (const polygon of polygons) {
    const segmentIndex = polygon.segmentIndex ?? -1;
    const group = groups.get(segmentIndex);
    if (group) {
      group.push(polygon);
    } else {
      groups.set(segmentIndex, [polygon]);
    }
  }

  return [...groups.entries()]
    .sort(([, left], [, right]) => groupDepth(right) - groupDepth(left))
    .flatMap(([, group]) =>
      group.sort(
        (left, right) =>
          polygonLayer(left) - polygonLayer(right) ||
          right.depth - left.depth ||
          leftOrder(left, right)
      )
    );
}

function groupDepth(group: ReportRoofIllustrationPolygon[]) {
  return group.find((polygon) => polygon.kind === "roof")?.depth ??
    group.reduce((sum, polygon) => sum + polygon.depth, 0) / Math.max(group.length, 1);
}

function polygonLayer(polygon: ReportRoofIllustrationPolygon) {
  if (polygon.kind === "wall") {
    return 0;
  }
  if (polygon.kind === "roof") {
    return 1;
  }
  return 2;
}

function unavailable(label: string): ReportRoofIllustration {
  const polygons: ReportRoofIllustrationPolygon[] = [];
  return {
    availability: "unavailable",
    available: false,
    title: "Roof illustration unavailable",
    caption: label,
    projectedPolygons: polygons,
    polygons,
    extents: null,
    renderedPanelCount: 0,
    limitationLabels: [label],
  };
}

function getRequestedPanelCount(
  root: Record<string, unknown>,
  analysis: Record<string, unknown>
) {
  const snapshotCount = nonNegativeInteger(root.panelCount);
  if (snapshotCount !== null) {
    return snapshotCount;
  }
  const snapshotMetrics = asRecord(root.metrics);
  const metricCount = nonNegativeInteger(snapshotMetrics?.panelCount);
  if (metricCount !== null) {
    return metricCount;
  }
  return nonNegativeInteger(analysis.acceptedPanelCount) ??
    nonNegativeInteger(analysis.panelCount);
}

function readBounds(value: unknown): ValidBounds | null {
  const bounds = asRecord(value);
  const northeast = asRecord(bounds?.northeast);
  const southwest = asRecord(bounds?.southwest);
  const north = finiteNumber(northeast?.lat);
  const east = finiteNumber(northeast?.lng);
  const south = finiteNumber(southwest?.lat);
  const west = finiteNumber(southwest?.lng);
  if (
    north === null ||
    east === null ||
    south === null ||
    west === null ||
    north <= south ||
    east <= west ||
    Math.abs(north) > 90 ||
    Math.abs(south) > 90 ||
    Math.abs(east) > 180 ||
    Math.abs(west) > 180
  ) {
    return null;
  }
  return {
    northeast: { lat: north, lng: east },
    southwest: { lat: south, lng: west },
  };
}

function readLatLng(value: unknown): LatLng | null {
  const point = asRecord(value);
  const lat = finiteNumber(point?.lat);
  const lng = finiteNumber(point?.lng);
  if (
    lat === null ||
    lng === null ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function pointInPolygon(
  point: LocalPoint,
  polygon: LocalPoint[],
  toleranceMeters: number
) {
  for (let index = 0; index < polygon.length; index += 1) {
    const next = polygon[(index + 1) % polygon.length];
    if (distanceToSegment(point, polygon[index], next) <= toleranceMeters) {
      return true;
    }
  }

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses =
      current.z > point.z !== prior.z > point.z &&
      point.x <
        ((prior.x - current.x) * (point.z - current.z)) /
          (prior.z - current.z || Number.EPSILON) +
          current.x;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.z - start.z);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared)
  );
  return Math.hypot(point.x - (start.x + t * dx), point.z - (start.z + t * dz));
}

function removeDuplicatePoints(points: LocalPoint[]) {
  const unique: LocalPoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (
      !previous ||
      Math.hypot(point.x - previous.x, point.z - previous.z) > Number.EPSILON
    ) {
      unique.push(point);
    }
  }
  if (unique.length > 1) {
    const first = unique[0];
    const last = unique[unique.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) <= Number.EPSILON) {
      unique.pop();
    }
  }
  return unique;
}

function polygonArea(points: LocalPoint[]) {
  return points.reduce(
    (area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point.x * next.z - next.x * point.z;
    },
    0
  ) / 2;
}

function getRoofShade(pitchDeg: number, azimuthDeg: number) {
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const normal = normalizeVector({
    x: Math.tan(pitchRad) * Math.sin(azimuthRad),
    y: 1,
    z: -Math.tan(pitchRad) * Math.cos(azimuthRad),
  });
  const light = normalizeVector({ x: -0.5, y: 0.82, z: -0.28 });
  return clamp01(0.72 + 0.28 * Math.max(0, dotProduct(normal, light)));
}

function getPanelShade(pitchDeg: number, azimuthDeg: number) {
  return clamp01(0.82 + 0.18 * getRoofShade(pitchDeg, azimuthDeg));
}

function getWallShade(top: ModelPoint, next: ModelPoint) {
  const dx = next.x - top.x;
  const dz = next.z - top.z;
  const length = Math.hypot(dx, dz);
  if (length <= Number.EPSILON) {
    return 0.5;
  }
  const light = normalizeVector({ x: -0.5, y: 0, z: -0.28 });
  const normal = { x: dz / length, y: 0, z: -dx / length };
  return clamp01(0.46 + 0.28 * Math.max(0, dotProduct(normal, light)));
}

function leftOrder(
  left: ReportRoofIllustrationPolygon,
  right: ReportRoofIllustrationPolygon
) {
  // Stable tie-breakers keep output deterministic when faces are coplanar.
  return (left.segmentIndex ?? -1) - (right.segmentIndex ?? -1) ||
    (left.panelIndex ?? -1) - (right.panelIndex ?? -1);
}

function allFiniteModelPoints(points: ModelPoint[]) {
  return points.every(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z)
  );
}

function isFiniteLocalPoint(point: LocalPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && number >= MIN_PANEL_DIMENSION_METERS ? number : null;
}

function integerNumber(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function nonNegativeInteger(value: unknown) {
  const number = integerNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function clampPitch(value: number | null) {
  if (value === null || value < 0 || value > MAX_PITCH_DEG) {
    return null;
  }
  return value;
}

function normalizeAzimuth(value: number | null) {
  if (value === null) {
    return null;
  }
  return ((value % 360) + 360) % 360;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function dotProduct(left: Vector3, right: Vector3) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function crossProduct(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalizeVector(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}
