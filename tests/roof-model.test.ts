import assert from "node:assert/strict";
import test from "node:test";
import { computeRoofModel, type RoofModelJob } from "../src/lib/roof-model";
import { isRoofReconstructionEnabled, runRoofModel } from "../src/lib/roof-model-runner";
import { estimateGroundElevationMeters, fitSegmentPlanes } from "../src/lib/roof-scene-geometry";
import { buildSyntheticRoof } from "./fixtures/synthetic-roofs";

function gableJob(): RoofModelJob {
  const roof = buildSyntheticRoof("gable", { tree: true });
  const grid = { width: roof.width, height: roof.height, bounds: roof.bounds };
  const ground = estimateGroundElevationMeters(roof.dsm);
  return {
    dsm: { raster: roof.dsm, ...grid },
    mask: { raster: roof.mask, ...grid },
    flux: { raster: roof.flux, ...grid },
    panels: roof.panels,
    segmentPlanes: fitSegmentPlanes({ panels: roof.panels, raster: roof.dsm, ...grid, origin: roof.origin, groundElevationMeters: ground, fallbackElevationMeters: 3.2 }),
    origin: roof.origin,
    groundElevationMeters: ground,
  };
}

test("a roof model bundles the rebuilt roof, its surroundings and per-face sunlight", () => {
  const model = computeRoofModel(gableJob());
  assert.ok(model);
  assert.equal(model.reconstruction.faces.length, 2);
  assert.equal(model.context.trees.length, 1);
  assert.equal(model.faceSunlight.length, 2);
  for (const [face, flux] of model.faceSunlight) {
    assert.ok(model.reconstruction.faces.some((candidate) => candidate.id === face));
    assert.ok(flux > 1_000 && flux <= 2_000);
  }
});

test("without a flux layer the model still builds, with no sunlight figures", () => {
  const model = computeRoofModel({ ...gableJob(), flux: null });
  assert.ok(model);
  assert.deepEqual(model.faceSunlight, []);
});

test("where workers are unavailable the runner builds on the main thread and caches per key", async () => {
  const job = gableJob();
  const first = await runRoofModel(job, { cacheKey: "gable-test" });
  const second = await runRoofModel(job, { cacheKey: "gable-test" });
  assert.ok(first);
  assert.equal(second, first, "the same key reuses the built model");
});

test("reconstruction is on by default, off by flag, and query overrides both ways", () => {
  assert.equal(isRoofReconstructionEnabled({ flag: undefined, search: "" }), true);
  assert.equal(isRoofReconstructionEnabled({ flag: "off", search: "" }), false);
  assert.equal(isRoofReconstructionEnabled({ flag: undefined, search: "?roofModel=segments" }), false);
  assert.equal(isRoofReconstructionEnabled({ flag: "off", search: "?address=x&roofModel=reconstructed" }), true);
});
