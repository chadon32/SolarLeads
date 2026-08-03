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
