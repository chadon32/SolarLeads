import type { RasterData } from "@/lib/geotiff-utils";
import type {
  RoofGeoBounds,
  RoofPoint,
  SolarPanelPlacement,
} from "@/lib/roof-analysis";

/**
 * Pure geometry for the 3D roof scene. No WebGL, no DOM.
 *
 * Local scene frame (matches three.js Y-up):
 *   x = meters east of the origin
 *   y = meters above the estimated ground elevation
 *   z = meters south of the origin (north is -z)
 */

export type LatLng = { lat: number; lng: number };

export type LocalPoint = { x: number; z: number };

export type HeightfieldGeometry = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  rows: number;
  cols: number;
  maxHeightMeters: number;
};

export type PanelTransform = {
  position: { x: number; y: number; z: number };
  /** Rotation about the Y (up) axis, radians, three.js convention. */
  headingRad: number;
  /** Tilt about the panel's local X axis after heading, radians. */
  tiltRad: number;
  /** Module edge along the azimuth (downslope) direction, meters. */
  alongMeters: number;
  /** Module edge across the azimuth (ridge-parallel) direction, meters. */
  acrossMeters: number;
};

const METERS_PER_DEGREE_LAT = 111_320;

/** DSM no-data sentinels are large negatives; real AZ elevations are 0–4km. */
function isValidElevation(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > -1000 &&
    value < 9000
  );
}

export function metersPerDegreeLng(lat: number) {
  return METERS_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
}

export function latLngToLocalMeters(point: LatLng, origin: LatLng): LocalPoint {
  return {
    x: (point.lng - origin.lng) * metersPerDegreeLng(origin.lat),
    z: -(point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
  };
}

export function boundsCenter(bounds: RoofGeoBounds): LatLng {
  return {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
  };
}

export function expandBoundsMeters(
  bounds: RoofGeoBounds,
  padMeters: number
): RoofGeoBounds {
  const centerLat = (bounds.northeast.lat + bounds.southwest.lat) / 2;
  const dLat = padMeters / METERS_PER_DEGREE_LAT;
  const dLng = padMeters / metersPerDegreeLng(centerLat);

  return {
    northeast: {
      lat: bounds.northeast.lat + dLat,
      lng: bounds.northeast.lng + dLng,
    },
    southwest: {
      lat: bounds.southwest.lat - dLat,
      lng: bounds.southwest.lng - dLng,
    },
  };
}

export function intersectBounds(
  a: RoofGeoBounds,
  b: RoofGeoBounds
): RoofGeoBounds | null {
  const north = Math.min(a.northeast.lat, b.northeast.lat);
  const south = Math.max(a.southwest.lat, b.southwest.lat);
  const east = Math.min(a.northeast.lng, b.northeast.lng);
  const west = Math.max(a.southwest.lng, b.southwest.lng);

  if (north <= south || east <= west) {
    return null;
  }

  return {
    northeast: { lat: north, lng: east },
    southwest: { lat: south, lng: west },
  };
}

/**
 * Low-percentile elevation of the valid DSM samples. Using the 5th percentile
 * (not the minimum) keeps one bad pixel from sinking the whole terrain.
 */
export function estimateGroundElevationMeters(raster: RasterData): number {
  const stride = Math.max(1, Math.floor(raster.length / 40_000));
  const values: number[] = [];

  for (let index = 0; index < raster.length; index += stride) {
    const value = raster[index];
    if (isValidElevation(value)) {
      values.push(value);
    }
  }

  if (!values.length) {
    return 0;
  }

  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.05))];
}

/**
 * Bilinear sample of a single-band raster at a geographic point.
 * Returns null outside the raster or when no valid neighbor exists.
 */
export function sampleRasterBilinear({
  raster,
  width,
  height,
  bounds,
  lat,
  lng,
}: {
  raster: RasterData;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  lat: number;
  lng: number;
}): number | null {
  const north = bounds.northeast.lat;
  const south = bounds.southwest.lat;
  const east = bounds.northeast.lng;
  const west = bounds.southwest.lng;

  if (north <= south || east <= west) {
    return null;
  }

  const fx = ((lng - west) / (east - west)) * (width - 1);
  const fy = ((north - lat) / (north - south)) * (height - 1);

  if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) {
    return null;
  }

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const corners = [
    { value: raster[y0 * width + x0], weight: (1 - tx) * (1 - ty) },
    { value: raster[y0 * width + x1], weight: tx * (1 - ty) },
    { value: raster[y1 * width + x0], weight: (1 - tx) * ty },
    { value: raster[y1 * width + x1], weight: tx * ty },
  ];

  let weightedSum = 0;
  let weightTotal = 0;

  for (const corner of corners) {
    if (isValidElevation(corner.value)) {
      weightedSum += corner.value * corner.weight;
      weightTotal += corner.weight;
    }
  }

  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

