import assert from "node:assert/strict";
import test from "node:test";
import { faceSunlightMedians, reconstructRoof, type RoofReconstruction } from "../src/lib/roof-reconstruction";
import { estimateGroundElevationMeters, fitSegmentPlanes } from "../src/lib/roof-scene-geometry";
import { buildSyntheticRoof, type SyntheticRoof, type SyntheticRoofKind, type SyntheticRoofOptions } from "./fixtures/synthetic-roofs";

function rebuild(kind: SyntheticRoofKind, options: SyntheticRoofOptions = {}) {
  const roof = buildSyntheticRoof(kind, options);
  const grid = { width: roof.width, height: roof.height, bounds: roof.bounds };
  const ground = estimateGroundElevationMeters(roof.dsm);
  const segmentPlanes = fitSegmentPlanes({
    panels: roof.panels,
    raster: roof.dsm,
    ...grid,
    origin: roof.origin,
    groundElevationMeters: ground,
    fallbackElevationMeters: 3.2,
  });
  const result = reconstructRoof({
    dsm: { raster: roof.dsm, ...grid },
    mask: { raster: roof.mask, ...grid },
    panels: roof.panels,
    segmentPlanes,
    origin: roof.origin,
    groundElevationMeters: ground,
  });
  assert.ok(result, `${kind} reconstruction failed`);
  return { roof, result };
}

/** Height error of every roof vertex against the analytic house. */
function surfaceErrors(roof: SyntheticRoof, result: RoofReconstruction, skip: (x: number, z: number) => boolean = () => false) {
  const errors: number[] = [];
  for (let i = 0; i < result.positions.length; i += 3) {
    const [x, y, z] = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
    const truth = roof.roofHeightAt(x, z);
    if (truth === null || skip(x, z)) continue;
    errors.push(Math.abs(y - truth));
  }
  errors.sort((a, b) => a - b);
  return { p95: errors[Math.floor(errors.length * 0.95)], count: errors.length };
}

const pairTypes = (result: RoofReconstruction) => Object.values(result.pairTypes);

test("a gable rebuilds as two panel planes meeting at a ridge", () => {
  const { result } = rebuild("gable");
  assert.equal(result.faces.length, 2);
  assert.deepEqual(result.faces.map((face) => face.segmentIndex).sort(), [0, 1]);
  for (const face of result.faces) {
    assert.ok(Math.abs(face.pitchDeg - 20) < 1, `pitch ${face.pitchDeg}`);
    assert.ok([90, 270].some((azimuth) => Math.abs(face.azimuthDeg - azimuth) < 3), `azimuth ${face.azimuthDeg}`);
  }
  assert.deepEqual(pairTypes(result), ["convex"]);
  const ridge = 3 + Math.tan((20 * Math.PI) / 180) * 6;
  assert.ok(Math.abs(result.maxHeightMeters - ridge) < 0.15, `ridge ${result.maxHeightMeters} vs ${ridge}`);
});

test("rebuilt surfaces follow the true roof, including hips and valleys", () => {
  for (const kind of ["gable", "hip", "l-shape"] as const) {
    const { roof, result } = rebuild(kind);
    const { p95, count } = surfaceErrors(roof, result);
    assert.ok(count > 1_000, `${kind}: too few vertices checked`);
    assert.ok(p95 < 0.1, `${kind}: 95th percentile height error ${p95.toFixed(3)} m`);
  }
});

test("each module lands on the face rebuilt from its own segment plane", () => {
  for (const kind of ["gable", "l-shape", "multi-level"] as const) {
    const { roof, result } = rebuild(kind);
    for (const panel of roof.panels) {
      const x = (panel.center.lng - roof.bounds.southwest.lng) / (roof.bounds.northeast.lng - roof.bounds.southwest.lng);
      const y = (roof.bounds.northeast.lat - panel.center.lat) / (roof.bounds.northeast.lat - roof.bounds.southwest.lat);
      const pixel = Math.floor(y * roof.height) * roof.width + Math.floor(x * roof.width);
      const face = result.faces.find((candidate) => candidate.id === result.pixelFaces[pixel]);
      assert.equal(face?.segmentIndex, panel.segmentIndex, `${kind}: panel on segment ${panel.segmentIndex}`);
    }
  }
});

test("a hip roof finds the three faces that carry no panels", () => {
  const { result } = rebuild("hip");
  assert.equal(result.faces.length, 4);
  assert.equal(result.faces.filter((face) => face.segmentIndex === 0).length, 1);
  assert.equal(result.faces.filter((face) => face.segmentIndex === null).length, 3);
  const azimuths = result.faces.map((face) => face.azimuthDeg);
  for (const expected of [0, 90, 180, 270]) {
    assert.ok(azimuths.some((azimuth) => Math.min(Math.abs(azimuth - expected), 360 - Math.abs(azimuth - expected)) < 6), `no face facing ${expected}°`);
  }
  for (const face of result.faces) assert.ok(Math.abs(face.pitchDeg - 22) < 2, `pitch ${face.pitchDeg}`);
  assert.ok(pairTypes(result).every((type) => type === "convex"));
});

