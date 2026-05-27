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

export type RoofAnalysis = {
  zoom: number;
  usableRoofPercent: number;
  estimatedPanelCount: number;
  estimatedSystemSizeKw: number;
  estimatedAnnualSavings: number;
  estimatedMonthlySavings: number;
  estimatedRoofAreaSqm: number;
  estimatedUsableSolarAreaSqm: number;
  estimatedRoofLengthMeters: number;
  estimatedRoofWidthMeters: number;
  roofPitchDegrees: number;
  confidence: "low" | "medium" | "high";
};

export function buildRoofAnalysis(params: {
  address: string;
  lat: number;
  lng: number;
  viewport?: RoofViewport;
}): RoofAnalysis {
  const spanLat = params.viewport
    ? Math.abs(params.viewport.northeast.lat - params.viewport.southwest.lat)
    : 0.01;
  const spanLng = params.viewport
    ? Math.abs(params.viewport.northeast.lng - params.viewport.southwest.lng)
    : 0.01;
  const span = Math.max(spanLat, spanLng);
  const zoom = getRoofZoom(span);

  const usableRoofPercent = clamp(
    Math.round(64 + (zoom - 18) * 7 + (span < 0.006 ? 5 : 0)),
    60,
    88
  );
  const estimatedPanelCount = clamp(
    Math.round(usableRoofPercent / 3.1),
    18,
    32
  );
  const estimatedSystemSizeKw = Number((estimatedPanelCount * 0.42).toFixed(1));
  const estimatedAnnualSavings = Math.round(estimatedSystemSizeKw * 255);
  const estimatedMonthlySavings = Math.round(estimatedAnnualSavings / 12);
  const estimatedRoofAreaSqm = Number(
    ((estimatedPanelCount * 1.95) / (usableRoofPercent / 100)).toFixed(1)
  );
  const estimatedUsableSolarAreaSqm = Number(
    (estimatedRoofAreaSqm * (usableRoofPercent / 100)).toFixed(1)
  );
  const estimatedRoofLengthMeters = Number(
    Math.sqrt(estimatedRoofAreaSqm * 1.55).toFixed(1)
  );
  const estimatedRoofWidthMeters = Number(
    (estimatedRoofAreaSqm / estimatedRoofLengthMeters).toFixed(1)
  );
  const roofPitchDegrees = clamp(Math.round(18 + (estimatedPanelCount - 16) * 0.35), 18, 31);
  const confidence = zoom >= 21 ? "high" : zoom >= 20 ? "medium" : "low";

  return {
    zoom,
    usableRoofPercent,
    estimatedPanelCount,
    estimatedSystemSizeKw,
    estimatedAnnualSavings,
    estimatedMonthlySavings,
    estimatedRoofAreaSqm,
    estimatedUsableSolarAreaSqm,
    estimatedRoofLengthMeters,
    estimatedRoofWidthMeters,
    roofPitchDegrees,
    confidence,
  };
}

export function getRoofZoom(span: number) {
  if (span <= 0.003) return 21;
  if (span <= 0.008) return 20;
  if (span <= 0.02) return 19;
  return 18;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