/**
 * Separable 3-tap [0.25, 0.5, 0.25] blur over a row-major grid,
 * edge-clamped. Two iterations approximate a gentle gaussian — enough to
 * take the spikes out of DSM noise without erasing the roof shape.
 */
export function smoothGrid(
  values: Float32Array,
  cols: number,
  rows: number,
  iterations = 1
): Float32Array {
  let current = Float32Array.from(values);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const horizontal = new Float32Array(current.length);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const left = current[r * cols + Math.max(0, c - 1)];
        const mid = current[r * cols + c];
        const right = current[r * cols + Math.min(cols - 1, c + 1)];
        horizontal[r * cols + c] = 0.25 * left + 0.5 * mid + 0.25 * right;
      }
    }

    const vertical = new Float32Array(current.length);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const up = horizontal[Math.max(0, r - 1) * cols + c];
        const mid = horizontal[r * cols + c];
        const down = horizontal[Math.min(rows - 1, r + 1) * cols + c];
        vertical[r * cols + c] = 0.25 * up + 0.5 * mid + 0.25 * down;
      }
    }

    current = vertical;
  }

  return current;
}

/**
 * Build a terrain heightfield from the DSM.
 *
 * Vertices sit in the local meter frame; UVs are computed against
 * `textureBounds` (the RGB GeoTIFF's bounds) so the draped aerial photo
 * lines up even when DSM and RGB rasters differ in extent or resolution.
 * `smoothIterations` blurs the display mesh only — source data untouched.
 */
export function buildHeightfieldGeometry({
  raster,
  width,
  height,
  bounds,
  cropBounds,
  textureBounds,
  origin,
  groundElevationMeters,
  maxGridSize = 192,
  smoothIterations = 0,
}: {
  raster: RasterData;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  cropBounds: RoofGeoBounds;
  textureBounds: RoofGeoBounds;
  origin: LatLng;
  groundElevationMeters: number;
  maxGridSize?: number;
  smoothIterations?: number;
}): HeightfieldGeometry | null {
  const crop = intersectBounds(bounds, cropBounds);

  if (!crop) {
    return null;
  }

  const north = bounds.northeast.lat;
  const south = bounds.southwest.lat;
  const east = bounds.northeast.lng;
  const west = bounds.southwest.lng;

  const rowStart = Math.max(
    0,
    Math.floor(((north - crop.northeast.lat) / (north - south)) * (height - 1))
  );
  const rowEnd = Math.min(
    height - 1,
    Math.ceil(((north - crop.southwest.lat) / (north - south)) * (height - 1))
  );
  const colStart = Math.max(
    0,
    Math.floor(((crop.southwest.lng - west) / (east - west)) * (width - 1))
  );
  const colEnd = Math.min(
    width - 1,
    Math.ceil(((crop.northeast.lng - west) / (east - west)) * (width - 1))
  );

  if (rowEnd - rowStart < 2 || colEnd - colStart < 2) {
    return null;
  }

  const step = Math.max(
    1,
    Math.ceil(Math.max(rowEnd - rowStart, colEnd - colStart) / maxGridSize)
  );
  const rows = Math.floor((rowEnd - rowStart) / step) + 1;
  const cols = Math.floor((colEnd - colStart) / step) + 1;

  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const texNorth = textureBounds.northeast.lat;
  const texSouth = textureBounds.southwest.lat;
  const texEast = textureBounds.northeast.lng;
  const texWest = textureBounds.southwest.lng;
  const texLatSpan = Math.max(texNorth - texSouth, 1e-12);
  const texLngSpan = Math.max(texEast - texWest, 1e-12);

  const elevations = new Float32Array(rows * cols);
  let vertex = 0;

  for (let r = 0; r < rows; r += 1) {
    const rowIndex = rowStart + r * step;
    const lat = north - (rowIndex / (height - 1)) * (north - south);

    for (let c = 0; c < cols; c += 1) {
      const colIndex = colStart + c * step;
      const lng = west + (colIndex / (width - 1)) * (east - west);
      const local = latLngToLocalMeters({ lat, lng }, origin);
      const rawElevation = raster[rowIndex * width + colIndex];
      elevations[vertex] = isValidElevation(rawElevation)
        ? Math.max(0, rawElevation - groundElevationMeters)
        : 0;

      positions[vertex * 3] = local.x;
      positions[vertex * 3 + 2] = local.z;

      uvs[vertex * 2] = (lng - texWest) / texLngSpan;
      uvs[vertex * 2 + 1] = (lat - texSouth) / texLatSpan;

      vertex += 1;
    }
  }

  const displayElevations =
    smoothIterations > 0
      ? smoothGrid(elevations, cols, rows, smoothIterations)
      : elevations;

  let maxHeightMeters = 0;
  for (let index = 0; index < rows * cols; index += 1) {
    positions[index * 3 + 1] = displayElevations[index];
    maxHeightMeters = Math.max(maxHeightMeters, displayElevations[index]);
  }

  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let index = 0;

  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const topLeft = r * cols + c;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + cols;
      const bottomRight = bottomLeft + 1;

      // Counter-clockwise when viewed from above (+y), so faces point up.
      indices[index] = topLeft;
      indices[index + 1] = bottomLeft;
      indices[index + 2] = topRight;
      indices[index + 3] = topRight;
      indices[index + 4] = bottomLeft;
      indices[index + 5] = bottomRight;
      index += 6;
    }
  }

  return { positions, uvs, indices, rows, cols, maxHeightMeters };
}

