import { expect, test, type Page } from "playwright/test";
import path from "node:path";
import { getSeriousAccessibilityViolations } from "../helpers/accessibility";
import {
  installSafeApiMocks,
  monitorUnexpectedErrors,
} from "../helpers/network";
import { leadSuccess } from "../fixtures/mock-api-responses";
import { TEST_ADDRESS, TEST_EMAIL, TEST_PHONE } from "../fixtures/test-data";
import { HomeEstimatePage } from "./pages/home-estimate-page";

const evidenceRoot = path.join(
  process.cwd(),
  "qa-evidence",
  "feature-repair-2026-09-22"
);

const viewports = [
  { label: "desktop-1440x900", width: 1440, height: 900 },
  { label: "mobile-393x852", width: 393, height: 852 },
] as const;

type Persona = "salesperson" | "inexperienced-homeowner" | "young-couple" | "professional-installer";

async function capture(page: Page, name: string) {
  const filePath = path.join(evidenceRoot, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false, animations: "disabled" });
  return filePath.replaceAll("\\", "/");
}

async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(
    overflow.content,
    `page content should not exceed the ${overflow.viewport}px viewport`
  ).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function fillRequiredReportFields(page: Page) {
  await page.getByLabel("Average monthly electric bill").selectOption("$200-$300");
  await page.getByLabel("Owns home or rents").selectOption("Own");
  await page.getByLabel("Solar timeline").selectOption("Just researching");
  await page.getByLabel("Name").fill("Synthetic Homeowner");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Phone (optional)").fill(TEST_PHONE);
}

async function exercisePersona(page: Page, persona: Persona, viewportLabel: string) {
  const home = new HomeEstimatePage(page);

  if (persona === "salesperson") {
    await home.open();
    await expect(
      page.getByRole("button", {
        name: "Start roof analysis with the selected address",
      })
    ).toBeDisabled();
    await home.monthlyBillInput().fill("250");
    await home.selectTestAddress();
    await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Panels: 19 of 19", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "3D Model", exact: true }).click();
    const scene = page.getByTestId("roof-scene-3d");
    await expect(scene.locator("canvas")).toBeVisible({ timeout: 20_000 });
    await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
    const isMobile = (page.viewportSize()?.width ?? 1440) < 640;
    if (isMobile) {
      await page.getByRole("button", { name: /^Map controls/ }).click();
    }
    const panelLayer = page.getByRole("checkbox", { name: "Panels", exact: true }).first();
    await panelLayer.uncheck();
    await expect(scene).toHaveAttribute("data-rendered-panel-count", "0");
    await panelLayer.check();
    await expect(scene).toHaveAttribute("data-rendered-panel-count", "19");
    if (!isMobile) {
      await page.getByRole("combobox", { name: "Module" }).selectOption("jinko-tiger-neo");
      await expect(page.getByRole("combobox", { name: "Module" })).toHaveValue(
        "jinko-tiger-neo"
      );
    }

    await page.getByRole("tab", { name: "Savings", exact: true }).click();
    await page.getByRole("combobox", { name: "Savings monthly bill" }).selectOption("300");
    await expect(page.getByRole("combobox", { name: "Savings monthly bill" })).toHaveValue(
      "300"
    );
    await capture(page, `${viewportLabel}-salesperson-savings`);
    return;
  }

  await home.openReadyEstimate();

  if (persona === "inexperienced-homeowner") {
    await page.getByRole("tab", { name: "Send Report", exact: true }).click();
    await expect(page.getByLabel("Name")).toBeVisible();
    await page.getByRole("button", { name: "Send My Full Report", exact: true }).last().click();
    const summary = page.getByRole("alert").filter({ hasText: "Please review" }).first();
    await expect(summary).toBeFocused();
    await expect(page.locator("#lead-name-error")).toBeVisible();
    await expect(page.locator("#lead-email-error")).toBeVisible();
    await capture(page, `${viewportLabel}-inexperienced-homeowner-report-validation`);
    return;
  }

  if (persona === "young-couple") {
    await page.getByRole("tab", { name: "Panels", exact: true }).click();
    const panelSlider = page.locator('input[type="range"]').first();
    await panelSlider.fill("10");
    await expect(page.getByText("Solar panels: 10 of 19", { exact: true })).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) >= 640) {
      await page.getByRole("combobox", { name: "Module" }).selectOption("rec-alpha-pure-rx");
    }
    await page.getByRole("button", { name: "Add battery", exact: true }).click();
    await expect(page.getByRole("button", { name: "Battery added", exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Financing", exact: true }).click();
    await page.getByRole("button", { name: "loan", exact: true }).click();
    await page.getByRole("slider", { name: "Down payment", exact: true }).press("ArrowRight");
    await page.getByRole("slider", { name: "APR", exact: true }).press("ArrowRight");
    await page.getByRole("combobox", { name: "Term", exact: true }).selectOption("25");
    await expect(page.getByText("Not a loan offer", { exact: true })).toBeVisible();
    await expect(page.getByText(/financing values are illustrative only/i)).toBeVisible();
    await capture(page, `${viewportLabel}-young-couple-financing`);
    return;
  }

  await page.getByRole("tab", { name: "Roof & Shade", exact: true }).click();
  await expect(page.getByText("Roof and sunlight model", { exact: true })).toBeVisible();
  await expect(page.getByText("Installer verification checklist", { exact: true })).toBeVisible();
  await expect(page.getByText(/final panel placement/i).first()).toBeVisible();

  await page.getByRole("tab", { name: "Sunlight", exact: true }).click();
  const mapFallback = page.getByText(/Google Maps browser key or roof center is missing/i);
  const satelliteMap = page.getByRole("img", { name: new RegExp(`Satellite roof map for ${TEST_ADDRESS}`) });
  if (await mapFallback.isVisible()) {
    await expect(mapFallback).toBeVisible();
  } else {
    await expect(satelliteMap).toBeVisible({ timeout: 10_000 });
  }
  await capture(page, `${viewportLabel}-professional-installer-sunlight`);

  await page.getByRole("tab", { name: "3D Model", exact: true }).click();
  await expect(page.getByTestId("roof-scene-3d").locator("canvas")).toBeVisible({
    timeout: 20_000,
  });
  if ((page.viewportSize()?.width ?? 1440) < 640) {
    await page.getByRole("button", { name: /^Map controls/ }).click();
  }
  await expect(
    page
      .getByRole("checkbox", {
        name: (page.viewportSize()?.width ?? 1440) < 640 ? "Sunlight" : "Sunlight quality",
        exact: true,
      })
      .first()
  ).toBeChecked();
  await capture(page, `${viewportLabel}-professional-installer-3d`);
  const scene = page.getByTestId("roof-scene-3d");
  await page.getByRole("button", { name: "View roof from above" }).click();
  await expect.poll(() => scene.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.height)).toBeGreaterThan(200);
  await scene.screenshot({
    path: path.join(evidenceRoot, `${viewportLabel}-professional-installer-3d-model.png`),
    animations: "disabled",
  });
}

