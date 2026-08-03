export const TEST_ADDRESS = "1234 Test Solar Way, Mesa, AZ 85201";
export const TEST_EMAIL = "test-homeowner@example.test";
export const TEST_PHONE = "(202) 555-0147";

const center = { lat: 33.4152, lng: -111.8315 };
const bounds = {
  northeast: { lat: center.lat + 0.00012, lng: center.lng + 0.00016 },
  southwest: { lat: center.lat - 0.00012, lng: center.lng - 0.00016 },
};

const panelCenters = Array.from({ length: 20 }, (_, index) => {
  const row = Math.floor(index / 5);
  const column = index % 5;
  return {
    center: {
      lat: center.lat + 0.00006 - row * 0.00003,
      lng: center.lng - 0.00008 + column * 0.00004,
    },
    orientation: "PORTRAIT" as const,
    azimuthDeg: 180,
    pitchDeg: 22,
    rowIndex: row,
    columnIndex: column,
    yearlyEnergyDcKwh: 680,
    segmentIndex: 0,
  };
});

export const TEST_ROOF_ANALYSIS = {
  propertyType: "residential",
  rooftopDetected: true,
  validSite: true,
  invalidReason: null,
  roofShape: "gable",
  widthM: 15,
  depthM: 11,
  grossRoofAreaM2: 165,
  usableRoofAreaM2: 88,
  pitchDeg: 22,
  usablePctRoof: 67,
  primaryRoofAzimuth: 180,
  panelCount: 20,
  originalPanelCandidateCount: 20,
  acceptedPanelCount: 20,
  rejectedPanelCandidateCount: 0,
  systemKw: 8,
  annualKwh: 13_600,
  annualSavingsUSD: 2_108,
  carbonOffsetFactorKgPerMwh: 390,
  panelCapacityWatts: 400,
  panelWidthMeters: 1.1,
  panelHeightMeters: 1.7,
  annualSunlightHours: 2_050,
  shadingRisk: "low",
  shadeNote: "No significant shading detected in the test fixture.",
  rooftopConfidenceScore: 92,
  roofOutline: [
    { x: 12, y: 14 },
    { x: 88, y: 14 },
    { x: 88, y: 86 },
    { x: 12, y: 86 },
  ],
  usableOutline: [
    { x: 20, y: 22 },
    { x: 80, y: 22 },
    { x: 80, y: 78 },
    { x: 20, y: 78 },
  ],
  obstructionOutlines: [],
  roofBounds: bounds,
  roofSegments: [
    {
      label: "primary",
      pitchDeg: 22,
      azimuthDeg: 180,
      areaM2: 88,
      panelsFit: 20,
      usable: true,
      outline: [
        { x: 12, y: 14 },
        { x: 88, y: 14 },
        { x: 88, y: 86 },
        { x: 12, y: 86 },
      ],
      bounds,
      segmentIndex: 0,
    },
  ],
  solarPanels: panelCenters,
  solarPanelConfigs: [
    { panelsCount: 20, yearlyEnergyDcKwh: 13_600 },
  ],
  confidence: "high",
  confidenceNote: "High-confidence test fixture.",
  source: "solar-api",
};

export const TEST_ANALYSIS_PROOF = {
  exp: 4_102_444_800,
  token: "e2e-test-signature",
};

export const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