test("an L-shaped house has valleys where the wing meets the main roof", () => {
  const { result } = rebuild("l-shape");
  assert.ok(pairTypes(result).includes("concave"), JSON.stringify(result.pairTypes));
});

test("a lower garage is a step, not a ridge", () => {
  const { roof, result } = rebuild("multi-level");
  assert.ok(pairTypes(result).includes("step"), JSON.stringify(result.pairTypes));
  const garage = result.faces.find((face) => face.segmentIndex === 1);
  assert.ok(garage && Math.abs(garage.pitchDeg - 5) < 1.5, `garage pitch ${garage?.pitchDeg}`);
  const { p95 } = surfaceErrors(roof, result, (_x, z) => Math.abs(z - 4) < 0.4);
  assert.ok(p95 < 0.1, `away from the step the surface is exact (p95 ${p95.toFixed(3)} m)`);
});

test("the eave ring recovers roof the rooftop mask erodes", () => {
  const { roof, result } = rebuild("gable", { maskErosionPx: 1 });
  let truePixels = 0;
  let maskPixels = 0;
  for (let row = 0; row < roof.height; row++) {
    for (let col = 0; col < roof.width; col++) {
      const x = -20 + (col + 0.5) * roof.pixelSizeMeters, z = -20 + (row + 0.5) * roof.pixelSizeMeters;
      if (roof.roofHeightAt(x, z) !== null) truePixels++;
      if (roof.mask[row * roof.width + col]) maskPixels++;
    }
  }
  const rebuiltPixels = result.roofPixels.reduce((sum, value) => sum + value, 0);
  assert.ok(maskPixels < truePixels * 0.92, "fixture mask is eroded");
  assert.ok(rebuiltPixels > truePixels * 0.97, `rebuilt ${rebuiltPixels} of ${truePixels} roof pixels`);
});

test("the eave ring is recovered when edge pixels blend roof and ground", () => {
  const { roof, result } = rebuild("gable", { maskErosionPx: 1, mixedEdges: true });
  const maskPixels = roof.mask.reduce((sum, value) => sum + value, 0);
  const rebuiltPixels = result.roofPixels.reduce((sum, value) => sum + value, 0);
  // True roof ≈ 24 × 40 pixels at 0.5 m; the eroded mask loses its outer ring.
  assert.ok(rebuiltPixels > maskPixels + 60, `rebuilt ${rebuiltPixels} vs mask ${maskPixels}`);
  assert.ok(rebuiltPixels <= 24 * 40 + 8, "no growth onto the ground");
});

test("walls stand under a 0.4 m eave overhang and a fascia trims the edge", () => {
  const { roof, result } = rebuild("gable");
  let wallLength = 0;
  for (let i = 0; i < result.wallPositions.length; i += 18) {
    const [ax, ay, az, bx, by, bz] = result.wallPositions.slice(i, i + 6);
    wallLength += Math.hypot(bx - ax, bz - az);
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]]) {
      const roofHeight = roof.roofHeightAt(x, z);
      assert.ok(roofHeight !== null, `wall corner (${x.toFixed(2)}, ${z.toFixed(2)}) lies under the roof`);
      assert.ok(y < roofHeight - 0.15, "wall tops sit below the roof (soffit)");
    }
  }
  const insetPerimeter = 2 * (12 - 0.8 + (20 - 0.8));
  assert.ok(Math.abs(wallLength - insetPerimeter) / insetPerimeter < 0.08, `wall length ${wallLength.toFixed(1)} vs ${insetPerimeter}`);

  assert.ok(result.fasciaPositions.length > 0);
  const fasciaDepths: number[] = [];
  for (let i = 0; i < result.fasciaPositions.length; i += 18) {
    // Quad layout: aTop, bTop, bBottom, aTop, bBottom, aBottom — compare one corner's top and bottom.
    const quad = result.fasciaPositions.slice(i, i + 18);
    fasciaDepths.push(quad[1] - quad[16]);
  }
  assert.ok(fasciaDepths.every((depth) => Math.abs(depth - 0.22) < 1e-4));
});

test("a rooftop unit becomes an obstruction, ridges and edges do not", () => {
  const clean = rebuild("gable").result;
  assert.equal(clean.obstructions.length, 0);
  const { roof, result } = rebuild("gable", { rooftopUnit: true });
  assert.equal(result.obstructions.length, 1);
  const [unit] = result.obstructions;
  assert.ok(Math.hypot(unit.x - roof.rooftopUnit!.x, unit.z - roof.rooftopUnit!.z) < 0.4, "unit position");
  assert.ok(Math.abs(unit.topM - unit.baseM - 0.8) < 0.2, `unit height ${unit.topM - unit.baseM}`);
  assert.ok(unit.widthM > 0.5 && unit.widthM < 1.6 && unit.depthM > 0.5 && unit.depthM < 1.6, "unit footprint");
});