/**
 * Position and orientation of one module in the local scene frame.
 *
 * The module is modeled at its true physical size; tilting by the roof pitch
 * reproduces the ground foreshortening that the 2D view fakes with cos(pitch).
 */
export function buildPanelTransform({
  panel,
  panelWidthMeters,
  panelHeightMeters,
  origin,
  elevationAboveGroundMeters,
  standoffMeters = 0.14,
}: {
  panel: SolarPanelPlacement;
  panelWidthMeters: number;
  panelHeightMeters: number;
  origin: LatLng;
  elevationAboveGroundMeters: number;
  standoffMeters?: number;
}): PanelTransform {
  const local = latLngToLocalMeters(panel.center, origin);
  const azimuthDeg = Number.isFinite(panel.azimuthDeg) ? panel.azimuthDeg : 180;
  const pitchDeg = Number.isFinite(panel.pitchDeg)
    ? Math.min(Math.max(panel.pitchDeg, 0), 75)
    : 0;
  const azimuthRad = (azimuthDeg * Math.PI) / 180;

  // Local +Z starts at compass south (180°); rotating by (π − azimuth) about
  // +Y points it at the segment azimuth, i.e. the downslope direction.
  const headingRad = Math.PI - azimuthRad;
  const tiltRad = (pitchDeg * Math.PI) / 180;

  const alongMeters =
    panel.orientation === "LANDSCAPE" ? panelWidthMeters : panelHeightMeters;
  const acrossMeters =
    panel.orientation === "LANDSCAPE" ? panelHeightMeters : panelWidthMeters;

  return {
    position: {
      x: local.x,
      y: elevationAboveGroundMeters + standoffMeters,
      z: local.z,
    },
    headingRad,
    tiltRad,
    alongMeters,
    acrossMeters,
  };
}

/**
 * Transforms for every panel, mounted on one fitted plane per roof segment.
 *
 * Sampling the DSM per panel puts each module at a slightly different
 * height (DSM noise is ±10–30 cm), so a racked array reads as jumbled
 * tiles. Instead: the plane's tilt and facing come from the segment's own
 * data (shared azimuth, median pitch) and only the height offset is fitted
 * — the median of the downslope-compensated DSM samples at the segment's
 * panel centers. Every module then sits exactly on that plane.
 *
 * Returns an array aligned with `panels`; entries are null for panels
 * without a finite center.
 */
