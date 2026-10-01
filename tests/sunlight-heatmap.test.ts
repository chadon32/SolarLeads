import assert from "node:assert/strict";
import test from "node:test";
import {
  colorRoofFlux,
  sunlightRampColor,
  sunlightRampGradientCss,
  sunlightRampPosition,
} from "../src/lib/sunlight-heatmap";

const SHADE = [30, 64, 175];
const WARM = [251, 191, 36];
const SUNNY = [249, 115, 22];
const NEUTRAL = [232, 228, 220, 255] as const;

function rgbaAt(pixels: Uint8ClampedArray, index: number) {
  return Array.from(pixels.slice(index * 4, index * 4 + 4));
}

/** 6×6 grid with a 4×4 roof block (rows/cols 1–4); its 2×2 core is interior. */
function blockRoof(fluxFor: (x: number, y: number) => number) {
  const width = 6;
  const height = 6;
  const flux = new Float32Array(width * height).fill(1_000);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) flux[y * width + x] = fluxFor(x, y);
  const isRoofPixel = (index: number) => {
    const x = index % width, y = Math.floor(index / width);
    return x >= 1 && x <= 4 && y >= 1 && y <= 4;
  };
  return { width, height, flux, isRoofPixel };
}

test("ramp position is the share of this roof's best-case sun, 50% → 0 and 100% → 1", () => {
  assert.equal(sunlightRampPosition(2_000, 2_000), 1);
  assert.equal(sunlightRampPosition(1_000, 2_000), 0);
  assert.equal(sunlightRampPosition(1_500, 2_000), 0.5);
  assert.ok(Math.abs(sunlightRampPosition(1_800, 2_000) - 0.8) < 1e-9);
  assert.equal(sunlightRampPosition(2_400, 2_000), 1);
  assert.equal(sunlightRampPosition(400, 2_000), 0);
});

test("ramp position is zero when flux or the best case is missing", () => {
  assert.equal(sunlightRampPosition(Number.NaN, 2_000), 0);
  assert.equal(sunlightRampPosition(-9_999, 2_000), 0);
  assert.equal(sunlightRampPosition(1_800, 0), 0);
  assert.equal(sunlightRampPosition(1_800, Number.NaN), 0);
});

test("ramp colours run shade blue → warm amber → sunny orange and clamp", () => {
  assert.deepEqual(Object.values(sunlightRampColor(0)), SHADE);
  assert.deepEqual(Object.values(sunlightRampColor(0.5)), WARM);
  assert.deepEqual(Object.values(sunlightRampColor(1)), SUNNY);
  assert.deepEqual(Object.values(sunlightRampColor(-3)), SHADE);
  assert.deepEqual(Object.values(sunlightRampColor(7)), SUNNY);
});

test("legend gradient uses the same three stops", () => {
  assert.equal(
    sunlightRampGradientCss(),
    "linear-gradient(90deg, rgb(30, 64, 175) 0%, rgb(251, 191, 36) 50%, rgb(249, 115, 22) 100%)"
  );
});

test("roof edge pixels take interior colours instead of their mixed-pixel flux", () => {
  // Interior core is fully sunny; the edge ring carries low "mixed pixel" flux.
  const roof = blockRoof((x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3 ? 2_000 : 1_000));
  const pixels = colorRoofFlux({ ...roof, bestCaseFlux: 2_000 });
  for (let index = 0; index < roof.width * roof.height; index++) {
    if (roof.isRoofPixel(index)) assert.deepEqual(rgbaAt(pixels, index), [...SUNNY, 255], `roof pixel ${index}`);
    else assert.deepEqual(rgbaAt(pixels, index), [0, 0, 0, 0], `outside pixel ${index}`);
  }
});

test("outside bleed extends roof colours for texture filtering and leaves the rest neutral", () => {
  const roof = blockRoof(() => 2_000);
  const pixels = colorRoofFlux({ ...roof, bestCaseFlux: 2_000, outsideBleedPx: 1, outsideRgba: NEUTRAL });
  const at = (x: number, y: number) => rgbaAt(pixels, y * roof.width + x);
  assert.deepEqual(at(0, 2), [...SUNNY, 255], "edge-adjacent outside pixel bleeds");
  assert.deepEqual(at(2, 5), [...SUNNY, 255], "edge-adjacent outside pixel bleeds");
  assert.deepEqual(at(0, 0), [...NEUTRAL], "diagonal corner stays neutral after one pass");
});

test("a roof pixel with no interior neighbours keeps its own colour", () => {
  const width = 5, height = 5;
  const flux = new Float32Array(width * height).fill(2_000);
  flux[2 * width + 2] = 1_000;
  const pixels = colorRoofFlux({ flux, width, height, isRoofPixel: (index) => index === 12, bestCaseFlux: 2_000 });
  assert.deepEqual(rgbaAt(pixels, 12), [...SHADE, 255]);
  assert.deepEqual(rgbaAt(pixels, 11), [0, 0, 0, 0]);
});

test("no-data pixels inside the roof are filled from neighbouring roof colours", () => {
  const roof = blockRoof((x, y) => (x === 2 && y === 2 ? -9_999 : 2_000));
  const pixels = colorRoofFlux({ ...roof, bestCaseFlux: 2_000 });
  assert.deepEqual(rgbaAt(pixels, 2 * roof.width + 2), [...SUNNY, 255]);
});

test("at finer resolutions the interior test reaches past two rings of blended eave pixels", () => {
  const width = 10, height = 10;
  const isRoofPixel = (index: number) => {
    const x = index % width, y = Math.floor(index / width);
    return x >= 1 && x <= 8 && y >= 1 && y <= 8;
  };
  // The outer two roof rings carry low, mixed-pixel flux; the 4×4 core is sunny.
  const flux = new Float32Array(width * height).map((_, index) => {
    const x = index % width, y = Math.floor(index / width);
    return x >= 3 && x <= 6 && y >= 3 && y <= 6 ? 2_000 : 1_100;
  });
  const pixels = colorRoofFlux({ flux, width, height, isRoofPixel, bestCaseFlux: 2_000, interiorRadiusPx: 2 });
  for (let index = 0; index < width * height; index++) {
    if (isRoofPixel(index)) assert.deepEqual(rgbaAt(pixels, index), [...SUNNY, 255], `roof pixel ${index}`);
  }
});
