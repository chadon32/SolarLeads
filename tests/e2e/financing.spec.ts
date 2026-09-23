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

test("loan assumptions and the current scenario follow active controls", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await page.getByRole("tab", { name: "Financing" }).click();

  const downPayment = page.getByRole("slider", {
    name: "Down payment",
    exact: true,
  });
  await downPayment.focus();
  for (let step = 0; step < 20; step += 1) {
    await downPayment.press("ArrowRight");
  }

  const apr = page.getByRole("slider", { name: "APR", exact: true });
  await apr.focus();
  await apr.press("ArrowRight");
  await page.getByRole("combobox", { name: "Term", exact: true }).selectOption("25");

  const currentScenario = page.locator('[aria-label="Current financing scenario"]');
  await expect(currentScenario).toContainText("$200/mo bill");
  await expect(currentScenario).toContainText("19 panels");
  await expect(currentScenario).toContainText("20% down, 6.6% APR, 25-year term");

  const assumptions = page.locator('button[aria-controls="financing-assumptions"]');
  await assumptions.click();
  const assumptionsPanel = page.locator("#financing-assumptions");
  await expect(assumptionsPanel).toContainText("20% down, 6.6% APR, 25-year term");
  await expect(assumptionsPanel).toContainText("Scheduled loan payments (25 years)");
  await expect(assumptionsPanel).toContainText(
    "Includes the full 25-year loan payment obligation"
  );
  await expect(assumptionsPanel).toContainText(
    "20-year cost with solar (includes full 25-year loan)"
  );
  await expect(assumptionsPanel).not.toContainText("Baseline loan scenario");
  await expect(assumptionsPanel).not.toContainText("6.49% APR / 20 years");
});

test("overview and savings explain the modeled homeowner metrics", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await expect(
    page.getByRole("button", { name: "Copy homeowner summary", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/Estimated system power rating\. One kW equals 1,000 watts/i)
  ).toBeVisible();
  await expect(
    page.getByText(/Modeled net comparison of utility and solar costs over 20 years/i)
  ).toBeVisible();

  await page.getByRole("tab", { name: "Savings" }).click();
  await expect(
    page.getByText(/Annual savings is a modeled first-year estimate/i)
  ).toBeVisible();
  await expect(
    page.getByText(/Payback is the estimated time for modeled savings to cover/i)
  ).toBeVisible();
});