export function buildSegmentPlaneTransforms({
  panels,
  raster,
  width,
  height,
  bounds,
  origin,
  groundElevationMeters,
  panelWidthMeters,
  panelHeightMeters,
  fallbackElevationMeters,
  standoffMeters = 0.14,
}: {
  panels: SolarPanelPlacement[];
  raster: RasterData;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  origin: LatLng;
  groundElevationMeters: number;
  panelWidthMeters: number;
  panelHeightMeters: number;
  fallbackElevationMeters: number;
  standoffMeters?: number;
}): Array<PanelTransform | null> {
  const planes = fitSegmentPlanes({
    panels,
    raster,
    width,
    height,
    bounds,
    origin,
    groundElevationMeters,
    fallbackElevationMeters,
  });

  const result = new Array<PanelTransform | null>(panels.length).fill(null);

  panels.forEach((panel, index) => {
    if (
      !Number.isFinite(panel.center?.lat) ||
      !Number.isFinite(panel.center?.lng)
    ) {
      return;
    }

    const plane = planes.get(segmentPlaneKey(panel));
    if (!plane) {
      return;
    }

    const tanPitch = Math.tan((plane.pitchDeg * Math.PI) / 180);
    const azimuthRad = (plane.azimuthDeg * Math.PI) / 180;
    const local = latLngToLocalMeters(panel.center, origin);
    const downslope =
      local.x * Math.sin(azimuthRad) + -local.z * Math.cos(azimuthRad);
    const elevation = Math.max(
      0,
      plane.planeOffsetMeters - tanPitch * downslope
    );

    result[index] = buildPanelTransform({
      panel: {
        ...panel,
        azimuthDeg: plane.azimuthDeg,
        pitchDeg: plane.pitchDeg,
      },
      panelWidthMeters,
      panelHeightMeters,
      origin,
      elevationAboveGroundMeters: elevation,
      standoffMeters,
    });
  });

  return result;
}

export type SegmentPlane = {
  azimuthDeg: number;
  pitchDeg: number;
  /** Constant C in: heightAboveGround + tan(pitch)·downslope = C. */
  planeOffsetMeters: number;
};

function segmentPlaneKey(panel: SolarPanelPlacement) {
  return Number.isFinite(panel.segmentIndex) ? panel.segmentIndex : -1;
}

/**
 * One plane per roof segment, fitted from the DSM at that segment's panel
 * centers (interior samples — far more reliable than roof-edge samples).
 * Tilt/facing come from the panels' own regularized values; only the
 * height offset is fitted (robust median).
 *
 * This is the single source of truth for segment planes: panels mount on
 * them AND roof faces are drawn on them, so the two can never disagree.
 */
export function fitSegmentPlanes({
  panels,
  raster,
  width,
  height,
  bounds,
  origin,
  groundElevationMeters,
  fallbackElevationMeters,
}: {
  panels: SolarPanelPlacement[];
  raster: RasterData;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  origin: LatLng;
  groundElevationMeters: number;
  fallbackElevationMeters: number;
}): Map<number, SegmentPlane> {
  const groups = new Map<number, number[]>();

  panels.forEach((panel, index) => {
    if (
      !Number.isFinite(panel.center?.lat) ||
      !Number.isFinite(panel.center?.lng)
    ) {
      return;
    }
    const key = segmentPlaneKey(panel);
    const members = groups.get(key);
    if (members) {
      members.push(index);
    } else {
      groups.set(key, [index]);
    }
  });

  const planes = new Map<number, SegmentPlane>();

  for (const [key, memberIndices] of groups) {
    const groupPanels = memberIndices.map((index) => panels[index]);
    const azimuthDeg = Number.isFinite(groupPanels[0].azimuthDeg)
      ? groupPanels[0].azimuthDeg
      : 180;
    const pitchValues = groupPanels
      .map((panel) => panel.pitchDeg)
      .filter((value): value is number => Number.isFinite(value))
      .map((value) => Math.min(Math.max(value, 0), 75))
      .sort((left, right) => left - right);
    const pitchDeg = pitchValues.length
      ? pitchValues[Math.floor(pitchValues.length / 2)]
      : 0;
    const tanPitch = Math.tan((pitchDeg * Math.PI) / 180);
    const azimuthRad = (azimuthDeg * Math.PI) / 180;
    const sinAz = Math.sin(azimuthRad);
    const cosAz = Math.cos(azimuthRad);

    // The plane drops by tan(pitch) per meter downslope, so
    // h + tan(pitch)·s is constant on the plane.
    const compensated: number[] = [];
    for (const index of memberIndices) {
      const local = latLngToLocalMeters(panels[index].center, origin);
      const downslope = local.x * sinAz + -local.z * cosAz;
      const sample = sampleRasterBilinear({
        raster,
        width,
        height,
        bounds,
        lat: panels[index].center.lat,
        lng: panels[index].center.lng,
      });
      if (sample !== null) {
        const relative = Math.max(0, sample - groundElevationMeters);
        compensated.push(relative + tanPitch * downslope);
      }
    }

    compensated.sort((left, right) => left - right);
    const planeOffsetMeters = compensated.length
      ? compensated[Math.floor(compensated.length / 2)]
      : fallbackElevationMeters;

    planes.set(key, { azimuthDeg, pitchDeg, planeOffsetMeters });
  }

  return planes;
}

