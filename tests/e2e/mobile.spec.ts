import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("landing and roof analysis do not overflow the viewport", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();
  const landingOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(landingOverflow).toBeLessThanOrEqual(1);

  await home.openReadyEstimate();
  const analysisOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(analysisOverflow).toBeLessThanOrEqual(1);
});

test("mobile controls meet a 44px minimum target size", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();
  const cta = page.getByRole("link", { name: /Analyze My Roof|Analyze/i }).first();
  const box = await cta.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("mobile address action does not cover the address text field", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();

  if ((page.viewportSize()?.width ?? 0) >= 640) return;

  const inputBox = await home.addressInput().boundingBox();
  const actionBox = await page
    .getByRole("button", {
      name: "Start roof analysis with the selected address",
    })
    .boundingBox();

  expect(inputBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height + 8);
});

test("mobile report navigation is visible without horizontal scrolling", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  const tabList = page.getByRole("tablist", {
    name: "Solar report detail sections",
  });
  const overflow = await tabList.evaluate(
    (element) => element.scrollWidth - element.clientWidth
  );

  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("tab", { name: "Send Report" })).toBeVisible();
});

test("3D roof model remains usable without horizontal page overflow", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await page.getByRole("tab", { name: "3D Model" }).click();
  const scene = page.getByTestId("roof-scene-3d");
  await expect(scene).toBeVisible({ timeout: 20_000 });
  await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  const sceneBox = await scene.boundingBox();
  const viewportWidth = page.viewportSize()?.width ?? 0;

  expect(pageOverflow).toBeLessThanOrEqual(1);
  expect(sceneBox).not.toBeNull();
  expect(sceneBox!.x).toBeGreaterThanOrEqual(0);
  expect(sceneBox!.x + sceneBox!.width).toBeLessThanOrEqual(viewportWidth + 1);
});

test("mobile report summary keeps homeowner KPIs compact and uses homeowner language", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  if ((page.viewportSize()?.width ?? 0) >= 640) return;

  const kpiGrid = page.getByTestId("report-kpi-grid");
  await expect(kpiGrid).toBeVisible();
  const columnCount = await kpiGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length
  );

  expect(columnCount).toBe(2);
  await expect(kpiGrid.getByText("Solar readiness", { exact: true })).toBeVisible();
  await expect(kpiGrid.getByText("Annual savings", { exact: true })).toBeVisible();
  await expect(page.getByText("Solar score", { exact: true })).toHaveCount(0);
});

test("native app readiness waits for the completed rooftop image", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const messages: string[] = [];
    Object.assign(window, {
      __solartelligenceNativeMessages: messages,
      ReactNativeWebView: {
        postMessage(message: string) {
          messages.push(message);
        },
      },
    });
  });
  await installSafeApiMocks(page, { satelliteDelayMs: 800 });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await expect(
    page.getByText("Analyzing roof with Google Solar data...")
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const messages = (
          window as Window & { __solartelligenceNativeMessages?: string[] }
        ).__solartelligenceNativeMessages;

        return Boolean(
          messages?.some((rawMessage) => {
            try {
              const message = JSON.parse(rawMessage) as {
                status?: string;
                type?: string;
              };
              return message.type === "analysis-status" && message.status === "done";
            } catch {
              return false;
            }
          })
        );
      })
    )
    .toBe(true);
});
