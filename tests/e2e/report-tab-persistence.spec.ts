import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("report details and uploaded bill survive reviewing another section", async ({ page }) => {
  await installSafeApiMocks(page);
  await page.route("**/api/utility-bills", (route) => route.fulfill({
    json: { uploaded: true, uploadClaim: "synthetic-test-claim", message: "Bill uploaded - estimate ready for review" },
  }));
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();
  await page.getByLabel("Name", { exact: true }).fill("Synthetic Homeowner");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.test");
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-bill.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic fixture"),
  });
  await expect(page.getByText("Bill uploaded - estimate ready for review", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Savings", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeHidden();
  await page.getByRole("tab", { name: "Send Report", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Synthetic Homeowner");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("qa@example.test");
  await expect(page.getByText("Bill uploaded - estimate ready for review", { exact: true })).toBeVisible();
});
