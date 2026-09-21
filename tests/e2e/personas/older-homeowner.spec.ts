import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../../helpers/network";
import { HomeEstimatePage } from "../pages/home-estimate-page";

test("Eleanor can understand consent and request a report using the keyboard", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();
  await home.openReportForm();

  await expect(page.getByText("Optional installer follow-up")).toBeVisible();
  const consent = page.getByRole("checkbox", {
    name: /Optional installer follow-up/i,
  });
  await expect(consent).not.toBeChecked();
  await expect(page.getByText(/roof settings stay on this device for up to 48 hours/i)).toBeVisible();
  await expect(page.getByText(/installer contact stays off unless/i)).toBeVisible();
  await expect(page.getByText(/privacy notice/i).last()).toBeVisible();
  await expect(page.getByText(/estimate terms/i).last()).toBeVisible();
});
