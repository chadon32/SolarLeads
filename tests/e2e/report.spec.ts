import { expect, test } from "playwright/test";
import { TEST_EMAIL, TEST_PHONE } from "../fixtures/test-data";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("validates lead fields without transmitting a request", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  await expect(page.getByText(/roof settings stay on this device for up to 48 hours/i)).toBeVisible();
  await expect(page.getByText(/installer contact stays off unless/i)).toBeVisible();

  let leadRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/leads")) leadRequests += 1;
  });

  await page.getByRole("button", { name: "Send My Full Report" }).last().click();
  await expect(page.locator("#lead-name-error")).toBeVisible();
  await expect(page.locator("#lead-email-error")).toBeVisible();
  expect(leadRequests).toBe(0);
});

test("moves keyboard focus to the report error summary", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  await page.getByRole("button", { name: "Send My Full Report" }).last().click();

  const summary = page
    .getByRole("alert")
    .filter({ hasText: "Please review" })
    .first();
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  const nameLink = summary.getByRole("link", { name: /full name/i });
  await expect(nameLink).toHaveAttribute("href", "#lead-name");
  await nameLink.click();
  await expect(page.getByLabel("Name")).toBeFocused();
});

test("submits one mocked report request and preserves displayed report values", async ({
  page,
}) => {
  await installSafeApiMocks(page, { leadDelayMs: 300 });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  let leadRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/leads")) leadRequests += 1;
  });

  await page.getByLabel("Average monthly electric bill").selectOption("$200-$300");
  await page.getByLabel("Owns home or rents").selectOption("Own");
  await page.getByLabel("Solar timeline").selectOption("Just researching");
  await page.getByLabel("Name").fill("Test Homeowner");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Phone (optional)").fill(TEST_PHONE);
  await expect(page.getByLabel("Name")).toHaveValue("Test Homeowner");
  await expect(page.getByLabel("Email")).toHaveValue(TEST_EMAIL);
  const submit = page.getByRole("button", { name: "Send My Full Report" }).last();
  await submit.click();

  await expect(page).toHaveURL(/\/thank-you$/, { timeout: 15_000 });
  expect(leadRequests).toBe(1);
  await expect(page.getByText(/Test/i).first()).toBeVisible();
  await expect(page.getByText(/\$2,108/).first()).toBeVisible();
});

test("changing the report bill range preserves contact details", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  await page.getByLabel("Name").fill("Test Homeowner");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Phone (optional)").fill(TEST_PHONE);
  await page.getByLabel("Average monthly electric bill").selectOption("$200-$300");

  await expect(page.getByLabel("Name")).toHaveValue("Test Homeowner");
  await expect(page.getByLabel("Email")).toHaveValue(TEST_EMAIL);
  await expect(page.getByLabel("Phone (optional)")).toHaveValue(TEST_PHONE);
});

test("report access error page is friendly and does not expose report data", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  await page.goto("/report/error?reason=expired");
  await expect(page.getByRole("heading")).toContainText(/report link/i);
  await expect(page.getByText(/expired|invalid/i).first()).toBeVisible();
});
