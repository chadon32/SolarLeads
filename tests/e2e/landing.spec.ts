import { expect, test } from "playwright/test";
import { installSafeApiMocks, monitorUnexpectedErrors } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test.beforeEach(async ({ page }) => {
  await installSafeApiMocks(page);
});

test("landing page explains the product and exposes legal/support navigation", async ({
  page,
}) => {
  const unexpectedErrors = monitorUnexpectedErrors(page);
  const home = new HomeEstimatePage(page);
  await home.open();

  await expect(page.getByRole("link", { name: /Solartelligence/i })).toHaveAttribute(
    "href",
    "/"
  );
  await expect(page.getByTestId("illustrative-sample-report")).toBeVisible();
  await expect(page.getByRole("heading", { name: "A typical Arizona roof model" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy notice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Estimate terms" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Analyze My Roof/i }).first()).toBeVisible();

  await page.getByRole("link", { name: "Privacy notice" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Privacy/i);
  await expect(page.getByText("reports@solartelligence.com")).toBeVisible();

  expect(unexpectedErrors).toEqual([]);
});

test("dashboard access token has a programmatic label", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByLabel("Dashboard access token")).toBeVisible();
  await expect(page.getByLabel("Dashboard access token")).toHaveAttribute(
    "required",
    ""
  );
});

test("privacy notice exposes direct access, correction, and deletion requests", async ({
  page,
}) => {
  await page.goto("/privacy");

  await expect(page.getByText(/No homeowner account is created/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Request my data" })).toHaveAttribute(
    "href",
    /subject=Data%20access%20request/
  );
  await expect(page.getByRole("link", { name: "Correct my data" })).toHaveAttribute(
    "href",
    /subject=Report%20data%20correction/
  );
  await expect(page.getByRole("link", { name: "Delete my data" })).toHaveAttribute(
    "href",
    /subject=Report%20data%20deletion/
  );
});

test("generated application stylesheet loads and applies", async ({ page }) => {
  const stylesheetResponses: Array<{ status: number; url: string }> = [];
  const failedRequests: Array<{ error: string; url: string }> = [];

  page.on("response", (response) => {
    if (response.url().includes(".css")) {
      stylesheetResponses.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes(".css")) {
      failedRequests.push({
        error: request.failure()?.errorText ?? "unknown",
        url: request.url(),
      });
    }
  });

  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();
  await page.waitForLoadState("networkidle");

  const bodyFont = await page.locator("body").evaluate(
    (element) => getComputedStyle(element).fontFamily
  );
  expect(
    { bodyFont, failedRequests, stylesheetResponses },
    "The production stylesheet must load before responsive and interaction checks are meaningful."
  ).toMatchObject({
    failedRequests: [],
  });
  expect(stylesheetResponses.length).toBeGreaterThan(0);
  expect(stylesheetResponses.every((response) => response.status === 200)).toBe(
    true
  );
  expect(bodyFont).not.toMatch(/Times New Roman/i);
});
