import assert from "node:assert/strict";
import test from "node:test";
import { extractRoofContext } from "../src/lib/roof-context";
import { reconstructRoof } from "../src/lib/roof-reconstruction";
import { estimateGroundElevationMeters, fitSegmentPlanes } from "../src/lib/roof-scene-geometry";
import { buildSyntheticRoof, type SyntheticRoofOptions } from "./fixtures/synthetic-roofs";

function surroundings(options: SyntheticRoofOptions) {
  const roof = buildSyntheticRoof("gable", options);
  const grid = { width: roof.width, height: roof.height, bounds: roof.bounds };
  const ground = estimateGroundElevationMeters(roof.dsm);
  const segmentPlanes = fitSegmentPlanes({ panels: roof.panels, raster: roof.dsm, ...grid, origin: roof.origin, groundElevationMeters: ground, fallbackElevationMeters: 3.2 });
  const dsm = { raster: roof.dsm, ...grid };
  const mask = { raster: roof.mask, ...grid };
  const rebuilt = reconstructRoof({ dsm, mask, panels: roof.panels, segmentPlanes, origin: roof.origin, groundElevationMeters: ground });
  assert.ok(rebuilt);
  return { roof, context: extractRoofContext({ dsm, mask, buildingPixels: rebuilt.roofPixels, origin: roof.origin, groundElevationMeters: ground }) };
}

test("the house alone produces no surroundings", () => {
  const { context } = surroundings({});
  assert.deepEqual(context, { trees: [], buildings: [] });
});

test("a canopy outside the rooftop mask becomes a tree with its real size and height", () => {
  const { roof, context } = surroundings({ tree: true });
  assert.equal(context.trees.length, 1);
  const [tree] = context.trees;
  assert.ok(Math.hypot(tree.x - roof.tree!.x, tree.z - roof.tree!.z) < 0.5, `tree at (${tree.x}, ${tree.z})`);
  // The canopy rises above 2.5 m within ~2.7 m of its centre.
  assert.ok(Math.abs(tree.radiusM - 2.7) < 0.5, `radius ${tree.radiusM}`);
  assert.ok(Math.abs(tree.topM - 6) < 0.4, `top ${tree.topM}`);
  assert.ok(tree.canopyBaseM > 0.5 && tree.canopyBaseM < tree.topM - 1, `canopy base ${tree.canopyBaseM}`);
});

test("a neighbouring building comes back as a footprint and height", () => {
  const { context } = surroundings({ neighbor: true });
  assert.equal(context.buildings.length, 1);
  const [building] = context.buildings;
  assert.ok(Math.abs(building.heightM - 4) < 0.2, `height ${building.heightM}`);
  const xs = building.outline.map((point) => point.x), zs = building.outline.map((point) => point.z);
  // Footprint x 11–19, z −6–2, less the one-pixel mask erosion.
  assert.ok(Math.abs(Math.min(...xs) - 11.5) < 0.8 && Math.abs(Math.max(...xs) - 18.5) < 0.8, `x ${Math.min(...xs)}–${Math.max(...xs)}`);
  assert.ok(Math.abs(Math.min(...zs) - -5.5) < 0.8 && Math.abs(Math.max(...zs) - 1.5) < 0.8, `z ${Math.min(...zs)}–${Math.max(...zs)}`);
});

test("a neighbour's eave ring is part of that roof, not a row of trees", () => {
  // Real rooftop masks stop short of the eaves; the uncovered ring is tall
  // and outside every mask, but it hugs a roof.
  const { context } = surroundings({ neighbor: true, maskErosionPx: 2 });
  assert.equal(context.trees.length, 0, JSON.stringify(context.trees));
});

test("thin walls and fences are not drawn as trees", () => {
  const { context } = surroundings({ wall: true });
  assert.equal(context.trees.length, 0);
});
