import assert from "node:assert/strict";
import test from "node:test";
import {
  ARIZONA_INSTALLED_COST_MARKET,
  INSTALLED_COST_PER_WATT,
} from "../src/lib/solar-assumptions";
import {
  getPanelDimensionsMeters,
  getPanelFit,
  SOLAR_PANELS,
} from "../src/lib/solarPanels";

const EXPECTED_PANEL_SPECS = [
  ["rec-alpha-pure-rx", 430, 22.3, "1730 x 1118 mm", 20, -0.24],
  ["qcells-q-peak-duo", 400, 20.4, "1879 x 1045 mm", 25, -0.34],
  ["canadian-solar-hiku6", 410, 21, "1722 x 1134 mm", 25, -0.34],
  ["sunpower-maxeon-6", 420, 21.7, "1872 x 1032 mm", 25, -0.29],
  ["jinko-tiger-neo", 415, 21.25, "1722 x 1134 mm", 12, -0.3],
  ["panasonic-evervolt", 410, 22.2, "1821 x 1016 mm", 25, -0.26],
] as const;

test("panel catalog preserves manufacturer-backed electrical and physical specs", () => {
  assert.equal(SOLAR_PANELS.length, EXPECTED_PANEL_SPECS.length);

  for (const [
    id,
    watts,
    efficiency,
    dimensions,
    warrantyYears,
    temperatureCoefficient,
  ] of EXPECTED_PANEL_SPECS) {
    const panel = SOLAR_PANELS.find((candidate) => candidate.id === id);
    assert.ok(panel, `${id} should exist in the catalog`);
    assert.equal(panel.watts, watts);
    assert.equal(panel.efficiency, efficiency);
    assert.equal(panel.dimensions, dimensions);
    assert.equal(panel.warranty_years, warrantyYears);
    assert.equal(panel.tempCoefficient, temperatureCoefficient);
    assert.match(panel.specSourceUrl, /^https:\/\//);
  }
});

test("panel dimensions convert to the physical footprint used by map and 3D layouts", () => {
  assert.deepEqual(getPanelDimensionsMeters(SOLAR_PANELS[0]), {
    heightMeters: 1.73,
    widthMeters: 1.118,
  });
  assert.deepEqual(getPanelDimensionsMeters(SOLAR_PANELS[1]), {
    heightMeters: 1.879,
    widthMeters: 1.045,
  });
  assert.deepEqual(getPanelDimensionsMeters(SOLAR_PANELS[5]), {
    heightMeters: 1.821,
    widthMeters: 1.016,
  });
});

test("catalog pricing uses one sourced Arizona installed-cost benchmark", () => {
  assert.equal(INSTALLED_COST_PER_WATT, 2.3);
  assert.equal(ARIZONA_INSTALLED_COST_MARKET.lowPerWatt, 1.96);
  assert.equal(ARIZONA_INSTALLED_COST_MARKET.highPerWatt, 2.65);

  for (const panel of SOLAR_PANELS) {
    assert.equal(panel.installedCostPerWatt, INSTALLED_COST_PER_WATT);
  }
});

test("installed price uses exact module watts instead of rounded display kW", () => {
  const jinko = SOLAR_PANELS.find((panel) => panel.id === "jinko-tiger-neo");
  assert.ok(jinko);

  const fit = getPanelFit(jinko, {
    maxSunshineHoursPerYear: 1800,
    selectedPanelCount: 10,
    usableAreaM2: 100,
  });

  assert.equal(fit.systemKw, 4.2);
  assert.equal(
    fit.systemCost,
    Math.round(10 * 415 * INSTALLED_COST_PER_WATT)
  );
});

test("all catalog modules use exact watts in a 20-panel installed estimate", () => {
  const expectedCosts = new Map([
    ["rec-alpha-pure-rx", 19_780],
    ["qcells-q-peak-duo", 18_400],
    ["canadian-solar-hiku6", 18_860],
    ["sunpower-maxeon-6", 19_320],
    ["jinko-tiger-neo", 19_090],
    ["panasonic-evervolt", 18_860],
  ]);

  for (const panel of SOLAR_PANELS) {
    const fit = getPanelFit(panel, {
      maxSunshineHoursPerYear: 2_050,
      selectedPanelCount: 20,
      usableAreaM2: 200,
    });

    assert.equal(fit.systemCost, expectedCosts.get(panel.id), panel.id);
  }
});