for (const viewport of viewports) {
  test.describe(`${viewport.label} feature audit`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page }) => {
      await installSafeApiMocks(page);
    });

    for (const persona of [
      "salesperson",
      "inexperienced-homeowner",
      "young-couple",
      "professional-installer",
    ] as const) {
      test(`${persona} journey remains usable without a real submission`, async ({ page }) => {
        const errors = monitorUnexpectedErrors(page);
        await exercisePersona(page, persona, viewport.label);
        await assertNoPageOverflow(page);
        expect(errors).toEqual([]);
      });
    }

    test("blank and invalid bill states stay visible and block analysis", async ({ page }) => {
      const home = new HomeEstimatePage(page);
      await home.open();
      const bill = home.monthlyBillInput();
      await bill.fill("");
      await expect(bill).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("#monthly-bill-error")).toContainText(/average monthly bill/i);
      await bill.fill("5001");
      await expect(bill).toHaveValue("5001");
      await expect(page.locator("#monthly-bill-error")).toContainText(/\$1 to \$5,000/i);
      await expect(
        page.getByRole("button", {
          name: "Start roof analysis with the selected address",
        })
      ).toBeDisabled();
      await capture(page, `${viewport.label}-invalid-bill`);
    });

    test("unsupported and failed uploads are recoverable without real storage", async ({ page }) => {
      const home = new HomeEstimatePage(page);
      await home.openReadyEstimate();
      await home.openReportForm();

      let uploadRequests = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/api/utility-bills")) uploadRequests += 1;
      });

      await page.locator("#utility-bill-upload").setInputFiles({
        name: "unsupported.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not a bill"),
      });
      await expect(page.getByRole("alert").filter({ hasText: /PDF, JPG, or PNG/i })).toBeVisible();
      expect(uploadRequests).toBe(0);

      await page.route("**/api/utility-bills", (route) =>
        route.fulfill({
          status: 500,
          json: { uploaded: false, message: "Temporary upload failure. Please retry." },
        })
      );
      await page.locator("#utility-bill-upload").setInputFiles({
        name: "retry.png",
        mimeType: "image/png",
        buffer: Buffer.from("synthetic image bytes"),
      });
      await expect(page.getByRole("alert").filter({ hasText: /Temporary upload failure/i })).toBeVisible();
      await capture(page, `${viewport.label}-upload-error-retry`);
    });

    test("refresh preserves the edited estimate URL and browser back returns home", async ({ page }) => {
      const home = new HomeEstimatePage(page);
      await home.open();
      await home.monthlyBillInput().fill("250");
      await home.selectTestAddress();
      await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("tab", { name: "Panels", exact: true }).click();
      await page.locator('input[type="range"]').first().fill("12");
      if ((page.viewportSize()?.width ?? 1440) >= 640) {
        await page.getByRole("combobox", { name: "Module" }).selectOption("canadian-solar-hiku6");
      }
      await page.getByRole("tab", { name: "Savings", exact: true }).click();
      await page.getByRole("combobox", { name: "Savings monthly bill" }).selectOption("300");

      await expect.poll(() => new URL(page.url()).searchParams.get("bill")).toBe("300");
      await expect.poll(() => new URL(page.url()).searchParams.get("panels")).toBe("12");
      if ((page.viewportSize()?.width ?? 1440) >= 640) {
        await expect.poll(() => new URL(page.url()).searchParams.get("panel")).toBe(
          "canadian-solar-hiku6"
        );
      }
      const urlBeforeRefresh = page.url();
      await page.reload();
      await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
      expect(page.url()).toBe(urlBeforeRefresh);
      await page.getByRole("tab", { name: "Panels", exact: true }).click();
      await expect(page.getByText("Solar panels: 12 of 19", { exact: true })).toBeVisible();
      if ((page.viewportSize()?.width ?? 1440) >= 640) {
        await expect(page.getByRole("combobox", { name: "Module" })).toHaveValue(
          "canadian-solar-hiku6"
        );
      }
      await page.getByRole("tab", { name: "Savings", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Savings monthly bill" })).toHaveValue(
        "300"
      );
      await capture(page, `${viewport.label}-refresh-restored`);

      await page.goBack();
      await expect(home.addressInput()).toBeVisible();
      await page.goForward();
      await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
    });

    test("report mock error keeps the form recoverable before mocked success", async ({ page }) => {
      let attempts = 0;
      await page.route("**/api/leads", async (route) => {
        attempts += 1;
        if (attempts === 1) {
          await route.fulfill({
            status: 500,
            json: { message: "Synthetic report service failure." },
          });
          return;
        }
        await route.fulfill({ json: leadSuccess });
      });

      const home = new HomeEstimatePage(page);
      await home.openReadyEstimate();
      await home.openReportForm();
      await fillRequiredReportFields(page);
      const submit = page.getByRole("button", { name: "Send My Full Report", exact: true }).last();
      await submit.scrollIntoViewIfNeeded();
      const firstRequest = page.waitForRequest("**/api/leads");
      await submit.click();
      await firstRequest;
      await expect(page.getByText("Synthetic report service failure.", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/estimate\?/);
      await expect(page.getByRole("button", { name: "Send My Full Report", exact: true }).last()).toBeEnabled();
      await capture(page, `${viewport.label}-report-error-recoverable`);

      const retrySubmit = page.getByRole("button", { name: "Send My Full Report", exact: true }).last();
      await retrySubmit.scrollIntoViewIfNeeded();
      await retrySubmit.click();
      await expect(page).toHaveURL(/\/thank-you$/, { timeout: 15_000 });
      expect(attempts).toBe(2);
    });

    test("ready estimate has no serious automated accessibility violations", async ({ page }) => {
      const home = new HomeEstimatePage(page);
      await home.openReadyEstimate();
      await expect(page.locator("#report-dashboard")).toBeVisible();
      await assertNoPageOverflow(page);
      expect(await getSeriousAccessibilityViolations(page)).toEqual([]);
    });
  });
}

