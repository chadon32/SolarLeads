import assert from "node:assert/strict";
import test from "node:test";
import { compassDirection, describeRoofFace, summarizeRoofFaces } from "../src/lib/roof-face-labels";

test("azimuths map onto eight compass directions", () => {
  assert.equal(compassDirection(0), "north");
  assert.equal(compassDirection(359), "north");
  assert.equal(compassDirection(22.4), "north");
  assert.equal(compassDirection(22.6), "north-east");
  assert.equal(compassDirection(90), "east");
  assert.equal(compassDirection(180), "south");
  assert.equal(compassDirection(225), "south-west");
  assert.equal(compassDirection(-90), "west");
});

test("a pitched face reads as direction, pitch, area, sun share and modules", () => {
  const face = describeRoofFace({ pitchDeg: 22.4, azimuthDeg: 181, areaM2: 41.6, sunShare: 0.957, moduleCount: 12 });
  assert.equal(face.title, "South-facing roof");
  assert.deepEqual(face.details, ["22° pitch", "42 m²", "96% of best-case sun", "12 modules"]);
});

test("flat faces, single modules and missing sun data read naturally", () => {
  const flat = describeRoofFace({ pitchDeg: 1.2, azimuthDeg: 90, areaM2: 18, sunShare: null, moduleCount: 1 });
  assert.equal(flat.title, "Flat roof");
  assert.deepEqual(flat.details, ["1° pitch", "18 m²", "1 module"]);
  const empty = describeRoofFace({ pitchDeg: 18, azimuthDeg: 0, areaM2: 20, sunShare: 0.71, moduleCount: 0 });
  assert.deepEqual(empty.details, ["18° pitch", "20 m²", "71% of best-case sun", "No modules"]);
});

test("the screen-reader summary lists faces largest first", () => {
  const summary = summarizeRoofFaces([
    { pitchDeg: 18, azimuthDeg: 270, areaM2: 20, sunShare: 0.87, moduleCount: 0 },
    { pitchDeg: 18, azimuthDeg: 90, areaM2: 170, sunShare: 0.98, moduleCount: 21 },
  ]);
  assert.equal(
    summary,
    "2 roof faces. East-facing roof: 18° pitch, 170 m², 98% of best-case sun, 21 modules. West-facing roof: 18° pitch, 20 m², 87% of best-case sun, No modules."
  );
});