export type RoofFaceGeometry = {
  positions: Float32Array;
  indices: Uint32Array;
  /** Geographic UVs against the supplied texture bounds (zeros without). */
  uvs: Float32Array;
  wallPositions: Float32Array;
  wallIndices: Uint32Array;
  maxHeightMeters: number;
};

/**
 * Inverse of the analysis pipeline's outline normalization: x is percent
 * west→east, y is percent north→south, both against the roof bounds.
 */
export function normalizedOutlineToLatLng(
  outline: RoofPoint[],
  bounds: RoofGeoBounds
): LatLng[] {
  const north = bounds.northeast.lat;
  const south = bounds.southwest.lat;
  const east = bounds.northeast.lng;
  const west = bounds.southwest.lng;

  return outline
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      lat: north - (point.y / 100) * (north - south),
      lng: west + (point.x / 100) * (east - west),
    }));
}

/**
 * Ear-clipping triangulation of a simple polygon in the local x/z plane.
 * Handles concave outlines; O(n^2), fine for roof outlines. Returns
 * triangle indices into the input array, wound so faces point up (+y).
 */
export function earClipTriangulate(points: LocalPoint[]): number[] {
  if (points.length < 3) {
    return [];
  }

  // Signed area in the x/z plane; positive means counterclockwise when
  // viewed from +y (because +z points south).
  let signedArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    signedArea += current.z * next.x - next.z * current.x;
  }

  const order = points.map((_, index) => index);
  if (signedArea < 0) {
    order.reverse();
  }

  const cross = (a: LocalPoint, b: LocalPoint, c: LocalPoint) =>
    (b.z - a.z) * (c.x - a.x) - (c.z - a.z) * (b.x - a.x);

  const pointInTriangle = (
    p: LocalPoint,
    a: LocalPoint,
    b: LocalPoint,
    c: LocalPoint
  ) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const triangles: number[] = [];
  const remaining = [...order];
  let guard = remaining.length * remaining.length + 10;

  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;

    for (let index = 0; index < remaining.length; index += 1) {
      const prev = remaining[(index - 1 + remaining.length) % remaining.length];
      const curr = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      const a = points[prev];
      const b = points[curr];
      const c = points[next];

      // Reflex vertex — not an ear.
      if (cross(a, b, c) <= 0) {
        continue;
      }

      let containsOther = false;
      for (const other of remaining) {
        if (other === prev || other === curr || other === next) {
          continue;
        }
        if (pointInTriangle(points[other], a, b, c)) {
          containsOther = true;
          break;
        }
      }

      if (!containsOther) {
        triangles.push(prev, curr, next);
        remaining.splice(index, 1);
        clipped = true;
        break;
      }
    }

    // Degenerate polygon (collinear runs, self-touching) — clip greedily
    // so we still return a surface rather than nothing.
    if (!clipped) {
      triangles.push(remaining[0], remaining[1], remaining[2]);
      remaining.splice(1, 1);
    }
  }

  if (remaining.length === 3) {
    triangles.push(remaining[0], remaining[1], remaining[2]);
  }

  return triangles;
}

/**
 * A roof segment as one crisp flat face plus wall skirts to the ground —
 * the extruded-house look of a CAD solar design tool.
 *
 * The face plane's tilt and facing come from the segment's own data; only
 * the height offset is fitted (median of downslope-compensated DSM samples
 * at the outline vertices and centroid — same robust fit as the panels).
 */
