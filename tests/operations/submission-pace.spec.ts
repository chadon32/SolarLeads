import { readFile } from "node:fs/promises";
import { test, expect } from "playwright/test";

test("an operator compares full submission periods and downloads matching aggregate counts", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await page.locator('input[type="password"]').fill("dashboard-workspace-local-qa");
  await page.getByRole("button", { name: "Start secure session" }).click();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  const region = page.getByRole("region", { name: "Submission pace" });
  const period = page.getByLabel("Submission period");
  const total = region.getByRole("row", { name: /^Lead submissions / });
  await expect(region).toContainText("Last 30 completed Phoenix days");
  expect(Number(await total.getByRole("cell").nth(0).innerText())).toBeGreaterThan(0);
  await expect(total.getByRole("cell").nth(1)).toHaveText("0");
  await period.selectOption("7");
  const cells = total.getByRole("cell");
  const excluded = Number(await cells.first().innerText());
  await page.getByRole("checkbox", { name: "Include test leads" }).check();
  await expect(region).toContainText("Test leads included.");
  const recent = Number(await cells.first().innerText());
  const previous = Number(await cells.nth(1).innerText());
  expect(recent).toBeGreaterThan(excluded);
  expect(previous).toBeGreaterThan(0);
  expect(Number(await cells.nth(2).innerText())).toBe(recent - previous);
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await testInfo.attach("submission-pace", { body: await region.screenshot(), contentType: "image/png" });
  const nextFile = page.waitForEvent("download");
  await region.getByRole("link", { name: "Download comparison CSV" }).click();
  const file = await nextFile;
  expect(file.suggestedFilename()).toMatch(/^solartelligence-submission-pace-7d-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await file.path())!, "utf8");
  const rows = csv.trim().split("\r\n").slice(1);
  expect(rows).toHaveLength(4);
  for (const line of rows) {
    const [label, , , current, , , prior, change, included] = line.split(",");
    const row = region.getByRole("rowheader", { name: label, exact: true }).locator("..");
    expect((await row.getByRole("cell").allTextContents()).map(Number)).toEqual([current, prior, change].map(Number));
    expect(included).toBe("true");
  }
  expect(csv).not.toMatch(/QA Homeowner|@example|Test Way/i);
  await period.selectOption("all");
  await expect(region).toContainText("Choose 7, 30, or 90 days");
  await expect(region.getByRole("table")).toHaveCount(0);
  await expect(region.getByRole("link")).toHaveCount(0);
  await period.selectOption("90");
  await expect(region).toContainText("Last 90 completed Phoenix days");
  await expect(region.getByRole("table")).toBeVisible();
});
