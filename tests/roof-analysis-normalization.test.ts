import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoofAnalysis, normalizeRoofAnalysis } from "../src/lib/roof-analysis";

const fallback = buildFallbackRoofAnalysis({ address: "1 Test St, Mesa, AZ 85201", lat: 33.4, lng: -111.8 });

test("the illustrative fallback carries no invented obstructions", () => {
  assert.deepEqual(fallback.obstructionOutlines, []);
});

test("an explicit empty obstruction list survives normalisation", () => {
  const normalized = normalizeRoofAnalysis({ ...fallback, shadingRisk: "high", obstructionOutlines: [] }, fallback);
  assert.deepEqual(normalized.obstructionOutlines, []);
});

test("a missing obstruction list normalises to none rather than placeholder boxes", () => {
  const withoutOutlines = Object.fromEntries(Object.entries(fallback).filter(([key]) => key !== "obstructionOutlines"));
  const normalized = normalizeRoofAnalysis({ ...withoutOutlines, shadingRisk: "high" }, fallback);
  assert.deepEqual(normalized.obstructionOutlines, []);
});

test("measured obstruction outlines are preserved", () => {
  const outline = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }];
  const normalized = normalizeRoofAnalysis({ ...fallback, obstructionOutlines: [outline] }, fallback);
  assert.deepEqual(normalized.obstructionOutlines, [outline]);
});
