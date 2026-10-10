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

for (const invalidBill of ["0", "5001"]) {
  test(`preserves ${invalidBill} and blocks homepage analysis entry`, async ({ page }) => {
    const home = new HomeEstimatePage(page);
    await home.open();
    const bill = home.monthlyBillInput();

    await bill.fill(invalidBill);
    await expect(bill).toHaveValue(invalidBill);
    await expect(page.locator("#monthly-bill-error")).toContainText(
      /Check your monthly bill|Enter a whole-dollar bill from \$1 to \$5,000/i
    );

    await home.addressInput().fill("1234 Test");
    await expect(page.getByRole("option", { name: /1234 Test Solar Way/i })).toBeVisible();
    await page.getByRole("option", { name: /1234 Test Solar Way/i }).click();

    await expect(bill).toHaveValue(invalidBill);
    await expect(page.locator("#monthly-bill-error")).toContainText(
      /Enter a whole-dollar bill from \$1 to \$5,000/i
    );
    await expect(page).not.toHaveURL(/\/estimate\?/);
    await expect(page.locator("#solar-workspace")).toHaveCount(0);
  });

  test(`preserves ${invalidBill} and blocks shared estimate analysis entry`, async ({
    page,
  }) => {
    let analysisRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/analyze-roof")) analysisRequests += 1;
    });

    await page.goto(
      `/estimate?address=${encodeURIComponent("1234 Test Solar Way, Mesa, AZ 85201")}&bill=${invalidBill}`
    );
    const home = new HomeEstimatePage(page);
    const bill = home.monthlyBillInput();

    await expect(bill).toHaveValue(invalidBill);
    await expect(page.locator("#monthly-bill-error")).toContainText(
      /Enter a whole-dollar bill from \$1 to \$5,000/i
    );
    await expect(page.locator("#solar-workspace")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`[?&]bill=${invalidBill}(?:&|$)`));
    expect(analysisRequests).toBe(0);
  });
}
