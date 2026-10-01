import assert from "node:assert/strict";
import test from "node:test";
import { planModuleFace, type ModuleFaceLayout } from "../src/lib/module-face";
import { SOLAR_PANELS } from "../src/lib/solarPanels";

// Datasheet facts (cells across the short edge × rows along the long edge).
const DATASHEET: Record<string, { across: number; along: number; halfCut: boolean; total: number }> = {
  "rec-alpha-pure-rx": { across: 5, along: 16, halfCut: true, total: 80 },
  "qcells-q-peak-duo": { across: 6, along: 22, halfCut: true, total: 132 },
  "canadian-solar-hiku6": { across: 6, along: 18, halfCut: true, total: 108 },
  "sunpower-maxeon-6": { across: 6, along: 11, halfCut: false, total: 66 },
  "jinko-tiger-neo": { across: 6, along: 18, halfCut: true, total: 108 },
  "panasonic-evervolt": { across: 6, along: 22, halfCut: true, total: 132 },
};

const HALF_CUT_BLACK: ModuleFaceLayout = {
  cellsAcross: 6,
  cellsAlong: 22,
  halfCut: true,
  backsheet: "black",
  frame: "black",
  frontContacts: "multi-busbar",
};

test("every catalog module carries its datasheet cell layout", () => {
  for (const panel of SOLAR_PANELS) {
    const expected = DATASHEET[panel.id];
    assert.ok(expected, `no datasheet entry for ${panel.id}`);
    assert.ok(panel.face, `${panel.id} has no face layout`);
    assert.equal(panel.face.cellsAcross, expected.across, panel.id);
    assert.equal(panel.face.cellsAlong, expected.along, panel.id);
    assert.equal(panel.face.halfCut, expected.halfCut, panel.id);
    assert.equal(panel.face.cellsAcross * panel.face.cellsAlong, expected.total, panel.id);
  }
});

test("catalog appearance matches the verified datasheet variants", () => {
  const face = (id: string) => SOLAR_PANELS.find((panel) => panel.id === id)!.face!;
  assert.equal(face("qcells-q-peak-duo").backsheet, "black"); // BLK
  assert.equal(face("panasonic-evervolt").backsheet, "black"); // Black Series
  assert.equal(face("sunpower-maxeon-6").backsheet, "white"); // SPR-MAX6-420 (BLK is the black variant)
  assert.equal(face("sunpower-maxeon-6").frontContacts, "none"); // back-contact cells
  for (const panel of SOLAR_PANELS) assert.equal(panel.face!.frame, "black", panel.id);
});

test("a portrait plan lays out every cell inside the face with the half-cut split", () => {
  const plan = planModuleFace(HALF_CUT_BLACK, { alongToAcrossRatio: 1879 / 1045 });
  assert.equal(plan.cells.length, 6 * 22);
  assert.ok(plan.height > plan.width, "portrait faces are taller than wide");
  for (const cell of plan.cells) {
    assert.ok(cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= plan.width + 1e-9 && cell.y + cell.h <= plan.height + 1e-9);
  }
  const rowTops = [...new Set(plan.cells.map((cell) => cell.y))].sort((a, b) => a - b);
  const steps = rowTops.slice(1).map((y, index) => y - rowTops[index]);
  const typical = steps[0];
  const split = steps[10];
  assert.equal(rowTops.length, 22);
  assert.ok(split > typical + 2, "the centre split between the two half-cut strings is wider than a row step");
});

test("a landscape plan transposes the portrait face", () => {
  const portrait = planModuleFace(HALF_CUT_BLACK, { alongToAcrossRatio: 1.8 });
  const landscape = planModuleFace(HALF_CUT_BLACK, { alongToAcrossRatio: 1.8, landscape: true });
  assert.equal(landscape.width, portrait.height);
  assert.equal(landscape.height, portrait.width);
  assert.equal(landscape.cells.length, portrait.cells.length);
  assert.equal(landscape.cells[0].w, portrait.cells[0].h);
  assert.equal(landscape.cells[0].h, portrait.cells[0].w);
});

test("back-contact cells draw no front wires and keep their clipped corners", () => {
  const plan = planModuleFace(
    { cellsAcross: 6, cellsAlong: 11, halfCut: false, backsheet: "white", frame: "black", frontContacts: "none", chamferedCells: true },
    { alongToAcrossRatio: 1872 / 1032 }
  );
  assert.equal(plan.wires.length, 0);
  assert.ok(plan.chamferPx > 0);
  assert.notEqual(plan.backsheetColor, planModuleFace(HALF_CUT_BLACK, { alongToAcrossRatio: 1.8 }).backsheetColor);
});

test("multi-busbar cells carry thin wires and gapless strings tile without gaps", () => {
  const wired = planModuleFace(HALF_CUT_BLACK, { alongToAcrossRatio: 1.8 });
  assert.ok(wired.wires.length >= wired.cells.length * 3);
  const gapless = planModuleFace({ ...HALF_CUT_BLACK, gapless: true }, { alongToAcrossRatio: 1.8 });
  const [first, second] = gapless.cells;
  assert.ok(Math.abs(second.x - (first.x + first.w)) < 1e-9, "neighbouring cells touch");
});