test("results hold at the 0.25 m raster resolution", () => {
  const { roof, result } = rebuild("gable", { pixelSizeMeters: 0.25, maskErosionPx: 2 });
  assert.equal(result.faces.length, 2);
  assert.ok(Math.abs(result.pixelSizeMeters - 0.25) < 1e-6);
  assert.ok(surfaceErrors(roof, result).p95 < 0.1);
});

test("reconstruction is deterministic", () => {
  const first = rebuild("hip").result;
  const second = rebuild("hip").result;
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(first.pairTypes, second.pairTypes);
});

test("reconstruction declines when no building holds the panels or the grids differ", () => {
  const roof = buildSyntheticRoof("gable");
  const grid = { width: roof.width, height: roof.height, bounds: roof.bounds };
  const base = {
    dsm: { raster: roof.dsm, ...grid },
    mask: { raster: roof.mask, ...grid },
    segmentPlanes: new Map(),
    origin: roof.origin,
    groundElevationMeters: 400,
  };
  const farAway = roof.panels.map((panel) => ({ ...panel, center: roof.toLatLng(18, 18) }));
  assert.equal(reconstructRoof({ ...base, panels: farAway }), null);
  assert.equal(reconstructRoof({ ...base, panels: roof.panels, mask: { ...base.mask, width: roof.width - 1 } }), null);
});

test("face sunlight medians rank a hip roof's faces by orientation", () => {
  const { roof, result } = rebuild("hip");
  const medians = faceSunlightMedians(result, roof.flux);
  const byAzimuth = (target: number) => {
    const face = result.faces.find((candidate) => Math.min(Math.abs(candidate.azimuthDeg - target), 360 - Math.abs(candidate.azimuthDeg - target)) < 10)!;
    return medians.get(face.id)!;
  };
  assert.ok(byAzimuth(180) > byAzimuth(270) && byAzimuth(270) > byAzimuth(0), "south > west > north");
});

function segmentsOf(lines: Float32Array) {
  const segments: number[][] = [];
  for (let i = 0; i < lines.length; i += 6) segments.push(Array.from(lines.slice(i, i + 6)));
  return segments;
}
const lengthOf = (segments: number[][]) => segments.reduce((sum, [ax, , az, bx, , bz]) => sum + Math.hypot(bx - ax, bz - az), 0);

test("crease lines are the straight plane intersections: one ridge along a gable", () => {
  const { result } = rebuild("gable");
  const creases = segmentsOf(result.creaseLines);
  assert.equal(creases.length, 1);
  const [[ax, ay, az, bx, by, bz]] = creases;
  const ridge = 3 + Math.tan((20 * Math.PI) / 180) * 6;
  assert.ok(Math.abs(ax) < 0.2 && Math.abs(bx) < 0.2, `ridge x ${ax}, ${bx}`);
  assert.ok(Math.abs(ay - ridge) < 0.1 && Math.abs(by - ridge) < 0.1, `ridge heights ${ay}, ${by}`);
  assert.ok(Math.abs(Math.abs(bz - az) - 20) < 1, `ridge length ${Math.abs(bz - az)}`);
});

test("a hip roof has four hips and a ridge", () => {
  const { result } = rebuild("hip");
  assert.equal(segmentsOf(result.creaseLines).length, 5);
});

test("eave lines follow the roof outline", () => {
  const { result } = rebuild("gable");
  const eaves = segmentsOf(result.eaveLines);
  const low = eaves.filter(([, ay, , , by]) => ay < 3.3 && by < 3.3);
  const longSides = lengthOf(low);
  assert.ok(Math.abs(longSides - 40) < 2.5, `eave length along the long sides ${longSides.toFixed(1)}`);
});

test("steps between roof levels become cliff strips, not roof surface", () => {
  const { result } = rebuild("multi-level");
  assert.ok(result.cliffIndices.length > 0, "the garage step produces cliff triangles");
  const y = (vertex: number) => result.positions[vertex * 3 + 1];
  for (let i = 0; i < result.indices.length; i += 3) {
    const heights = [y(result.indices[i]), y(result.indices[i + 1]), y(result.indices[i + 2])];
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 0.35, "roof triangles stay on their faces");
  }
  assert.equal(result.triangleFaces.length, result.indices.length / 3);
});

test("a plain gable has no cliffs", () => {
  assert.equal(rebuild("gable").result.cliffIndices.length, 0);
});
