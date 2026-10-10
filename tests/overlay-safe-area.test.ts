import assert from "node:assert/strict";
import test from "node:test";
import { computeSafeInsets, NO_INSETS } from "../src/lib/overlay-safe-area";

// Overlay rectangles measured on the live estimate page (630 × 480 canvas).
const LAYERS = { left: 480, top: 12, right: 618, bottom: 127 };
const MODULE_PANEL = { left: 368, top: 278, right: 618, bottom: 468 };
const TOOLBAR = { left: 12, top: 393, right: 262, bottom: 468 };

test("no overlays means no insets", () => {
  assert.deepEqual(computeSafeInsets({ width: 630, height: 480 }, []), NO_INSETS);
});

test("desktop overlays push the roof into the uncovered left region", () => {
  const insets = computeSafeInsets({ width: 630, height: 480 }, [LAYERS, MODULE_PANEL, TOOLBAR], { margin: 0 });
  assert.deepEqual(insets, { top: 0, right: 262, bottom: 87, left: 0 });
});

test("a margin keeps the roof clear of overlay edges", () => {
  const insets = computeSafeInsets({ width: 630, height: 480 }, [LAYERS, MODULE_PANEL, TOOLBAR], { margin: 8 });
  assert.deepEqual(insets, { top: 0, right: 270, bottom: 95, left: 0 });
});

test("a phone's bottom toolbar only lifts the roof", () => {
  const insets = computeSafeInsets({ width: 307, height: 384 }, [{ left: 12, top: 300, right: 295, bottom: 372 }], { margin: 0 });
  assert.deepEqual(insets, { top: 0, right: 0, bottom: 84, left: 0 });
});

test("overlays that leave too little room are ignored rather than shrinking the roof", () => {
  const insets = computeSafeInsets({ width: 600, height: 400 }, [{ left: 150, top: 0, right: 600, bottom: 400 }], { margin: 0 });
  assert.deepEqual(insets, NO_INSETS);
});

test("hidden, empty and off-canvas overlays are ignored", () => {
  const insets = computeSafeInsets(
    { width: 630, height: 480 },
    [
      { left: 0, top: 0, right: 0, bottom: 0 },
      { left: 700, top: 10, right: 900, bottom: 200 },
      { left: 100, top: -300, right: 200, bottom: -20 },
    ],
    { margin: 0 }
  );
  assert.deepEqual(insets, NO_INSETS);
});
