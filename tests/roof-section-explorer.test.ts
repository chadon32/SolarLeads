import assert from "node:assert/strict";
import test from "node:test";
import { listAnalysisSections } from "../src/lib/roof-section-explorer";
import { describeRoofFace, summarizeRoofFaces } from "../src/lib/roof-face-labels";
import type { RoofSegment } from "../src/lib/roof-analysis";

const segment: RoofSegment = { label: "primary", pitchDeg: 20, azimuthDeg: 180, areaM2: 60, panelsFit: 40, usable: true, outline: [], bounds: null, segmentIndex: 0 };
test("read-only sections preserve source identity without inventing sunlight or displayed panels", () => {
  const roofSegments = [{ ...segment, segmentIndex: 12 }, segment, { ...segment, segmentIndex: undefined }, { ...segment, areaM2: 0 }];
  const rows = listAnalysisSections({ source: "solar-api", roofSegments });
  assert.deepEqual(rows.map(row => row.id), [12, 0]);
  assert.deepEqual(rows[0], { id: 12, pitchDeg: 20, azimuthDeg: 180, areaM2: 60, sunShare: null, moduleCount: null });
  for (const source of ["modeled", "vision-api"] as const) assert.deepEqual(listAnalysisSections({ source, roofSegments }), []);
});

test("hidden panels are distinguished from an empty layout in visual and accessible descriptions", () => {
  const face = { ...segment, moduleCount: 0, sunShare: null };
  assert.ok(describeRoofFace(face, true).details.includes("No modules"));
  assert.ok(describeRoofFace(face, false).details.includes("Panels hidden"));
  assert.match(summarizeRoofFaces([face], false), /Panels hidden/);
  assert.doesNotMatch(summarizeRoofFaces([face], false), /No modules|best-case sun/);
});