export function buildRoofFaceGeometry({
  outline,
  pitchDeg,
  azimuthDeg,
  origin,
  raster,
  width,
  height,
  bounds,
  groundElevationMeters,
  fallbackElevationMeters,
  textureBounds,
  plane,
}: {
  outline: LatLng[];
  pitchDeg: number;
  azimuthDeg: number;
  origin: LatLng;
  raster: RasterData;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  groundElevationMeters: number;
  fallbackElevationMeters: number;
  textureBounds: RoofGeoBounds | null;
  /**
   * Pre-fitted segment plane (from `fitSegmentPlanes`). When provided it
   * wins over this face's own sampling, guaranteeing the face and its
   * panels share one surface. Outline-vertex samples sit at roof edges
   * where the DSM mixes in ground/adjacent heights, so a face fitted from
   * them can drift meters away from the panel-fitted plane.
   */
  plane?: SegmentPlane;
}): RoofFaceGeometry | null {
  const cleaned = outline.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
  );

  // Drop a closing point that duplicates the first vertex.
  if (
    cleaned.length > 1 &&
    Math.abs(cleaned[0].lat - cleaned[cleaned.length - 1].lat) < 1e-12 &&
    Math.abs(cleaned[0].lng - cleaned[cleaned.length - 1].lng) < 1e-12
  ) {
    cleaned.pop();
  }

  if (cleaned.length < 3) {
    return null;
  }

  const local = cleaned.map((point) => latLngToLocalMeters(point, origin));
  const effectivePitch = plane
    ? plane.pitchDeg
    : Math.min(Math.max(pitchDeg, 0), 75);
  const effectiveAzimuth = plane ? plane.azimuthDeg : azimuthDeg;
  const tanPitch = Math.tan((effectivePitch * Math.PI) / 180);
  const azimuthRad = (effectiveAzimuth * Math.PI) / 180;
  const sinAz = Math.sin(azimuthRad);
  const cosAz = Math.cos(azimuthRad);
  const downslope = local.map((point) => point.x * sinAz + -point.z * cosAz);

  const centroid = {
    lat: faceMean(cleaned.map((point) => point.lat)),
    lng: faceMean(cleaned.map((point) => point.lng)),
  };
  const centroidLocal = latLngToLocalMeters(centroid, origin);
  const centroidDownslope =
    centroidLocal.x * sinAz + -centroidLocal.z * cosAz;

  let planeOffset: number;

  if (plane) {
    planeOffset = plane.planeOffsetMeters;
  } else {
    const samplePoints = [...cleaned, centroid];
    const sampleDownslopes = [...downslope, centroidDownslope];
    const compensated: number[] = [];
    samplePoints.forEach((point, index) => {
      const sample = sampleRasterBilinear({
        raster,
        width,
        height,
        bounds,
        lat: point.lat,
        lng: point.lng,
      });
      if (sample !== null) {
        const relative = Math.max(0, sample - groundElevationMeters);
        compensated.push(relative + tanPitch * sampleDownslopes[index]);
      }
    });

    compensated.sort((left, right) => left - right);
    planeOffset = compensated.length
      ? compensated[Math.floor(compensated.length / 2)]
      : fallbackElevationMeters + tanPitch * centroidDownslope;
  }

  const heights = downslope.map((s) =>
    Math.max(0.05, planeOffset - tanPitch * s)
  );

  const indices = earClipTriangulate(local);
  if (!indices.length) {
    return null;
  }

  const positions = new Float32Array(local.length * 3);
  const uvs = new Float32Array(local.length * 2);
  let maxHeightMeters = 0;

  local.forEach((point, index) => {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = heights[index];
    positions[index * 3 + 2] = point.z;
    maxHeightMeters = Math.max(maxHeightMeters, heights[index]);

    if (textureBounds) {
      const lngSpan =
        textureBounds.northeast.lng - textureBounds.southwest.lng;
      const latSpan =
        textureBounds.northeast.lat - textureBounds.southwest.lat;
      uvs[index * 2] =
        lngSpan > 0
          ? (cleaned[index].lng - textureBounds.southwest.lng) / lngSpan
          : 0;
      uvs[index * 2 + 1] =
        latSpan > 0
          ? (cleaned[index].lat - textureBounds.southwest.lat) / latSpan
          : 0;
    }
  });

  // Wall skirts: each perimeter edge extruded straight down to the ground.
  const edgeCount = local.length;
  const wallPositions = new Float32Array(edgeCount * 4 * 3);
  const wallIndices = new Uint32Array(edgeCount * 6);

  for (let index = 0; index < edgeCount; index += 1) {
    const next = (index + 1) % edgeCount;
    const base = index * 4;
    const top1 = local[index];
    const top2 = local[next];

    wallPositions.set(
      [
        top1.x, heights[index], top1.z,
        top2.x, heights[next], top2.z,
        top2.x, 0, top2.z,
        top1.x, 0, top1.z,
      ],
      base * 3
    );
    wallIndices.set(
      [base, base + 1, base + 2, base, base + 2, base + 3],
      index * 6
    );
  }

  return {
    positions,
    indices: Uint32Array.from(indices),
    uvs,
    wallPositions,
    wallIndices,
    maxHeightMeters,
  };
}

