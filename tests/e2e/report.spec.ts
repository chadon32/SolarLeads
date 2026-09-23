import { expect, test } from "playwright/test";
import { TEST_EMAIL, TEST_PHONE } from "../fixtures/test-data";
import { leadSuccess } from "../fixtures/mock-api-responses";
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

test("highlights invalid fields and clears corrected entries on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  await page.getByRole("button", { name: "Send My Full Report" }).last().click();

  const name = page.locator("#lead-name");
  const ownership = page.locator("#lead-owns-home-or-rents");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(ownership).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Phone (optional)")).toHaveAttribute("aria-invalid", "false");
  await expect(name).toHaveClass(/bg-rose-950/);
  await expect(ownership).toHaveClass(/bg-rose-950/);
  await expect(name).toHaveClass(/focus:border-rose/);

  await name.fill("Test Homeowner");
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#lead-name-error")).toHaveCount(0);
  await ownership.selectOption("Own");
  await expect(ownership).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#lead-email-error")).toBeVisible();
});

test("submits one mocked report request and preserves displayed report values", async ({
  page,
}) => {
  await installSafeApiMocks(page, { leadDelayMs: 300 });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  let leadRequests = 0;
  let leadPayload: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    if (request.url().includes("/api/leads")) {
      leadRequests += 1;
      leadPayload = request.postDataJSON() as Record<string, unknown>;
    }
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
  expect(leadPayload).toBeDefined();
  expect(leadPayload).not.toHaveProperty("referredBy");
  expect(leadPayload?.roofAnalysisProof).toEqual(expect.any(Object));
  expect(leadPayload?.signedRoofAnalysis).toEqual(expect.any(Object));
  await expect(page.getByText(/Test/i).first()).toBeVisible();
  await expect(page.getByText(/\$2,108/).first()).toBeVisible();
});

test("shows a clear recovery path when report email delivery fails", async ({
  page,
}) => {
  await installSafeApiMocks(page, {
    leadPayload: {
      ...leadSuccess,
      lead: { ...leadSuccess.lead, emailDeliveryStatus: "failed" },
    },
  });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  await page.getByLabel("Average monthly electric bill").selectOption("$200-$300");
  await page.getByLabel("Owns home or rents").selectOption("Own");
  await page.getByLabel("Solar timeline").selectOption("Just researching");
  await page.getByLabel("Name").fill("Test Homeowner");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Phone (optional)").fill(TEST_PHONE);
  await page.getByRole("button", { name: "Send My Full Report" }).last().click();

  await expect(page).toHaveURL(/\/thank-you$/, { timeout: 15_000 });
  await expect(page.getByText(/couldn't send your report email/i)).toBeVisible();
  await expect(page.getByText(/your report is saved and ready/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open PDF report" })).toHaveAttribute(
    "href",
    /\/report\//
  );
  await expect(page.getByText(/email delivery may be delayed/i)).toHaveCount(0);
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

test("keeps an in-flight bill out of normal submit until explicitly removed", async ({
  page,
}) => {
  await installSafeApiMocks(page, { leadDelayMs: 300 });

  let releaseUpload!: () => void;
  const uploadHeld = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/api/utility-bills", async (route) => {
    await uploadHeld;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uploaded: true, uploadClaim: "e2e-claim" }),
    });
  });

  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  await page.getByLabel("Average monthly electric bill").selectOption("$200-$300");
  await page.getByLabel("Owns home or rents").selectOption("Own");
  await page.getByLabel("Solar timeline").selectOption("Just researching");
  await page.getByLabel("Name").fill("Test Homeowner");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Phone (optional)").fill(TEST_PHONE);

  await page.locator("#utility-bill-upload").setInputFiles({
    name: "electric-bill.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% e2e upload\n"),
  });
  await expect(page.getByText("Selected file: electric-bill.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue without bill" })).toBeVisible();

  let leadRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/leads")) leadRequests += 1;
  });

  await page.getByRole("button", { name: "Send My Full Report" }).last().click();
  await expect(
    page.getByText(/utility bill is still uploading/i).first()
  ).toBeVisible();
  expect(leadRequests).toBe(0);

  await page.getByRole("button", { name: "Continue without bill" }).click();
  releaseUpload();
  await expect(page.getByRole("button", { name: "Upload bill" })).toBeVisible();

  await page.getByRole("button", { name: "Send My Full Report" }).last().click();
  await expect(page).toHaveURL(/\/thank-you$/, { timeout: 15_000 });
  expect(leadRequests).toBe(1);
});

test("report access error page is friendly and does not expose report data", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  await page.goto("/report/error?reason=expired");
  await expect(page.getByRole("heading")).toContainText(/report link/i);
  await expect(page.getByText(/expired|invalid/i).first()).toBeVisible();
});
