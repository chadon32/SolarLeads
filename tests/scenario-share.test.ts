import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRedactedScenarioText,
  getBroadRoofCategory,
  getBroadSunCategory,
  getSystemRange,
} from "../src/lib/scenario-share";

test("redacted scenario export contains only allow-listed broad fields", () => {
  const text = buildRedactedScenarioText({
    label: "unexpected homeowner name",
    roof: "unexpected address",
    sun: "unexpected bill",
    system: "unexpected report token",
  });

  assert.match(text, /Planning baseline/);
  assert.match(text, /Mixed roof planes/);
  assert.match(text, /Higher sun exposure/);
  assert.match(text, /3–4 kW/);
  assert.doesNotMatch(text, /unexpected|coordinate|latitude|longitude|lead|token|email|phone/i);
  assert.doesNotMatch(text, /\$|@|\?address=|\?bill=/i);
});

test("broad share categories are derived without exposing property detail", () => {
  assert.equal(getBroadRoofCategory("gable"), "Mostly gable roof");
  assert.equal(getBroadRoofCategory("complex"), "Mixed roof planes");
  assert.equal(getBroadSunCategory("low"), "Higher sun exposure");
  assert.equal(getBroadSunCategory("high"), "Lower sun exposure");
  assert.equal(getSystemRange(5.4), "5–6 kW");
  assert.equal(getSystemRange(8.8), "9–10 kW");
});
