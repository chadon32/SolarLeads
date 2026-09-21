import { mkdir } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("captures safe desktop and mobile QA evidence", async ({ page }) => {
  await mkdir("qa-evidence", { recursive: true });
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await home.open();
  await page.screenshot({
    path: "qa-evidence/local-homepage-desktop.png",
    fullPage: false,
  });

  await home.openReadyEstimate();
  await page.locator("#solar-workspace").scrollIntoViewIfNeeded();
  await expect(page.getByText("Panels: 19 of 19", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "qa-evidence/local-roof-analysis-desktop.png",
    fullPage: false,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#solar-workspace").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "qa-evidence/local-roof-analysis-mobile.png",
    fullPage: false,
  });
});
