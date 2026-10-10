import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against a local production build with --env-file=.env.local.
// Credentials and lead contents are never printed or saved.
const baseURL = "http://localhost:3101";
const token = process.env.DASHBOARD_ACCESS_TOKEN;
assert.ok(token, "A configured local dashboard token is required");
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const login = await context.request.post(`${baseURL}/api/dashboard/session`, {
    headers: { accept: "application/json", origin: baseURL },
    data: { token },
  });
  assert.equal(login.status(), 200, "Local dashboard session failed");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", () => errors.push("Browser runtime error"));
  await page.route("**/api/**", (route) => {
    if (route.request().method() !== "GET") return route.abort();
    return route.continue();
  });
  await page.goto(`${baseURL}/dashboard`);
  await page.getByRole("heading", { name: "Solar lead pipeline" }).waitFor();
  const search = page.getByPlaceholder("Search name, email, or address");
  await search.fill("synthetic-no-match-audit-941380");
  await page.getByRole("heading", { name: "No leads match this view" }).waitFor();
  await page.getByRole("heading", { name: "Select a lead", exact: true }).waitFor();
  assert.equal(await page.getByText("Lead detail", { exact: true }).count(), 0);
  await search.fill("");
  assert.equal(errors.length, 0, "Dashboard generated runtime errors");
  console.log("PASS: authenticated local dashboard renders; empty search clears stale detail; no runtime errors.");
  await context.close();
} finally {
  await browser.close();
}
