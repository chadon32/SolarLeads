import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test.beforeEach(async ({ page }) => {
  await installSafeApiMocks(page);
});

test("3D rate limits explain the failure and retry recovers", async ({ page }) => {
  let limited = true;
  await page.route("**/__e2e__/test-dsm.tif", async (route) => {
    if (!limited) return route.fallback();
    await route.fulfill({ status: 429, headers: { "Retry-After": "120" }, body: "{}" });
  });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await expect(page.getByText(/roof imagery request limit was reached/i)).toBeVisible();
  await expect(page.getByText(/3D model data is not available for this address/i)).toHaveCount(0);
  limited = false;
  await page.getByRole("button", { name: "Retry 3D model" }).click();
  await expect(page.getByTestId("roof-scene-3d").locator("canvas")).toBeVisible();
});

test("renders a ready 3D roof analysis with panels and sunlight enabled", async ({
  page,
}) => {
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await expect(page.getByTestId("roof-scene-3d").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("mock-satellite-map")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Panels" }).first()).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Sunlight quality" }).first()
  ).toBeChecked();
  await expect(page.getByText(/19 panel layout/i).first()).toBeVisible();
  await expect(page.getByText(/7\.6 kW/i).first()).toBeVisible();
  await expect(
    page.getByText(/current roof model supports 19 accepted panel locations/i).first()
  ).toBeVisible();
  await expect(page.getByText(/installer verification/i).first()).toBeVisible();
});

test("roof analysis view tabs expose complete tab semantics", async ({ page }) => {
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  const rooftopTabs = page.getByRole("tablist", {
    name: "Rooftop analysis views",
  });
  const tab = rooftopTabs.getByRole("tab", { name: "3D Model" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveAttribute("aria-controls", /.+/);
  const panelId = await tab.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  await expect(page.locator(`#${panelId}`)).toHaveAttribute("role", "tabpanel");
});

test("3D model renders the selected module footprint and accepted panel count", async ({
  page,
}) => {
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await page.getByRole("tab", { name: "3D Model" }).click();
  const scene = page.getByTestId("roof-scene-3d");
  await expect(scene).toBeVisible({ timeout: 20_000 });
  await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
  await expect(scene).toHaveAttribute("data-panel-height-meters", "1.879");
  await expect(scene).toHaveAttribute("data-panel-width-meters", "1.045");

  const moduleSelect = page.getByRole("combobox", { name: "Module" });
  const modules = [
    ["rec-alpha-pure-rx", "1.73", "1.118"],
    ["qcells-q-peak-duo", "1.879", "1.045"],
    ["canadian-solar-hiku6", "1.722", "1.134"],
    ["sunpower-maxeon-6", "1.872", "1.032"],
    ["jinko-tiger-neo", "1.722", "1.134"],
    ["panasonic-evervolt", "1.821", "1.016"],
  ] as const;

  for (const [id, heightMeters, widthMeters] of modules) {
    await moduleSelect.selectOption(id);
    await expect(moduleSelect).toHaveValue(id);
    await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
    await expect(scene).toHaveAttribute(
      "data-panel-height-meters",
      heightMeters
    );
    await expect(scene).toHaveAttribute(
      "data-panel-width-meters",
      widthMeters
    );
  }
});

test("loading sequence is announced as status", async ({ page }) => {
  await installSafeApiMocks(page, { analyzeDelayMs: 1_500 });
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.selectTestAddress();

  const sequence = page.getByRole("status").filter({ hasText: "AI analysis" });
  await expect(sequence).toHaveAttribute("role", "status");
  await expect(sequence).toHaveAttribute("aria-live", "polite");
});

test("camera controls work without changing panels, support keyboard, and leave the map deferred", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  const scene = page.getByTestId("roof-scene-3d");
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("mock-satellite-map")).toHaveCount(0);
  await scene.scrollIntoViewIfNeeded();
  const original = await scene.locator("canvas").screenshot();
  const toolbar = page.getByRole("toolbar", { name: "3D camera controls" });
  for (const button of await toolbar.getByRole("button").all()) {
    const size = await button.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "View roof from above" }).click();
  await expect.poll(async () => !(await scene.locator("canvas").screenshot()).equals(original)).toBe(true);
  await page.getByRole("button", { name: "Zoom into roof" }).click();
  await page.getByRole("button", { name: "Zoom out of roof" }).click();
  await page.getByRole("button", { name: "View roof in perspective" }).click();
  await scene.focus();
  await scene.press("ArrowRight");
  await scene.press("Home");
  await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
  await page.getByRole("checkbox", { name: "Panels", exact: true }).first().uncheck();
  await expect(scene).toHaveAttribute("data-rendered-panel-count", "0");
  await page.getByRole("checkbox", { name: "Panels", exact: true }).first().check();
  await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
  await page.getByRole("tab", { name: "Sunlight", exact: true }).click();
  await expect(page.getByTestId("mock-satellite-map")).toBeVisible();
  await expect(scene).toHaveCount(0);
  await page.getByRole("tab", { name: "3D Model", exact: true }).click();
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("mock-satellite-map")).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "Sunlight quality" }).first()).toBeChecked();
  expect(errors).toEqual([]);
});

test("3D camera controls fit a phone and work in the embedded app layout", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/estimate?address=1234%20Test%20Solar%20Way%2C%20Mesa%2C%20AZ%2085201&app=ios");
  const scene = page.getByTestId("roof-scene-3d");
  await expect(scene.locator("canvas")).toBeVisible({ timeout: 20_000 });
  await scene.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "View roof from above" }).click();
  await page.getByRole("button", { name: "Reset 3D view" }).click();
  for (const button of await page.getByRole("toolbar", { name: "3D camera controls" }).getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
  }
  await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
