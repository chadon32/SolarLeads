import { expect, test, type Page } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";
import { TEST_ADDRESS } from "../fixtures/test-data";

test.beforeEach(async ({ page }) => { await installSafeApiMocks(page); });

async function openCalculator(page: Page) {
  await page.getByRole("button", { name: "Calculate my monthly average" }).click();
  return page.getByRole("region", { name: "Bill history calculator" });
}

test("an annual total changes the starting bill only on Apply", async ({ page }) => {
  await new HomeEstimatePage(page).open();
  const bill = page.locator("#monthly-bill-input");
  const before = await bill.inputValue();
  const editor = await openCalculator(page);
  const input = editor.getByLabel("12-month electricity total ($)", { exact: true });
  await input.fill("$3,036.55");
  await expect(editor.getByRole("status")).toContainText("$253 per month");
  await expect(bill).toHaveValue(before);
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(bill).toHaveValue(before);
  await openCalculator(page);
  await expect(input).toHaveValue("");
  await input.fill("$3,036.55");
  await editor.getByRole("button", { name: "Use this average" }).click();
  await expect(bill).toHaveValue("253");
  await expect(page.getByRole("button", { name: "Calculate my monthly average" })).toBeFocused();
  await new HomeEstimatePage(page).selectTestAddress();
  await expect(page.locator("#estimate-monthly-bill")).toHaveValue("253");
});

test("partial-year charges update the Savings estimate but individual amounts are not shared", async ({ page }, testInfo) => {
  const sent: string[] = [];
  page.on("request", req => sent.push(req.url() + (req.postData() ?? "")));
  await new HomeEstimatePage(page).openReadyEstimate();
  await page.getByRole("tab", { name: "Savings", exact: true }).click();
  const editor = await openCalculator(page);
  const apply = editor.getByRole("button", { name: "Use this average" });
  await editor.getByLabel("Individual bills").check();
  await editor.getByLabel("January ($)", { exact: true }).fill("321.91");
  await expect(apply).toBeDisabled();
  const feb = editor.getByLabel("February ($)", { exact: true });
  await feb.fill("-5");
  await expect(feb).toHaveAttribute("aria-invalid", "true");
  await expect(apply).toBeDisabled();
  await feb.fill("0");
  await expect(editor.getByRole("status")).toContainText("$161 per month, rounded from 2 months. Partial year");
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await testInfo.attach("bill-history-calculator", { body: await editor.screenshot(), contentType: "image/png" });
  await apply.click();
  await expect(page.locator("#estimate-monthly-bill")).toHaveValue("161");
  await expect(page.getByText(/Based on a \$161 average bill/)).toBeVisible();
  await page.getByRole("tab", { name: "Send Report", exact: true }).click();
  await expect(page.getByLabel("Average monthly electric bill")).toHaveValue(/^\$100.\$199$/);
  const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
  expect(stored).not.toContain("321.91");
  expect(page.url()).not.toContain("321.91");
  expect(sent.some(payload => payload.includes("321.91"))).toBe(false);
});

test("an embedded iOS estimate applies the average to its own bill picker", async ({ page }) => {
  await page.goto(`/estimate?app=ios&address=${encodeURIComponent(TEST_ADDRESS)}`);
  await page.getByRole("tab", { name: "Savings", exact: true }).click();
  const editor = await openCalculator(page);
  await editor.getByLabel("12-month electricity total ($)", { exact: true }).fill("3648");
  await editor.getByRole("button", { name: "Use this average" }).click();
  await expect(page.locator("#savings-monthly-bill")).toHaveValue("304");
});
