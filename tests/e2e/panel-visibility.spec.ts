import { expect, test } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("3D panel toggle visibly changes the rendered roof, not just the counter", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  const scene = page.getByTestId("roof-scene-3d");
  const canvas = scene.locator("canvas");
  await expect(canvas).toBeVisible();
  await scene.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "View roof from above", exact: true }).click();
  await page.waitForTimeout(500);
  const dir = path.join(tmpdir(), "solartelligence-panel-visibility");
  await mkdir(dir, { recursive: true });
  const box = (await canvas.boundingBox())!;
  // Inspect roof pixels only: changing checkbox/counter text is not proof
  // that the WebGL panels are visible.
  const clip = { x: box.x + box.width * 0.32, y: box.y + box.height * 0.27, width: box.width * 0.24, height: box.height * 0.27 };
  const before = await page.screenshot({ clip, path: path.join(dir, "panels-on.png") });
  await page.getByRole("checkbox", { name: "Panels", exact: true }).first().uncheck();
  await page.waitForTimeout(500);
  const hidden = await page.screenshot({ clip, path: path.join(dir, "panels-off.png") });
  await test.info().attach("panels-on", { body: before, contentType: "image/png" });
  await test.info().attach("panels-off", { body: hidden, contentType: "image/png" });
  const onPixels = await sharp(before).removeAlpha().raw().toBuffer();
  const offPixels = await sharp(hidden).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let index = 0; index < onPixels.length; index += 1) {
    if (Math.abs(onPixels[index] - offPixels[index]) > 20) changed += 1;
  }
  expect(changed / onPixels.length, "panels must visibly cover roof pixels, not merely alter a few shadow pixels").toBeGreaterThan(0.01);
});
