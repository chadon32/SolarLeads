import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "playwright/test";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "../tests/fixtures/test-data";
import { placeDetailsSuccess } from "../tests/fixtures/mock-api-responses";
import { installSafeApiMocks } from "../tests/helpers/network";
import { calculateTwentyYearSolarCosts } from "../src/lib/financial-model";
import { getPanelById, getPanelFit, DEFAULT_SOLAR_PANEL_ID } from "../src/lib/solarPanels";
import { buildActiveSolarEstimate } from "../src/lib/active-solar-estimate";
import { buildSolarReportSnapshot, rebuildTrustedSolarReportSnapshot } from "../src/lib/report-snapshot";
import { selectCohesiveSolarPanels } from "../src/lib/panel-layout";
import type { RoofAnalysis } from "../src/lib/roof-analysis";

// Diagnostic evidence, not a regression suite: records current behavior without
// calling paid services, creating leads, or asserting that known defects are OK.
async function main() {
  const base = process.env.REVIEW_BASE_URL ?? "http://127.0.0.1:3100";
  if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) {
    throw new Error("This review must run against a local server.");
  }
  const directory = "qa-evidence/project-review-fixes-2026-09-04";
  await mkdir(directory, { recursive: true });
  const selectedModule = getPanelById(DEFAULT_SOLAR_PANEL_ID);
  const roof = {
    ...TEST_ROOF_ANALYSIS,
    solarPanelConfigs: [
      { panelsCount: 10, yearlyEnergyDcKwh: 6800 },
      { panelsCount: 20, yearlyEnergyDcKwh: 13600 },
    ],
  } as RoofAnalysis;
  const sparseConfigurations = [10, 11, 15, 19].map((count) => {
    const fit = getPanelFit(selectedModule, {
      roofData: roof,
      monthlyBill: 500,
      selectedPanelCount: count,
    });
    return { count: fit.maxPanelsFit, annualKwh: fit.annualKwh, systemCost: fit.systemCost };
  });
  const lossScenario = calculateTwentyYearSolarCosts({
    annualSavings: 1000, monthlyBill: 100, totalSolarPayments: 30000,
  });
  const mixedRoof = {
    ...TEST_ROOF_ANALYSIS,
    solarPanelConfigs: [],
    solarPanels: TEST_ROOF_ANALYSIS.solarPanels.map((panel, index) => ({
      ...panel,
      segmentIndex: index < 2 ? index + 1 : 0,
      yearlyEnergyDcKwh: index < 2 ? 1000 : 900,
    })),
  } as RoofAnalysis;
  const selected = selectCohesiveSolarPanels({
    panels: mixedRoof.solarPanels,
    targetCount: 10,
    panelWidthMeters: mixedRoof.panelWidthMeters,
    panelHeightMeters: mixedRoof.panelHeightMeters,
  });
  const cohesiveEnergy = {
    displayedArrayKwh: selected.reduce((sum, panel) => sum + panel.yearlyEnergyDcKwh, 0),
    estimatedKwh: getPanelFit(selectedModule, {
      roofData: mixedRoof, monthlyBill: 500, selectedPanelCount: 10,
    }).annualKwh,
  };
  const liveEstimate = buildActiveSolarEstimate({
    analysis: TEST_ROOF_ANALYSIS as RoofAnalysis,
    monthlyBill: 200, selectedPanel: selectedModule, selectedPanelCount: 10,
  });
  const savedEstimate = rebuildTrustedSolarReportSnapshot(buildSolarReportSnapshot({
    address: TEST_ADDRESS,
    analysis: TEST_ROOF_ANALYSIS as RoofAnalysis,
    activePanelCount: 10, monthlyBill: 200,
  }), {
    selectedPanel: selectedModule,
    panelWatts: selectedModule.watts,
    installedCostPerWatt: selectedModule.installedCostPerWatt, monthlyBill: 200,
  });
  const reportMismatch = {
    live: { panelCount: liveEstimate.panelCount, annualKwh: liveEstimate.annualKwh, annualSavings: liveEstimate.annualSavings },
    saved: savedEstimate.metrics,
  };
  const calculations = { sparseConfigurations, lossScenario, cohesiveEnergy, reportMismatch };
  if (process.argv.includes("--math-only")) {
    await writeFile(`${directory}/calculations.json`, JSON.stringify(calculations, null, 2));
    console.log(JSON.stringify(calculations, null, 2));
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await installSafeApiMocks(page);
    let finishDetails: () => void = () => undefined;
    const detailsGate = new Promise<void>((resolve) => { finishDetails = resolve; });
    await page.route("**/api/places/details**", async (route) => {
      await detailsGate;
      await route.fulfill({ json: placeDetailsSuccess });
    });
    await page.goto(base);
    const input = page.getByRole("combobox");
    await input.fill("1234");
    await page.getByRole("option").first().click();
    await expect(input).toHaveAttribute("aria-busy", "true");
    const newerQuery = "9876 Different Test Street, Mesa, AZ 85201";
    await input.fill(newerQuery);
    await page.screenshot({ path: `${directory}/address-edited-during-lookup.png` });
    finishDetails();
    await expect(input).toHaveAttribute("aria-busy", "false");
    await page.waitForTimeout(600);
    await expect(input).toHaveValue(newerQuery);
    await expect(page).not.toHaveURL(/\/estimate\?/);
    const openedAddress = new URL(page.url()).searchParams.get("address");
    await page.screenshot({ path: `${directory}/stale-address-cancelled.png` });

    // Exercise the actual native-injected script on the current estimate DOM.
    // This does not pretend to be a physical iPhone or React Native runtime.
    const nativeSource = await readFile("mobile/src/components/AnalysisScreen.tsx", "utf8");
    const cleanBootstrap = nativeSource.match(/const nativeBootstrapScript = `([\s\S]*?)`;/)?.[1];
    if (!cleanBootstrap) throw new Error("Native bootstrap script not found.");
    await page.addInitScript(cleanBootstrap);
    await page.goto(`${base}/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&app=ios`);
    await expect(page.locator("#report-dashboard")).toBeVisible();
    await expect(page.getByTestId("roof-scene-3d")).toHaveAttribute("data-rendered-panel-count", "19");
    await page.locator("#rooftop-analysis").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/native-web-content-393x852.png` });
    const nativeOverflow = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    await context.close();

    const authChecks = [];
    for (const path of [
      "/api/leads/status", "/api/leads/notes", "/api/leads/follow-up",
      "/api/follow-ups/send-now", "/api/report/email", "/api/notifications/test",
      "/api/utility-bills/cleanup",
    ]) {
      const response = await fetch(`${base}${path}`, {
        method: path.startsWith("/api/leads/") ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      authChecks.push({ path, status: response.status });
      if (response.status !== 403) throw new Error(`Unexpected auth status at ${path}`);
    }
    const results = {
      measuredAt: new Date().toISOString(),
      ...calculations,
      staleAddress: { newerQuery, openedAddress },
      nativeOverflow,
      authChecks,
    };
    await writeFile(`${directory}/diagnostics.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
