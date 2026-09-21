import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../../helpers/network";
import { HomeEstimatePage } from "../pages/home-estimate-page";

test("Marcus can reach a useful mobile roof estimate without submitting a lead", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  const startedAt = Date.now();
  await home.open();
  await home.selectTestAddress();
  await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Share estimate" })).toBeVisible();
  await expect(page.getByText("Panels: 19 of 19", { exact: true })).toBeVisible();
  await expect(page.getByText(/installer verification/i).first()).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(180_000);
});