export type ObstructionMarkerGeometry = {
  positions: Float32Array;
  indices: Uint32Array;
  wallPositions: Float32Array;
  wallIndices: Uint32Array;
  topHeightMeters: number;
};

/**
 * A low prism sitting on the roof, marking a detected shading obstruction.
 *
 * We only know the obstruction's roof footprint (not whether it is a vent,
 * unit, or nearby tree), so this is deliberately a plain flat-topped marker
 * rather than a fabricated object. The top sits `heightMeters` above the
 * roof surface fitted under the footprint; short walls close the sides.
 */
export function buildObstructionMarkerGeometry({
  outline,
  origin,
  raster,
  width,
  height,
  bounds,
  groundElevationMeters,
  fallbackElevationMeters,
  heightMeters = 0.6,
}: {
  outline: LatLng[];
  origin: LatLng;
  raster: RasterData;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  groundElevationMeters: number;
  fallbackElevationMeters: number;
  heightMeters?: number;
}): ObstructionMarkerGeometry | null {
  const cleaned = outline.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
  );

  if (
    cleaned.length > 1 &&
    Math.abs(cleaned[0].lat - cleaned[cleaned.length - 1].lat) < 1e-12 &&
    Math.abs(cleaned[0].lng - cleaned[cleaned.length - 1].lng) < 1e-12
  ) {
    cleaned.pop();
  }

  if (cleaned.length < 3) {
    return null;
  }

  const local = cleaned.map((point) => latLngToLocalMeters(point, origin));

  const centroid = {
    lat: faceMean(cleaned.map((point) => point.lat)),
    lng: faceMean(cleaned.map((point) => point.lng)),
  };

  const samples: number[] = [];
  for (const point of [...cleaned, centroid]) {
    const value = sampleRasterBilinear({
      raster,
      width,
      height,
      bounds,
      lat: point.lat,
      lng: point.lng,
    });
    if (value !== null) {
      samples.push(Math.max(0, value - groundElevationMeters));
    }
  }

  samples.sort((left, right) => left - right);
  const baseHeight = samples.length
    ? samples[Math.floor(samples.length / 2)]
    : fallbackElevationMeters;
  const topHeight = baseHeight + heightMeters;

  const indices = earClipTriangulate(local);
  if (!indices.length) {
    return null;
  }

  const positions = new Float32Array(local.length * 3);
  local.forEach((point, index) => {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = topHeight;
    positions[index * 3 + 2] = point.z;
  });

  const edgeCount = local.length;
  const wallPositions = new Float32Array(edgeCount * 4 * 3);
  const wallIndices = new Uint32Array(edgeCount * 6);

  for (let index = 0; index < edgeCount; index += 1) {
    const next = (index + 1) % edgeCount;
    const base = index * 4;
    const top1 = local[index];
    const top2 = local[next];

    wallPositions.set(
      [
        top1.x, topHeight, top1.z,
        top2.x, topHeight, top2.z,
        top2.x, baseHeight, top2.z,
        top1.x, baseHeight, top1.z,
      ],
      base * 3
    );
    wallIndices.set(
      [base, base + 1, base + 2, base, base + 2, base + 3],
      index * 6
    );
  }

  return {
    positions,
    indices: Uint32Array.from(indices),
    wallPositions,
    wallIndices,
    topHeightMeters: topHeight,
  };
}

function faceMean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
