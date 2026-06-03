import type { RoofGeoBounds } from "@/lib/roof-analysis";

export type RoofViewportPoint = {
  lat: number;
  lng: number;
};

export type RoofAnalysisViewport = {
  bounds: RoofGeoBounds | null;
  center: RoofViewportPoint | null;
  staticMapZoom: number;
};

export function buildRoofAnalysisStaticMapUrl({
  apiKey,
  format = "png",
  height = 420,
  scale = 2,
  viewport,
  width = 640,
}: {
  apiKey: string;
  format?: "png" | "jpg-baseline";
  height?: number;
  scale?: 1 | 2;
  viewport: RoofAnalysisViewport;
  width?: number;
}) {
  if (!viewport.center) {
    return null;
  }

  const staticMapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
  staticMapUrl.searchParams.set(
    "center",
    `${viewport.center.lat},${viewport.center.lng}`
  );
  staticMapUrl.searchParams.set("zoom", String(viewport.staticMapZoom));
  staticMapUrl.searchParams.set("size", `${width}x${height}`);
  staticMapUrl.searchParams.set("scale", String(scale));
  staticMapUrl.searchParams.set("maptype", "satellite");
  staticMapUrl.searchParams.set("format", format);
  staticMapUrl.searchParams.set("key", apiKey);
  staticMapUrl.searchParams.append(
    "style",
    "feature:all|element:labels|visibility:off"
  );

  return staticMapUrl;
}

export function getRoofAnalysisViewport({
  bounds,
  fallbackCenter,
  points = [],
}: {
  bounds?: RoofGeoBounds | null;
  fallbackCenter?: RoofViewportPoint | null;
  points?: Array<RoofViewportPoint | null | undefined>;
}): RoofAnalysisViewport {
  const validPoints = points.filter(isValidViewportPoint);
  const validFallback = isValidViewportPoint(fallbackCenter)
    ? fallbackCenter
    : null;
  const baseBounds =
    normalizeBounds(bounds) ??
    (validPoints.length >= 2 ? latLngPointsToBounds(validPoints) : null);
  const center =
    getBoundsCenter(baseBounds) ??
    getLatLngCentroid(validPoints) ??
    validFallback;
  const expandedBounds = baseBounds
    ? expandGeoBoundsByMeters(baseBounds, getViewportPaddingMeters(baseBounds))
    : null;

  return {
    bounds: expandedBounds,
    center,
    staticMapZoom: getStaticMapZoom(expandedBounds),
  };
}

export function getStaticMapZoom(bounds: RoofGeoBounds | null) {
  if (!bounds) {
    return 20;
  }

  const spanMeters = getBoundsMaxSpanMeters(bounds);

  if (spanMeters <= 18) return 21;
  if (spanMeters <= 250) return 20;
  if (spanMeters <= 500) return 19;
  return 18;
}

export function getGoogleBoundsLiteral(bounds: RoofGeoBounds | null) {
  if (!bounds) {
    return null;
  }

  return {
    north: bounds.northeast.lat,
    south: bounds.southwest.lat,
    east: bounds.northeast.lng,
    west: bounds.southwest.lng,
  };
}

function normalizeBounds(bounds?: RoofGeoBounds | null) {
  if (!bounds) {
    return null;
  }

  const points = [
    bounds.northeast,
    bounds.southwest,
  ].filter(isValidViewportPoint);

  if (points.length < 2) {
    return null;
  }

  return latLngPointsToBounds(points);
}

function latLngPointsToBounds(points: RoofViewportPoint[]): RoofGeoBounds {
  const initial = {
    maxLat: Number.NEGATIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
  };
  const next = points.reduce(
    (accumulator, point) => ({
      maxLat: Math.max(accumulator.maxLat, point.lat),
      maxLng: Math.max(accumulator.maxLng, point.lng),
      minLat: Math.min(accumulator.minLat, point.lat),
      minLng: Math.min(accumulator.minLng, point.lng),
    }),
    initial
  );

  return {
    northeast: { lat: next.maxLat, lng: next.maxLng },
    southwest: { lat: next.minLat, lng: next.minLng },
  };
}

function expandGeoBoundsByMeters(bounds: RoofGeoBounds, meters: number): RoofGeoBounds {
  const centerLat = (bounds.northeast.lat + bounds.southwest.lat) / 2;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const latPadding = meters / metersPerDegreeLat;
  const lngPadding = meters / metersPerDegreeLng;

  return {
    northeast: {
      lat: bounds.northeast.lat + latPadding,
      lng: bounds.northeast.lng + lngPadding,
    },
    southwest: {
      lat: bounds.southwest.lat - latPadding,
      lng: bounds.southwest.lng - lngPadding,
    },
  };
}

function getViewportPaddingMeters(bounds: RoofGeoBounds) {
  return clampNumber(getBoundsMaxSpanMeters(bounds) * 0.26, 7, 18);
}

function getBoundsMaxSpanMeters(bounds: RoofGeoBounds) {
  const centerLat = (bounds.northeast.lat + bounds.southwest.lat) / 2;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const latSpanMeters =
    Math.abs(bounds.northeast.lat - bounds.southwest.lat) * metersPerDegreeLat;
  const lngSpanMeters =
    Math.abs(bounds.northeast.lng - bounds.southwest.lng) * metersPerDegreeLng;

  return Math.max(latSpanMeters, lngSpanMeters);
}

function getBoundsCenter(bounds: RoofGeoBounds | null) {
  if (!bounds) {
    return null;
  }

  return {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
  };
}

function getLatLngCentroid(points: RoofViewportPoint[]) {
  const validPoints = points.filter(isValidViewportPoint);

  if (!validPoints.length) {
    return null;
  }

  return {
    lat: validPoints.reduce((sum, point) => sum + point.lat, 0) / validPoints.length,
    lng: validPoints.reduce((sum, point) => sum + point.lng, 0) / validPoints.length,
  };
}

function isValidViewportPoint(
  point: RoofViewportPoint | null | undefined
): point is RoofViewportPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lng) <= 180
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
