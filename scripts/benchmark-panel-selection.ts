import { performance } from "node:perf_hooks";
import { selectCohesiveSolarPanels } from "../src/lib/panel-layout";
import type { SolarPanelPlacement } from "../src/lib/roof-analysis";

const dimensions = { panelWidthMeters: 1.1, panelHeightMeters: 1.8 };

function buildPanels(count: number): SolarPanelPlacement[] {
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    azimuthDeg: 180,
    center: {
      lat: 33.45 + Math.floor(index / columns) * 0.000018,
      lng: -111.94 + (index % columns) * 0.000022,
    },
    columnIndex: index % columns,
    orientation: "PORTRAIT" as const,
    pitchDeg: 20,
    rowIndex: Math.floor(index / columns),
    segmentIndex: 0,
    yearlyEnergyDcKwh: 700 + (index % 17) * 3,
  }));
}

function checksum(panels: SolarPanelPlacement[]) {
  return panels.reduce(
    (sum, panel) => sum + panel.center.lat + panel.center.lng + panel.yearlyEnergyDcKwh,
    0
  );
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

for (const count of [50, 100, 200]) {
  const targetCount = Math.floor(count / 2);
  const samples = count >= 200 ? 25 : 50;

  // A new array and new panel objects each sample bypass the WeakMap cache.
  const coldTimes: number[] = [];
  let coldChecksum = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const started = performance.now();
    coldChecksum = checksum(
      selectCohesiveSolarPanels({ ...dimensions, panels: buildPanels(count), targetCount })
    );
    coldTimes.push(performance.now() - started);
  }

  const warmPanels = buildPanels(count);
  const expectedChecksum = checksum(
    selectCohesiveSolarPanels({ ...dimensions, panels: warmPanels, targetCount })
  );
  const warmTimes: number[] = [];
  let warmChecksum = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const started = performance.now();
    warmChecksum = checksum(
      selectCohesiveSolarPanels({ ...dimensions, panels: warmPanels, targetCount })
    );
    warmTimes.push(performance.now() - started);
  }

  if (coldChecksum !== expectedChecksum || warmChecksum !== expectedChecksum) {
    throw new Error(`Selection checksum mismatch for ${count} panels.`);
  }

  console.log(JSON.stringify({
    panels: count,
    targetCount,
    samples,
    coldFreshArrayMedianMs: Number(median(coldTimes).toFixed(3)),
    warmExactKeyMedianMs: Number(median(warmTimes).toFixed(3)),
    checksum: expectedChecksum,
  }));
}
