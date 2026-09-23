import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("an oversized bill is rejected before transmitting the file", async ({ page }) => {
  await installSafeApiMocks(page);
  let uploads = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/utility-bills")) uploads++; });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  await page.locator('input[type="file"]').setInputFiles({
    name: "oversized.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(4 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert").filter({ hasText: "4MB or smaller" })).toBeVisible();
  expect(uploads).toBe(0);
  await expect(page.getByRole("button", { name: "Send My Full Report", exact: true }).last()).toBeEnabled();
});

test("the same file can be retried after a failed upload", async ({ page }) => {
  await installSafeApiMocks(page);
  let uploads = 0;
  await page.route("**/api/utility-bills", (route) => {
    uploads++;
    return route.fulfill(uploads === 1
      ? { status: 500, json: { uploaded: false, message: "Temporary upload failure. Please retry." } }
      : { json: { uploaded: true, uploadClaim: "synthetic-retry-claim" } });
  });
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  const file = { name: "retry.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic fixture") };
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("alert").filter({ hasText: "Temporary upload failure" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("Bill uploaded - estimate ready for review", { exact: true })).toBeVisible();
  expect(uploads).toBe(2);
});

test("a pending bill can be explicitly removed before continuing without it", async ({ page }) => {
  await installSafeApiMocks(page);
  let releaseUpload!: () => void;
  const uploadHeld = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });

  await page.route("**/api/utility-bills", async (route) => {
    await uploadHeld;
    try {
      await route.fulfill({
        json: { uploaded: true, uploadClaim: "synthetic-remove-claim" },
      });
    } catch {
      // The client aborts this request when the pending bill is removed.
    }
  });

  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  await page.locator('input[type="file"]').setInputFiles({
    name: "pending.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nSynthetic pending fixture"),
  });

  const continueWithoutBill = page.getByRole("button", {
    name: "Continue without bill",
    exact: true,
  });
  await expect(continueWithoutBill).toBeVisible();
  await continueWithoutBill.click();
  releaseUpload();

  await expect(continueWithoutBill).toHaveCount(0);
  await expect(page.getByText("Upload bill", { exact: true })).toBeVisible();
});
