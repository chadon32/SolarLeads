import { expect, test } from "playwright/test";
import { roofAnalysisSuccess } from "../fixtures/mock-api-responses";
import { TEST_ADDRESS } from "../fixtures/test-data";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

for (const status of [400, 403, 404, 500]) {
  test(`roof analysis handles API ${status} safely`, async ({ page }) => {
    await installSafeApiMocks(page, {
      analyzeStatus: status,
      analyzePayload: {
        message:
          status >= 500
            ? "Roof analysis is temporarily unavailable."
            : "A usable residential rooftop could not be confirmed.",
      },
    });
    await page.goto(
      "/estimate?address=1234%20Test%20Solar%20Way%2C%20Mesa%2C%20AZ%2085201"
    );

    if (status >= 500) {
      await expect(
        page.getByText("Solar data not available for this address.", {
          exact: true,
        })
      ).toBeVisible();
    } else {
      await expect(
        page.getByText(/usable residential roof was not confirmed/i)
      ).toBeVisible();
    }
  });
}

test("429 response explains temporary limiting and recovery", async ({ page }) => {
  await installSafeApiMocks(page, {
    analyzeStatus: 429,
    analyzePayload: { message: "Too many roof scans. Please try again shortly." },
  });
  await page.goto(
    "/estimate?address=1234%20Test%20Solar%20Way%2C%20Mesa%2C%20AZ%2085201"
  );
  await expect(page.getByText("Roof analysis is temporarily limited.")).toBeVisible();
  await expect(page.getByText(/Please wait a minute/i)).toBeVisible();
});

test("analysis progress is announced as a polite atomic status", async ({ page }) => {
  await installSafeApiMocks(page, { analyzeDelayMs: 800 });
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`);

  const progress = page
    .getByRole("status")
    .filter({ hasText: "Analyzing roof with Google Solar data..." });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-live", "polite");
  await expect(progress).toHaveAttribute("aria-atomic", "true");
});

test("rooftop view tabs use roving keyboard focus", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  const sunlightTab = page.getByRole("tab", { name: "Sunlight", exact: true });
  const modelTab = page.getByRole("tab", { name: "3D Model", exact: true });
  await expect(modelTab).toHaveAttribute("tabindex", "0");
  await expect(sunlightTab).toHaveAttribute("tabindex", "-1");

  await modelTab.focus();
  await modelTab.press("ArrowRight");
  await expect(sunlightTab).toBeFocused();
  await expect(sunlightTab).toHaveAttribute("aria-selected", "true");
  await expect(modelTab).toHaveAttribute("tabindex", "-1");

  await sunlightTab.press("ArrowLeft");
  await expect(modelTab).toBeFocused();
  await expect(modelTab).toHaveAttribute("aria-selected", "true");

  await sunlightTab.focus();
  await sunlightTab.press("Home");
  await expect(sunlightTab).toBeFocused();
  await expect(sunlightTab).toHaveAttribute("aria-selected", "true");

  await sunlightTab.press("End");
  await expect(modelTab).toBeFocused();
  await expect(modelTab).toHaveAttribute("aria-selected", "true");
});

for (const status of [429, 500]) {
  test(`${status} analysis response retries once for the same address`, async ({
    page,
  }) => {
    await installSafeApiMocks(page);
    await page.unroute("**/api/analyze-roof");

    let analysisRequests = 0;
    const requestedAddresses: string[] = [];
    await page.route("**/api/analyze-roof", async (route) => {
      analysisRequests += 1;
      const body = route.request().postDataJSON() as { address?: string };
      requestedAddresses.push(body.address ?? "");

      if (analysisRequests === 1) {
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({
            message:
              status === 429
                ? "Too many roof scans. Please try again shortly."
                : "Roof analysis is temporarily unavailable.",
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(roofAnalysisSuccess),
      });
    });

    await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`);
    const retryButton = page.getByRole("button", {
      name: "Retry analysis",
      exact: true,
    });
    await expect(retryButton).toBeVisible();

    await retryButton.scrollIntoViewIfNeeded();
    await expect(retryButton).toBeInViewport();
    await retryButton.click();
    await expect(page.locator("#report-dashboard")).toBeVisible({
      timeout: 20_000,
    });

    expect(analysisRequests).toBe(2);
    expect(requestedAddresses).toEqual([TEST_ADDRESS, TEST_ADDRESS]);
  });
}

test("malformed lead response shows a recoverable error", async ({ page }) => {
  await installSafeApiMocks(page, { leadPayload: { unexpected: true } });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  await page.getByLabel("Average monthly electric bill").selectOption("$200-$300");
  await page.getByLabel("Owns home or rents").selectOption("Own");
  await page.getByLabel("Solar timeline").selectOption("Just researching");
  await page.getByLabel("Name").fill("Test Homeowner");
  await page.getByLabel("Email").fill("test-homeowner@example.test");
  await page.getByRole("button", { name: "Send My Full Report" }).last().click();

  await expect(page.getByText("Could not save your report request.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send My Full Report" }).last()
  ).toBeEnabled();
});
