import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSolarRoofAnalysis,
  type SolarBuildingInsights,
} from "../src/lib/google-solar";

test("Solar API analysis rejects malformed panel centers and caps configurations", () => {
  const lat = 33.415;
  const lng = -111.831;
  const panels = Array.from({ length: 10 }, (_, index) => ({
    center:
      index === 1
        ? undefined
        : {
            latitude: lat + (index % 3) * 0.00001,
            longitude: lng + Math.floor(index / 3) * 0.00001,
          },
    orientation: "PORTRAIT" as const,
    segmentIndex: 0,
    yearlyEnergyDcKwh: 760,
  }));
  const insights: SolarBuildingInsights = {
    boundingBox: {
      ne: { latitude: lat + 0.00008, longitude: lng + 0.00008 },
      sw: { latitude: lat - 0.00008, longitude: lng - 0.00008 },
    },
    imageryQuality: "HIGH",
    solarPotential: {
      maxArrayAreaMeters2: 80,
      maxArrayPanelsCount: 12,
      maxSunshineHoursPerYear: 2050,
      panelCapacityWatts: 400,
      panelHeightMeters: 1.88,
      panelWidthMeters: 1.05,
      wholeRoofStats: { areaMeters2: 120 },
      roofSegmentStats: [
        {
          azimuthDegrees: 180,
          boundingBox: {
            ne: { latitude: lat + 0.00008, longitude: lng + 0.00008 },
            sw: { latitude: lat - 0.00008, longitude: lng - 0.00008 },
          },
          pitchDegrees: 18,
          stats: { areaMeters2: 120 },
        },
      ],
      solarPanels: panels,
      solarPanelConfigs: [
        { panelsCount: 8, yearlyEnergyDcKwh: 6080 },
        { panelsCount: 9, yearlyEnergyDcKwh: 6840 },
        { panelsCount: 12, yearlyEnergyDcKwh: 9120 },
      ],
    },
  };

  const analysis = buildSolarRoofAnalysis({
    address: "6420 E Nance St, Mesa, AZ 85215",
    excludedPanelIndices: new Set([2]),
    insights,
    lat,
    lng,
  });

  assert.equal(analysis.validSite, true);
  assert.equal(analysis.solarPanels.length, 8);
  assert.equal(analysis.acceptedPanelCount, 8);
  assert.equal(analysis.originalPanelCandidateCount, 8);
  assert.deepEqual(
    analysis.solarPanelConfigs.map((config) => config.panelsCount),
    [8]
  );
  assert.ok(analysis.panelCount <= analysis.solarPanels.length);
  assert.ok(
    analysis.solarPanels.every(
      (panel) => panel.center.lat !== 0 || panel.center.lng !== 0
    )
  );
});

test("Solar API analyses never invent obstruction outlines, even on shaded roofs", () => {
  const lat = 33.415;
  const lng = -111.831;
  const box = {
    ne: { latitude: lat + 0.00008, longitude: lng + 0.00008 },
    sw: { latitude: lat - 0.00008, longitude: lng - 0.00008 },
  };
  const insights: SolarBuildingInsights = {
    boundingBox: box,
    imageryQuality: "HIGH",
    solarPotential: {
      maxArrayAreaMeters2: 80,
      maxArrayPanelsCount: 6,
      // Below 1,500 hours the roof is classed as high shading risk.
      maxSunshineHoursPerYear: 1_400,
      panelCapacityWatts: 400,
      panelHeightMeters: 1.88,
      panelWidthMeters: 1.05,
      wholeRoofStats: { areaMeters2: 120 },
      roofSegmentStats: [
        { azimuthDegrees: 180, boundingBox: box, pitchDegrees: 18, stats: { areaMeters2: 70, sunshineQuantiles: [700, 900, 1_100, 1_300, 1_400] } },
        { azimuthDegrees: 0, boundingBox: box, pitchDegrees: 18, stats: { areaMeters2: 50, sunshineQuantiles: [400, 500, 600, 700, 800] } },
      ],
      solarPanels: Array.from({ length: 6 }, (_, index) => ({
        center: { latitude: lat + (index % 3) * 0.00001, longitude: lng + Math.floor(index / 3) * 0.00001 },
        orientation: "PORTRAIT" as const,
        segmentIndex: 0,
        yearlyEnergyDcKwh: 600,
      })),
      solarPanelConfigs: [{ panelsCount: 6, yearlyEnergyDcKwh: 3_600 }],
    },
  };

  const analysis = buildSolarRoofAnalysis({ address: "6420 E Nance St, Mesa, AZ 85215", insights, lat, lng });

  assert.equal(analysis.shadingRisk, "high");
  assert.deepEqual(analysis.obstructionOutlines, []);
});

test("the roof analysis keeps Google's imagery date so the estimate can show its age", async () => {
  const { normalizeRoofAnalysis } = await import("../src/lib/roof-analysis");
  const lat = 33.415;
  const lng = -111.831;
  const insights: SolarBuildingInsights = {
    boundingBox: { ne: { latitude: lat + 0.00008, longitude: lng + 0.00008 }, sw: { latitude: lat - 0.00008, longitude: lng - 0.00008 } },
    imageryDate: { year: 2023, month: 9, day: 26 },
    imageryQuality: "HIGH",
    solarPotential: {
      maxArrayAreaMeters2: 80,
      maxArrayPanelsCount: 12,
      maxSunshineHoursPerYear: 2050,
      panelCapacityWatts: 400,
      panelHeightMeters: 1.88,
      panelWidthMeters: 1.05,
      wholeRoofStats: { areaMeters2: 120 },
      roofSegmentStats: [{ azimuthDegrees: 180, boundingBox: { ne: { latitude: lat + 0.00008, longitude: lng + 0.00008 }, sw: { latitude: lat - 0.00008, longitude: lng - 0.00008 } }, pitchDegrees: 18, stats: { areaMeters2: 120 } }],
      solarPanels: Array.from({ length: 10 }, (_, index) => ({ center: { latitude: lat + (index % 3) * 0.00001, longitude: lng + Math.floor(index / 3) * 0.00001 }, orientation: "PORTRAIT" as const, segmentIndex: 0, yearlyEnergyDcKwh: 760 })),
      solarPanelConfigs: [{ panelsCount: 8, yearlyEnergyDcKwh: 6080 }, { panelsCount: 10, yearlyEnergyDcKwh: 7600 }],
    },
  };
  const analysis = buildSolarRoofAnalysis({ address: "6420 E Nance St, Mesa, AZ 85215", excludedPanelIndices: new Set(), insights, lat, lng });
  assert.equal(analysis.validSite, true);
  assert.equal(analysis.imageryDate, "2023-09-26");
  const fallback = { ...analysis, imageryDate: null };
  assert.equal(normalizeRoofAnalysis({ ...analysis }, fallback).imageryDate, "2023-09-26");
  assert.equal(normalizeRoofAnalysis({ ...analysis, imageryDate: "yesterday" }, fallback).imageryDate ?? null, null);
});
