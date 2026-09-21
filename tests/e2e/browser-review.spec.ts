import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { TEST_ADDRESS } from "../fixtures/test-data";

test.beforeEach(async ({ page }) => { await installSafeApiMocks(page); });

test("hidden progress navigation is not exposed to keyboard or accessibility APIs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Roof Analysis", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Skip to main content" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /^Solartelligence Satellite/ })).toBeFocused();
});

test("custom bill remains selected across both bill controls and refresh", async ({ page }) => {
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&bill=237`);
  await expect(page.locator("#report-dashboard")).toBeVisible();
  const quickBill = page.getByRole("combobox", { name: "Monthly electric bill", exact: true });
  await expect(quickBill).toHaveValue("237");
  await page.getByRole("tab", { name: "Savings", exact: true }).click();
  const savingsBill = page.getByRole("combobox", { name: "Savings monthly bill", exact: true });
  await expect(savingsBill).toHaveValue("237");
  await savingsBill.selectOption("300");
  await expect(quickBill).toHaveValue("300");
  await page.reload();
  await expect(quickBill).toHaveValue("300");
});

test("all report sections include labels and readable contrast", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`);
  await expect(page.locator("#report-dashboard")).toBeVisible();
  for (const name of ["Overview", "Roof & Shade", "Panels", "Savings", "Financing", "Send Report"]) {
    await page.getByRole("tablist", { name: "Solar report detail sections" }).getByRole("tab", { name, exact: true }).click();
    if (name === "Send Report") await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    const result = await new AxeBuilder({ page }).include("#report-dashboard").analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), name).toEqual([]);
  }
});

test("missing page provides an accessible recovery route", async ({ page }) => {
  const response = await page.goto("/__audit_missing_page__");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Back to Solartelligence" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("background motion can be paused and stays stopped", async ({ page }) => {
  await page.goto("/");
  const pause = page.getByRole("button", { name: "Pause background", exact: true });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: "Resume background", exact: true })).toBeVisible();
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  const position = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
  await page.waitForTimeout(700);
  expect(await video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(position);
  await expect(video).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Resume background", exact: true }).click();
  await expect(pause).toBeVisible();
});
