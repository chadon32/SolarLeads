import assert from "node:assert/strict";
import test from "node:test";
import { estimateBatteryRuntime, readRunningWatts, runtimeLabel } from "../src/lib/battery-runtime";
import { getBatteryById } from "../src/lib/batteries";

test("runtime uses energy divided by load; partial charge scales the available energy", () => {
  const battery = getBatteryById("powerwall3");
  for (const [load, charge, hours] of [["1,500", 50, 4.5], ["1000", 100, 13.5], ["1000", 0, 0]] as const) {
    const result = estimateBatteryRuntime(battery, { load, charge });
    assert.equal(result.kind, "runtime");
    if (result.kind === "runtime") assert.equal(result.hours, hours);
  }
});

test("rated continuous power is allowed but one extra watt suppresses the runtime", () => {
  const battery = getBatteryById("enphase10t");
  assert.equal(battery.capacityKwh, 10.08);
  assert.equal(estimateBatteryRuntime(battery, { load: "3840", charge: 100 }).kind, "runtime");
  assert.equal(runtimeLabel(estimateBatteryRuntime(battery, { load: "3841", charge: 100 })), "Above power rating");
  assert.equal(runtimeLabel(estimateBatteryRuntime(getBatteryById("pwrcell"), { load: "1500", charge: 50 })), "6 hr");
});

test("invalid drafts and missing ratings cannot produce zero, infinity or fabricated output", () => {
  for (const bad of ["", " ", "1.5", "-100", "0", "1,00", "1e3", "10 kW", "12345678901234567890"]) {
    assert.equal(readRunningWatts(bad), null);
    assert.equal(estimateBatteryRuntime(getBatteryById(), { load: bad, charge: 100 }).kind, "invalid");
  }
  for (const charge of [-1, 101, NaN, Infinity]) {
    assert.equal(estimateBatteryRuntime(getBatteryById(), { load: "100", charge }).kind, "invalid");
  }
  for (const spec of [{ capacityKwh: 0, powerKw: 1 }, { capacityKwh: 1, powerKw: NaN }]) {
    assert.equal(estimateBatteryRuntime(spec, { load: "100", charge: 50 }).kind, "invalid");
  }
});
