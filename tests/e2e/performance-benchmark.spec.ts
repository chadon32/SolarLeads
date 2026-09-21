import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { writeArrayBuffer } from "geotiff";
import { installSafeApiMocks } from "../helpers/network";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "../fixtures/test-data";

test.skip(process.env.RUN_PERFORMANCE_BENCHMARK !== "true", "Opt-in isolated performance benchmark");

for (const viewport of [{ width: 1440, height: 1000 }, { width: 393, height: 852 }]) {
  test(`measure loaded roof at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const roof = structuredClone(TEST_ROOF_ANALYSIS);
    roof.solarPanels = Array.from({ length: 100 }, (_, i) => ({
      ...roof.solarPanels[0],
      center: { lat: 33.4152 + (i < 50 ? 1 : -1) * (0.000012 + Math.floor((i % 50) / 10) * 0.000016), lng: -111.83156 + (i % 10) * 0.000014 },
      segmentIndex: i < 50 ? 0 : 1, azimuthDeg: i < 50 ? 0 : 180,
      rowIndex: Math.floor(i / 10), columnIndex: i % 10,
    }));
    roof.panelCount = roof.acceptedPanelCount = roof.originalPanelCandidateCount = 100;
    roof.roofSegments = [0, 1].map((index) => ({
      ...roof.roofSegments[0], segmentIndex: index, azimuthDeg: index === 0 ? 0 : 180,
      panelsFit: 50, areaM2: 230,
      outline: [{ x: 12, y: index === 0 ? 14 : 50 }, { x: 88, y: index === 0 ? 14 : 50 }, { x: 88, y: index === 0 ? 50 : 86 }, { x: 12, y: index === 0 ? 50 : 86 }],
    }));
    roof.usableRoofAreaM2 = 400;
    roof.solarPanelConfigs = [{ panelsCount: 100, yearlyEnergyDcKwh: 68_000 }];
    await installSafeApiMocks(page, { analyzePayload: { analysis: roof } });
    const size = 80;
    const north = 33.41532, south = 33.41508, west = -111.83166, east = -111.83134;
    const heights = Float32Array.from({ length: size * size }, (_, i) => {
      const x = i % size, y = Math.floor(i / size);
      const onRoof = x >= size * 0.12 && x <= size * 0.88 && y >= size * 0.14 && y <= size * 0.86;
      return onRoof ? 407 - Math.tan(22 * Math.PI / 180) * Math.abs((y / size - 0.5) * (north - south) * 111320) : 400;
    });
    const dsm = Buffer.from(writeArrayBuffer(heights, { width: size, height: size, ModelPixelScale: [(east - west) / size, (north - south) / size, 0], ModelTiepoint: [0, 0, 0, west, north, 0], GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2 }));
    await page.route("**/__e2e__/test-dsm.tif", (route) => route.fulfill({ body: dsm, contentType: "image/tiff" }));
    await page.addInitScript(() => {
      const counters = { frames: 0, draws: 0, instancedDraws: 0 };
      Object.assign(window, { roofBenchmark: counters });
      const prototype = WebGL2RenderingContext.prototype;
      for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "clear"] as const) {
        const original = prototype[name];
        Object.defineProperty(prototype, name, { value: function (this: WebGL2RenderingContext, ...args: number[]) {
          if (this.canvas instanceof HTMLCanvasElement && this.canvas.closest('[data-testid="roof-scene-3d"]')) {
            if (name === "clear") { if ((args[0] & this.COLOR_BUFFER_BIT) && this.getParameter(this.FRAMEBUFFER_BINDING) === null) counters.frames += 1; }
            else { counters.draws += 1; if (name.endsWith("Instanced")) counters.instancedDraws += 1; }
          }
          return Reflect.apply(original, this, args);
        } });
      }
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const started = performance.now();
    await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&panels=100`);
    const scene = page.getByTestId("roof-scene-3d");
    await expect(scene).toBeVisible({ timeout: 45_000 });
    await scene.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => (window as unknown as { roofBenchmark: { frames: number } }).roofBenchmark.frames)).toBeGreaterThan(1);
    const readyMs = Math.round(performance.now() - started);
    await page.waitForTimeout(3_000);
    const snapshot = () => page.evaluate(() => ({ ...(window as unknown as { roofBenchmark: { frames: number; draws: number; instancedDraws: number } }).roofBenchmark }));
    const beforeIdle = await snapshot();
    await page.waitForTimeout(1_000);
    const afterIdle = await snapshot();
    const canvas = scene.locator("canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const beforeOrbit = await snapshot();
    await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.5, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1_500);
    const afterOrbit = await snapshot();
    const phase = process.env.PERFORMANCE_PHASE ?? "current";
    const directory = `qa-evidence/performance-${phase}`;
    await mkdir(directory, { recursive: true });
    const result = {
      viewport, readyMs, panelCount: await scene.getAttribute("data-rendered-panel-count"),
      idleFramesPerSecond: afterIdle.frames - beforeIdle.frames,
      idleDrawsPerSecond: afterIdle.draws - beforeIdle.draws,
      orbitDrawsPerFrame: Math.round((afterOrbit.draws - beforeOrbit.draws) / Math.max(1, afterOrbit.frames - beforeOrbit.frames)),
      orbitInstancedDraws: afterOrbit.instancedDraws - beforeOrbit.instancedDraws,
      errors,
    };
    await scene.screenshot({ path: `${directory}/roof-${viewport.width}.png` });
    await writeFile(`${directory}/roof-${viewport.width}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    expect(errors).toEqual([]);
  });
}
