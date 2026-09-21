import { expect, test } from "playwright/test";
import { expectedMonthlyLoanPayment } from "../helpers/calculations";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("financing stays explicitly illustrative and exposes buy, lease, and loan", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await page.getByRole("tab", { name: "Financing" }).click();

  await expect(page.getByRole("button", { name: "buy", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lease", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Loan" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Illustrative financing scenarios" })
  ).toBeVisible();
  await expect(page.getByText("Not a loan offer", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(1);
  const buyButton = page.getByRole("button", { name: "buy", exact: true });
  await buyButton.click();
  await expect(buyButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/financing values are illustrative only/i)).toBeVisible();
  await expect(page.getByText(/installer, lender, and/i)).toBeVisible();

  const assumptions = page.locator('button[aria-controls="financing-assumptions"]');
  await expect(assumptions).toHaveText("View assumptions and exclusions");
  await expect(assumptions).toHaveAttribute("aria-expanded", "false");
  await assumptions.click();
  await expect(assumptions).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#financing-assumptions")).toBeVisible();

  const sample = expectedMonthlyLoanPayment({
    principal: 20_000,
    annualRatePct: 6.99,
    years: 25,
  });
  expect(Math.round(sample)).toBe(141);
});
