import { expect, test, type Page } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { TEST_ADDRESS, TEST_ANALYSIS_PROOF, TEST_ROOF_ANALYSIS } from "../fixtures/test-data";
import { HomeEstimatePage } from "./pages/home-estimate-page";

/**
 * Regression checks for the fixes from the four-persona review (2026-10-05).
 */
const reportTab = (page: Page, name: string) =>
  page.getByRole("tablist", { name: "Solar report detail sections" }).getByRole("tab", { name, exact: true });

async function openEstimate(page: Page, query = "") {
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}${query}`);
  await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
}

const money = (text: string) => Number(text.replace(/[^0-9.-]/g, ""));

test.beforeEach(async ({ page }) => {
  await installSafeApiMocks(page);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 810, height: 1080 },
  { width: 390, height: 844 },
]) {
  test(`the bill and address fields are on the first screen at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    for (const field of [page.getByRole("combobox", { name: /Arizona address/i }), page.locator("#monthly-bill-input")]) {
      const box = (await field.boundingBox())!;
      expect(box.y + box.height, "field ends inside the first screen").toBeLessThanOrEqual(viewport.height);
    }
  });
}

test("the estimate shows which bill it used and lets you change it in place", async ({ page }) => {
  await openEstimate(page, "&bill=250");
  const bill = page.getByRole("combobox", { name: "Monthly electric bill" });
  await expect(bill).toBeVisible();
  await expect(bill).toHaveValue("250");
  const savings = page.getByTestId("report-kpi-grid").getByText(/^\$/).first();
  const before = await savings.textContent();
  await bill.selectOption("100");
  await expect(savings).not.toHaveText(before ?? "");
});

test("solar never shows a $0 electric bill", async ({ page }) => {
  await openEstimate(page, "&bill=150");
  await reportTab(page, "Savings").click();
  const withSolar = await page.getByRole("tabpanel", { name: "Savings" }).getByText("With solar", { exact: true }).locator("..").innerText();
  expect(money(withSolar), withSolar).toBeGreaterThan(0);
});

test("the lease view subtracts the quoted lease price", async ({ page }) => {
  await openEstimate(page, "&bill=250");
  await reportTab(page, "Financing").click();
  await page.getByRole("button", { name: "lease" }).click();
  await expect(page.getByText("Monthly bill savings", { exact: true })).toHaveCount(0);
  const before = money(await page.getByText("Bill savings before the lease payment").locator("..").innerText());
  await page.getByLabel("Monthly price from your lease or PPA quote").fill("150");
  const keep = page.getByText("What you keep each month").locator("..");
  await expect.poll(async () => money(await keep.innerText())).toBe(before - 150);
});

test("the estimate explains how it was calculated, including the imagery date", async ({ page }) => {
  await page.route("**/api/analyze-roof", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis: { ...TEST_ROOF_ANALYSIS, imageryDate: "2023-09-26" }, analysisProof: TEST_ANALYSIS_PROOF }),
    })
  );
  await openEstimate(page, "&bill=250");
  await reportTab(page, "Savings").click();
  const box = page.getByRole("region", { name: "How this estimate was calculated" });
  await expect(box).toBeVisible();
  for (const text of [/kWh per year/, /\$0\.155 per kWh/, /\$0\.0555 per kWh/, /\$14 a month/, /40%/, /per watt/, /September 2023/]) {
    await expect(box).toContainText(text);
  }
});

test("the background video control sits in the footer, not over the content", async ({ page }) => {
  await page.goto("/");
  const control = page.getByRole("button", { name: /background$/ });
  await expect(control).toHaveCount(1);
  await expect(page.locator("footer").getByRole("button", { name: /background$/ })).toHaveCount(1);
  expect(await control.evaluate((el) => getComputedStyle(el).position)).not.toBe("fixed");
});

test("required report fields are marked and the bill range matches the bill", async ({ page }) => {
  await openEstimate(page, "&bill=200");
  await reportTab(page, "Send Report").click();
  for (const name of ["Name", "Email", "Owns home or rents", "Solar timeline"]) {
    await expect(page.getByLabel(name, { exact: true })).toHaveAttribute("aria-required", "true");
  }
  await expect(page.getByLabel("Phone (optional)", { exact: true })).not.toHaveAttribute("aria-required", "true");
  await expect(page.getByText("* Required", { exact: false }).first()).toBeVisible();
  const bill = page.getByLabel("Average monthly electric bill", { exact: true });
  await expect(bill.locator("option:checked")).toHaveText("$200–$299");
});

test("the results take keyboard focus when the estimate loads", async ({ page }) => {
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.selectTestAddress();
  await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
  await expect(page.locator(":focus")).toContainText("1234 Test Solar Way");
});

test("the share preview is not read out as a live update", async ({ page }) => {
  await openEstimate(page);
  const livePreview = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-live], [role=status], [role=alert]")].some((el) => /preliminary scenario/i.test(el.textContent ?? ""))
  );
  expect(livePreview).toBe(false);
});

test("the estimate page drops home-page marketing and developer wording", async ({ page }) => {
  await page.goto("/");
  for (const phrase of ["Address lookup ready", "workflow", "220 characters"]) {
    await expect(page.getByText(phrase, { exact: false })).toHaveCount(0);
  }
  await openEstimate(page);
  const text = await page.locator("main").innerText();
  for (const phrase of ["What your Arizona solar estimate includes", "raw Solar API positions", "annual flux"]) {
    expect(text, phrase).not.toContain(phrase);
  }
});

test("an out-of-state search explains the Arizona-only coverage", async ({ page }) => {
  await page.route("**/api/places/autocomplete", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ predictions: [] }) })
  );
  await page.goto("/");
  await page.getByRole("combobox", { name: /Arizona address/i }).fill("4100 W Flamingo Rd Las Vegas");
  await expect(page.getByText(/Arizona homes only/).first()).toBeVisible();
  await expect(page.getByText(/check your spelling/i)).toHaveCount(0);
});

test("on a phone the address field keeps its pin inside the field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const input = page.getByRole("combobox", { name: /Arizona address/i });
  await input.fill("1700 W Washington St, Phoenix, AZ 85007");
  const field = (await input.boundingBox())!;
  const pin = (await page.locator("#address-estimate svg").first().boundingBox())!;
  expect(pin.y).toBeGreaterThanOrEqual(field.y - 1);
  expect(pin.y + pin.height).toBeLessThanOrEqual(field.y + field.height + 1);
});

test("the readiness score is explained as our modeled estimate, not Google data", async ({ page }) => {
  await openEstimate(page);
  await reportTab(page, "Overview").click();
  const explanation = page.getByRole("heading", { name: /Why the readiness score is \d+\/100/ }).locator("..").locator("..");
  await expect(explanation).toContainText(/modeled score/i);
  await expect(explanation).not.toContainText(/solar api/i);
});

test("an About page says who runs the site and how to reach them", async ({ page }) => {
  const response = await page.goto("/about");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/About/);
  await expect(page.getByRole("link", { name: /reports@solartelligence\.com/ })).toBeVisible();
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
});
