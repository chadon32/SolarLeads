import type { RoofAnalysis, SolarPanelPlacement } from "@/lib/roof-analysis";

export type LatLngPoint = {
  lat: number;
  lng: number;
};

/**
 * Visible gap between adjacent modules (meters per side).
 * Tuned for sales-render clarity: seams read on satellite without
 * looking like oversized racking gaps.
 */
export const SOLAR_PANEL_SEAM_INSET_METERS = 0.055;

/** Match neighbor distances within this relative tolerance when inferring grid axes. */
const GRID_DISTANCE_TOLERANCE = 0.18;
/** Prefer neighbor-inferred azimuth when at least this many neighbors vote. */
const MIN_GRID_VOTES = 1;
/** Above this pitch, segment azimuth is usually reliable; still refine if grid is clear. */
const FLAT_ROOF_PITCH_DEG = 6;

const METERS_PER_DEGREE_LAT = 111_320;
const EARTH_RADIUS_M = 6_371_000;

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function angularDistanceDeg(a: number, b: number) {
  return Math.min(
    Math.abs(normalizeDegrees(a) - normalizeDegrees(b)),
    360 - Math.abs(normalizeDegrees(a) - normalizeDegrees(b))
  );
}

export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
) {
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

export function haversineMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function offsetLatLngMeters({
  lat,
  lng,
  eastMeters,
  northMeters,
}: {
  lat: number;
  lng: number;
  eastMeters: number;
  northMeters: number;
}): LatLngPoint {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

  return {
    lat: lat + northMeters / METERS_PER_DEGREE_LAT,
    lng: lng + eastMeters / metersPerDegreeLng,
  };
}

export function offsetLatLngByBearingMeters({
  lat,
  lng,
  distanceMeters,
  bearingDeg,
}: {
  lat: number;
  lng: number;
  distanceMeters: number;
  bearingDeg: number;
}): LatLngPoint {
  const bearingRad = (normalizeDegrees(bearingDeg) * Math.PI) / 180;
  return offsetLatLngMeters({
    lat,
    lng,
    eastMeters: distanceMeters * Math.sin(bearingRad),
    northMeters: distanceMeters * Math.cos(bearingRad),
  });
}

export function isValidLatLngPoint(
  point: { lat: number; lng: number } | null | undefined
): point is LatLngPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lng) <= 180
  );
}

/**
 * Ground-projected panel rectangle size for a satellite/nadir map.
 *
 * Google's panel centers are WGS84 ground coordinates. On a pitched roof the
 * along-azimuth edge is shorter in map view by cos(pitch); the across-azimuth
 * (ridge-parallel) edge is not foreshortened.
 *
 * Empirically verified across multiple AZ roofs: nearest-neighbor center
 * spacing matches these ground sizes, not the raw roof-surface dimensions.
 */
export function getPanelGroundDimensionsMeters({
  orientation,
  panelWidthMeters,
  panelHeightMeters,
  pitchDeg,
  insetMeters = 0,
}: {
  orientation: SolarPanelPlacement["orientation"];
  panelWidthMeters: number;
  panelHeightMeters: number;
  pitchDeg: number;
  insetMeters?: number;
}) {
  // PORTRAIT (API default relative to segment azimuth):
  //   height along azimuth, width across (azimuth + 90)
  // LANDSCAPE: swap those axes.
  const alongRoofMeters =
    orientation === "LANDSCAPE" ? panelWidthMeters : panelHeightMeters;
  const acrossRoofMeters =
    orientation === "LANDSCAPE" ? panelHeightMeters : panelWidthMeters;

  const pitchRad =
    (clamp(Number.isFinite(pitchDeg) ? pitchDeg : 0, 0, 89) * Math.PI) / 180;
  const alongGroundMeters = alongRoofMeters * Math.cos(pitchRad);
  const acrossGroundMeters = acrossRoofMeters;

  const applyInset = (value: number) =>
    Math.max(value * 0.62, value - insetMeters * 2);

  return {
    alongAzimuthMeters: applyInset(alongGroundMeters),
    acrossAzimuthMeters: applyInset(acrossGroundMeters),
    alongRoofMeters,
    acrossRoofMeters,
  };
}

/**
 * Circular mean of undirected axes (bearing ≡ bearing+180).
 * Returns a direction in [0, 180).
 */
export function meanUndirectedAxisDeg(bearings: number[]) {
  if (!bearings.length) {
    return 0;
  }

  // Double angles so opposite directions collapse, then average on the circle.
  let sinSum = 0;
  let cosSum = 0;
  for (const bearing of bearings) {
    const doubled = normalizeDegrees(bearing) * 2 * (Math.PI / 180);
    sinSum += Math.sin(doubled);
    cosSum += Math.cos(doubled);
  }

  const meanDoubled = Math.atan2(sinSum / bearings.length, cosSum / bearings.length);
  return normalizeDegrees(((meanDoubled * 180) / Math.PI) / 2) % 180;
}

/**
 * Pick the representative of an undirected axis closest to a preferred bearing.
 */
