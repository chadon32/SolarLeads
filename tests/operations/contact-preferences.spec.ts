import { readFile } from "node:fs/promises";
import { expect, test } from "playwright/test";

test("overview, filtered pipeline, details and CSV agree on explicit installer requests", async ({ page }) => {
  await page.goto("/dashboard");
  await page.locator('input[type="password"]').fill("dashboard-workspace-local-qa");
  await page.getByRole("button", { name: "Start secure session" }).click();
  const overview = page.getByRole("region", { name: "Homeowner contact preferences" });
  const requested = overview.getByRole("button", { name: /Installer contact requested/ });
  await expect(requested).toContainText("22");
  await expect(overview.getByRole("button", { name: /Preference unavailable/ })).toContainText("11");
  await requested.click();
  await expect(page.getByRole("heading", { name: "Lead pipeline" })).toBeVisible();
  const filter = page.getByRole("combobox", { name: /^Installer contact/i });
  await expect(filter).toHaveValue("requested");
  await expect(page.getByText(/22 matching leads/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export view" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  expect(header).toContain("installer_contact_request,preferred_installer_contact_method");
  expect(rows).toHaveLength(22);
  for (const line of rows) expect(line).toMatch(/,Installer contact requested,(Email|Phone)$/);
  const search = page.getByRole("textbox", { name: "Search leads" });
  const details = page.locator("#crm-selected-lead");
  await search.fill("QA Homeowner 01");
  await expect(details.getByText("Preferred installer contact method", { exact: true }).locator("..")).toContainText("Email");
  await filter.selectOption("report");
  await expect(page.getByText("No leads match this view")).toBeVisible();
  await search.fill("QA Homeowner 02");
  await expect(details.getByText("Report only", { exact: true })).toBeVisible();
  await expect(details.getByText("Preferred installer contact method")).toHaveCount(0);
  await filter.selectOption("unknown");
  await search.fill("QA Homeowner 03");
  await expect(details.getByText("Preference unavailable", { exact: true })).toBeVisible();
  // The synthetic legacy record has a quote flag and a method but no explicit consent.
  await filter.selectOption("requested");
  await expect(page.getByText("No leads match this view")).toBeVisible();
});
