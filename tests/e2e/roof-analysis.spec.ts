import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test.beforeEach(async ({ page }) => {
  await installSafeApiMocks(page);
});

test("renders a ready roof analysis with panels and roof planes enabled", async ({
  page,
}) => {
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await expect(page.getByTestId("mock-satellite-map")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Panels" }).first()).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Roof planes" }).first()
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

  const tab = page.getByRole("tab", { name: "Overview" }).first();
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