export function orientAxisToward(axisDeg: number, preferredDeg: number) {
  const a = normalizeDegrees(axisDeg);
  const b = normalizeDegrees(a + 180);
  return angularDistanceDeg(a, preferredDeg) <= angularDistanceDeg(b, preferredDeg)
    ? a
    : b;
}

/**
 * Resolve the panel's along-azimuth compass bearing.
 *
 * Priority:
 * 1. Local same-segment neighbor grid (matches real packing on every roof)
 * 2. Explicit panel/segment azimuth from the Solar API
 *
 * On nearly flat roofs Google's segment azimuth is often a poor fit for the
 * actual panel lattice; neighbor geometry fixes that. On steep roofs both
 * usually agree; neighbor votes still correct small biases.
 */
export function inferPanelRotationDeg(
  panel: SolarPanelPlacement,
  panels: SolarPanelPlacement[],
  fallbackAzimuthDeg: number,
  panelWidthMeters?: number,
  panelHeightMeters?: number
) {
  const segmentAzimuth = Number.isFinite(panel.azimuthDeg)
    ? panel.azimuthDeg
    : fallbackAzimuthDeg;

  const width = panelWidthMeters ?? 1.045;
  const height = panelHeightMeters ?? 1.879;
  const pitchDeg = Number.isFinite(panel.pitchDeg) ? panel.pitchDeg : 0;
  const { alongAzimuthMeters, acrossAzimuthMeters } = getPanelGroundDimensionsMeters({
    orientation: panel.orientation,
    panelHeightMeters: height,
    panelWidthMeters: width,
    pitchDeg,
    insetMeters: 0,
  });

  const gridAzimuth = inferAzimuthFromNeighborGrid({
    panel,
    panels,
    alongAzimuthMeters,
    acrossAzimuthMeters,
    preferredAzimuthDeg: segmentAzimuth,
  });

  if (gridAzimuth !== null) {
    return normalizeDegrees(gridAzimuth);
  }

  // Optional row/column metadata (not present in current Solar API responses).
  const rowNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.segmentIndex === panel.segmentIndex &&
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
    // Row axis is across-azimuth (width); along-azimuth is that bearing − 90°.
    return normalizeDegrees(
      bearingDegrees(
        panel.center.lat,
        panel.center.lng,
        rowNeighbor.center.lat,
        rowNeighbor.center.lng
      ) - 90
    );
  }

  const columnNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.segmentIndex === panel.segmentIndex &&
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
      bearingDegrees(
        panel.center.lat,
        panel.center.lng,
        columnNeighbor.center.lat,
        columnNeighbor.center.lng
      )
    );
  }

  return normalizeDegrees(segmentAzimuth);
}

function inferAzimuthFromNeighborGrid({
  panel,
  panels,
  alongAzimuthMeters,
  acrossAzimuthMeters,
  preferredAzimuthDeg,
}: {
  panel: SolarPanelPlacement;
  panels: SolarPanelPlacement[];
  alongAzimuthMeters: number;
  acrossAzimuthMeters: number;
  preferredAzimuthDeg: number;
}): number | null {
  const neighbors = panels.filter(
    (candidate) =>
      candidate !== panel &&
      candidate.segmentIndex === panel.segmentIndex &&
      isValidLatLngPoint(candidate.center)
  );

  if (!neighbors.length) {
    return null;
  }

  const alongBearings: number[] = [];
  const acrossBearings: number[] = [];
  const maxDist =
    Math.max(alongAzimuthMeters, acrossAzimuthMeters) * (1 + GRID_DISTANCE_TOLERANCE) +
    0.15;

  for (const neighbor of neighbors) {
    const distance = haversineMeters(
      panel.center.lat,
      panel.center.lng,
      neighbor.center.lat,
      neighbor.center.lng
    );
    if (distance < 0.25 || distance > maxDist) {
      continue;
    }

    const bearing = bearingDegrees(
      panel.center.lat,
      panel.center.lng,
      neighbor.center.lat,
      neighbor.center.lng
    );

    const alongError = Math.abs(distance - alongAzimuthMeters) / alongAzimuthMeters;
    const acrossError = Math.abs(distance - acrossAzimuthMeters) / acrossAzimuthMeters;

    if (alongError <= GRID_DISTANCE_TOLERANCE && alongError <= acrossError + 0.03) {
      alongBearings.push(bearing);
    } else if (acrossError <= GRID_DISTANCE_TOLERANCE) {
      acrossBearings.push(bearing);
    }
  }

  if (alongBearings.length >= MIN_GRID_VOTES) {
    const axis = meanUndirectedAxisDeg(alongBearings);
    return orientAxisToward(axis, preferredAzimuthDeg);
  }

  if (acrossBearings.length >= MIN_GRID_VOTES) {
    // Across-axis is azimuth + 90°; recover azimuth from it.
    const acrossAxis = meanUndirectedAxisDeg(acrossBearings);
    const candidateAzimuth = normalizeDegrees(acrossAxis - 90);
    return orientAxisToward(candidateAzimuth, preferredAzimuthDeg);
  }

  // Flat roofs sometimes pack on a diagonal lattice where spacing matches neither
  // pure along/across when the stored azimuth is wrong. Use the nearest-neighbor
  // bearing as the short-axis direction.
  if ((panel.pitchDeg ?? 0) <= FLAT_ROOF_PITCH_DEG) {
    let best: { distance: number; bearing: number } | null = null;
    for (const neighbor of neighbors) {
      const distance = haversineMeters(
        panel.center.lat,
        panel.center.lng,
        neighbor.center.lat,
        neighbor.center.lng
      );
      if (distance < 0.4 || distance > maxDist) {
        continue;
      }
      if (!best || distance < best.distance) {
        best = {
          distance,
          bearing: bearingDegrees(
            panel.center.lat,
            panel.center.lng,
            neighbor.center.lat,
            neighbor.center.lng
          ),
        };
      }
    }

    if (best) {
      const shortIsAlong = alongAzimuthMeters <= acrossAzimuthMeters;
      if (shortIsAlong) {
        return orientAxisToward(best.bearing, preferredAzimuthDeg);
      }
      return orientAxisToward(
        normalizeDegrees(best.bearing - 90),
        preferredAzimuthDeg
      );
    }
  }

  return null;
}

