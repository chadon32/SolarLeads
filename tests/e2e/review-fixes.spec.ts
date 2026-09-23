import { expect, test } from "playwright/test";
import { readFile } from "node:fs/promises";
import { TEST_ADDRESS } from "../fixtures/test-data";
import { installSafeApiMocks } from "../helpers/network";

test.use({ viewport: { width: 393, height: 852 } });

test("native web content preserves adjusted settings and stays within iPhone width", async ({ page }, testInfo) => {
  await installSafeApiMocks(page);
  const source = await readFile("mobile/src/components/AnalysisScreen.tsx", "utf8");
  const bootstrap = source.match(/const nativeBootstrapScript = `([\s\S]*?)`;/)?.[1];
  expect(bootstrap).toBeTruthy();
  await page.addInitScript(() => {
    Object.assign(window, { __navigationUrl: "", ReactNativeWebView: { postMessage(raw: string) {
      const message = JSON.parse(raw);
      if (message.type === "estimate-navigation") Object.assign(window, { __navigationUrl: message.url });
    } } });
  });
  await page.addInitScript(bootstrap!);
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&app=ios&panels=10&bill=200`);
  await expect(page.locator("#report-dashboard")).toBeVisible();
  await page.getByRole("tab", { name: "Savings", exact: true }).click();
  await page.getByRole("combobox", { name: "Monthly electric bill" }).selectOption("300");
  await expect.poll(() => page.evaluate(() => (window as Window & { __navigationUrl?: string }).__navigationUrl)).toContain("bill=300");
  const navigationUrl = await page.evaluate(() => (window as Window & { __navigationUrl?: string }).__navigationUrl ?? "");
  expect(navigationUrl).toContain("panels=10");
  expect(new URL(navigationUrl, "https://solartelligence.com").searchParams.get("panel")).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
  await page.screenshot({ path: testInfo.outputPath("native-estimate-393x852.png") });
  await page.reload();
  await expect(page.locator("#report-dashboard")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __navigationUrl?: string }).__navigationUrl)).toContain("bill=300");
});

test("web scenario sharing sends only the redacted allow-listed card", async ({ page }) => {
  await installSafeApiMocks(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (payload: unknown) => {
        Object.assign(window, { __sharedScenarioPayload: payload });
      },
    });
  });
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`);
  await expect(page.locator("#report-dashboard")).toBeVisible();

  const card = page.getByTestId("redacted-scenario-share-card");
  await expect(card).toContainText("Address-free by design");
  await card.getByRole("button", { name: "Share from this device" }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __sharedScenarioPayload?: unknown }).__sharedScenarioPayload))).toBe(true);

  const payload = await page.evaluate(() => (window as Window & {
    __sharedScenarioPayload?: { title?: unknown; text?: unknown; url?: unknown };
  }).__sharedScenarioPayload);
  expect(Object.keys(payload ?? {}).sort()).toEqual(["text", "title"]);
  expect(payload?.title).toBe("Solartelligence preliminary scenario");
  expect(String(payload?.text)).toMatch(/Roof profile:|Sun exposure:|System size range:/);
  expect(String(payload?.text)).not.toMatch(/address|bill|coordinate|latitude|longitude|email|phone|name|lead|token|report/i);
  expect(payload?.url).toBeUndefined();
});

test("unfavorable financing visibly reports a loss instead of zero savings", async ({ page }, testInfo) => {
  await installSafeApiMocks(page);
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&bill=50&panels=19`);
  await expect(page.locator("#report-dashboard")).toBeVisible();
  await page.getByRole("tab", { name: "Financing", exact: true }).click();
  await page.getByRole("button", { name: "buy", exact: true }).click();
  await expect(page.getByText("20-year net loss", { exact: true })).toBeVisible();
  await expect(page.getByText(/This option costs more than utility-only power/)).toBeVisible();
  await page.getByText("20-year net loss", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("negative-net-benefit.png") });
  await page.getByRole("button", { name: "Lease", exact: true }).click();
  await expect(page.getByText("Not modeled without provider terms", { exact: true })).toBeVisible();
  await expect(page.getByText(/This option costs more than utility-only power/)).toHaveCount(0);
});