test(
  "mocked report save shows an inline confirmation when client storage is unavailable",
  async ({ page }) => {
    await installSafeApiMocks(page);
    const home = new HomeEstimatePage(page);
    await home.openReadyEstimate();
    await home.openReportForm();
    await fillRequiredReportFields(page);

    await page.evaluate(() => {
      const storage = Storage.prototype;
      storage.setItem = function setItemUnavailable() {
        throw new Error("Synthetic client storage failure");
      };
    });

    let leadRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/leads")) leadRequests += 1;
    });
    const submit = page.getByRole("button", { name: "Send My Full Report", exact: true }).last();
    await submit.scrollIntoViewIfNeeded();
    const saveRequest = page.waitForRequest("**/api/leads");
    await submit.click();
    await saveRequest;

    await expect(page).toHaveURL(/\/estimate\?/);
    const confirmationHeading = page.getByRole("heading", {
      name: "Your solar report is ready.",
    });
    await expect(confirmationHeading).toBeVisible();
    await expect(confirmationHeading).toBeFocused();
    await expect(confirmationHeading).toBeInViewport();
    await expect(page.getByRole("link", { name: "Open PDF report" })).toHaveAttribute(
      "href",
      leadSuccess.lead.reportUrl
    );
    await expect(page.getByText(/Browser storage was unavailable/i)).toBeVisible();
    await expect(page.getByText(/Network error/i)).toHaveCount(0);
    expect(leadRequests).toBe(1);
    await capture(page, "desktop-1440x900-storage-failure-after-save");
  }
);