export function getPanelFallbackAzimuthDeg(
  analysis: RoofAnalysis,
  panel: SolarPanelPlacement
) {
  if (Number.isFinite(panel.azimuthDeg)) {
    return panel.azimuthDeg;
  }

  return (
    analysis.roofSegments[panel.segmentIndex]?.azimuthDeg ??
    analysis.primaryRoofAzimuth
  );
}

/**
 * Build the four corners of a solar panel polygon in ground lat/lng.
 *
 * Axes (Google Solar convention, verified against real panel spacing):
 * - along azimuth: PORTRAIT uses panelHeight, LANDSCAPE uses panelWidth,
 *   then foreshortened by cos(pitch)
 * - across azimuth (+90°): the other model side, no foreshortening
 */
export function buildPanelPolygonPath({
  panel,
  panelWidthMeters,
  panelHeightMeters,
  fallbackAzimuthDeg,
  insetMeters = 0,
}: {
  panel: SolarPanelPlacement;
  panels?: SolarPanelPlacement[];
  panelWidthMeters: number;
  panelHeightMeters: number;
  fallbackAzimuthDeg: number;
  insetMeters?: number;
}): LatLngPoint[] {
  const pitchDeg = Number.isFinite(panel.pitchDeg) ? panel.pitchDeg : 0;
  const { alongAzimuthMeters, acrossAzimuthMeters } = getPanelGroundDimensionsMeters({
    orientation: panel.orientation,
    panelHeightMeters,
    panelWidthMeters,
    pitchDeg,
    insetMeters,
  });

  const halfAlong = alongAzimuthMeters / 2;
  const halfAcross = acrossAzimuthMeters / 2;
  // Placements are grid-regularized upstream (panel-layout.ts), so the
  // stored azimuth is the plane's lattice azimuth — trust it rather than
  // re-inferring per panel, which tilts modules on noisy planes.
  const azimuthDeg = Number.isFinite(panel.azimuthDeg)
    ? panel.azimuthDeg
    : fallbackAzimuthDeg;

  // Spherical.computeOffset style used by Google Solar demos:
  //   top/bottom along azimuth, left/right along azimuth + 90.
  const top = offsetLatLngByBearingMeters({
    lat: panel.center.lat,
    lng: panel.center.lng,
    distanceMeters: halfAlong,
    bearingDeg: azimuthDeg,
  });
  const bottom = offsetLatLngByBearingMeters({
    lat: panel.center.lat,
    lng: panel.center.lng,
    distanceMeters: halfAlong,
    bearingDeg: azimuthDeg + 180,
  });

  const topRight = offsetLatLngByBearingMeters({
    lat: top.lat,
    lng: top.lng,
    distanceMeters: halfAcross,
    bearingDeg: azimuthDeg + 90,
  });
  const topLeft = offsetLatLngByBearingMeters({
    lat: top.lat,
    lng: top.lng,
    distanceMeters: halfAcross,
    bearingDeg: azimuthDeg + 270,
  });
  const bottomRight = offsetLatLngByBearingMeters({
    lat: bottom.lat,
    lng: bottom.lng,
    distanceMeters: halfAcross,
    bearingDeg: azimuthDeg + 90,
  });
  const bottomLeft = offsetLatLngByBearingMeters({
    lat: bottom.lat,
    lng: bottom.lng,
    distanceMeters: halfAcross,
    bearingDeg: azimuthDeg + 270,
  });

  return [topLeft, topRight, bottomRight, bottomLeft];
}

export function buildPanelCornerLatLngPoints({
  analysis,
  panel,
  panels,
}: {
  analysis: RoofAnalysis;
  panel: SolarPanelPlacement;
  panels: SolarPanelPlacement[];
}): LatLngPoint[] {
  const corners = buildPanelPolygonPath({
    fallbackAzimuthDeg: getPanelFallbackAzimuthDeg(analysis, panel),
    panel,
    panelHeightMeters: analysis.panelHeightMeters,
    panelWidthMeters: analysis.panelWidthMeters,
    panels,
  });

  return [panel.center, ...corners].filter(isValidLatLngPoint);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
