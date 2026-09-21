import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test.beforeEach(async ({ page }) => {
  await installSafeApiMocks(page);
});

test("monthly bill control clearly rejects negative and empty values", async ({
  page,
}) => {
  const home = new HomeEstimatePage(page);
  await home.open();
  const bill = home.monthlyBillInput();

  await bill.fill("-250");
  await expect(bill).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Enter a whole-dollar bill from $1 to $5,000.")
  ).toBeVisible();
  await bill.fill("");
  await expect(bill).toHaveAttribute("aria-invalid", "true");
});

test("monthly bill accepts whole dollars and flags decimals", async ({ page }) => {
  const home = new HomeEstimatePage(page);
  await home.open();
  const bill = home.monthlyBillInput();

  for (const value of ["50", "250", "750"]) {
    await bill.fill(value);
    await expect(bill).toHaveValue(value);
    await expect(bill).toHaveAttribute("aria-invalid", "false");
  }

  await bill.fill("250.50");
  await expect(bill).toHaveAttribute("aria-invalid", "true");
});

test("bill input uses a numeric mobile input mode and a minimum", async ({ page }) => {
  const home = new HomeEstimatePage(page);
  await home.open();
  await expect(home.monthlyBillInput()).toHaveAttribute("inputmode", "numeric");
  await expect(home.monthlyBillInput()).toHaveAttribute("min", "1");
});
