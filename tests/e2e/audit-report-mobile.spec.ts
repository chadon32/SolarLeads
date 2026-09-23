import { expect, test } from "playwright/test";
import { TEST_EMAIL } from "../fixtures/test-data";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("393px roof workspace and report tabs fit with touch-friendly navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await expect(page.getByTestId("roof-scene-3d")).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Solar report detail sections" });
  for (const tab of await tabs.getByRole("tab").all()) {
    const box = await tab.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await tab.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("report-mobile-393.png") });
});

test("393px homeowner can upload a bill and submit its claim with the report", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await installSafeApiMocks(page);
  let uploadCount = 0;
  await page.route("**/api/utility-bills", async (route) => {
    uploadCount += 1;
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    await route.fulfill({ json: { uploaded: true, uploadClaim: "synthetic-mobile-bill-claim" } });
  });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  await page.getByLabel("Name", { exact: true }).fill("Synthetic Homeowner");
  await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
  await page.getByLabel("Owns home or rents").selectOption("Own");
  await page.getByLabel("Solar timeline").selectOption("Just researching");
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-bill.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nSynthetic browser upload fixture"),
  });
  await expect(page.getByText("Bill uploaded - estimate ready for review", { exact: true })).toBeVisible();
  expect(uploadCount).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const submit = page.getByRole("button", { name: "Send My Full Report", exact: true }).last();
  await submit.scrollIntoViewIfNeeded();
  const bounds = await submit.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  const requestPromise = page.waitForRequest("**/api/leads");
  await submit.click();
  const payload = (await requestPromise).postDataJSON();
  expect(payload.utilityBillUploaded).toBe(true);
  expect(payload.utilityBillUploadClaim).toBe("synthetic-mobile-bill-claim");
  await expect(page).toHaveURL(/\/thank-you$/);
});
