import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../../helpers/network";
import { HomeEstimatePage } from "../pages/home-estimate-page";

test("Maya and Daniel can revise assumptions and compare financing modes", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await page.getByRole("tab", { name: "Savings" }).click();
  const bill = page.getByRole("combobox", { name: "Monthly electric bill" });
  await bill.selectOption("300");
  await expect(bill).toHaveValue("300");

  await page.getByRole("tab", { name: "Financing" }).click();
  await expect(page.getByText("Not a loan offer", { exact: true })).toBeVisible();
  for (const mode of ["buy", "Lease", "loan"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
  }
  await expect(page.getByText(/estimate|illustrative/i).first()).toBeVisible();
});
