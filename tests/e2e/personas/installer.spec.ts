import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../../helpers/network";
import { HomeEstimatePage } from "../pages/home-estimate-page";

test("Luis sees the technical inputs and preliminary-design limitations", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  await page.getByRole("tab", { name: "Roof & Shade" }).click();
  await expect(page.getByText("Roof and sunlight model")).toBeVisible();
  await expect(page.getByText("Roof area", { exact: true })).toBeVisible();
  await expect(page.getByText(/orientation/i).first()).toBeVisible();
  await expect(page.getByText("Installer verification checklist")).toBeVisible();
  await expect(page.getByText(/electrical service capacity/i)).toBeVisible();
  await page.getByRole("tab", { name: "Panels" }).click();
  await expect(page.getByText(/400W/i).first()).toBeVisible();
  await expect(page.getByText(/final panel placement/i).first()).toBeVisible();
});
