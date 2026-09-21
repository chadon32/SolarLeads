import { expect, type Page } from "playwright/test";
import { TEST_ADDRESS } from "../../fixtures/test-data";

export class HomeEstimatePage {
  constructor(readonly page: Page) {}

  addressInput() {
    return this.page.getByRole("combobox", {
      name: "Enter your Arizona address",
    });
  }

  monthlyBillInput() {
    return this.page
      .getByText("What is your monthly electric bill?")
      .locator("..")
      .getByRole("spinbutton");
  }

  async open() {
    await this.page.goto("/");
    await expect(
      this.page.getByRole("heading", {
        level: 1,
        name: /solar potential/i,
      })
    ).toBeVisible();
    await this.page.waitForTimeout(500);
  }

  async selectTestAddress() {
    await this.addressInput().fill("1234 Test");
    const option = this.page.getByRole("option", {
      name: /1234 Test Solar Way/i,
    });
    await expect(option).toBeVisible();
    await option.click();
    await expect(
      this.page.getByRole("heading", { level: 1, name: /1234 Test Solar Way/i })
    ).toBeVisible({ timeout: 20_000 });
  }

  async openReadyEstimate() {
    await this.page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`);
    await this.page.waitForTimeout(500);
    await expect(this.page.locator("#report-dashboard")).toBeVisible({
      timeout: 20_000,
    });
  }

  async openReportForm() {
    await this.page.getByRole("tab", { name: "Send Report" }).click();
    await expect(this.page.getByLabel("Name")).toBeVisible();
  }
}
