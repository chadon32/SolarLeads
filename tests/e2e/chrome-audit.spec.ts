import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test.use({ channel: "chrome" });
test.skip(process.env.RUN_CHROME_AUDIT !== "true", "Opt-in installed Chrome audit");

for (const width of [1440, 393]) {
  test(`Chrome visual and accessibility audit at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    // This is a synthetic walkthrough, never a real homeowner submission.
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { message: "Unmocked API blocked by audit" } }));
    await installSafeApiMocks(page);
    const home = new HomeEstimatePage(page);
    const phase = process.env.CHROME_AUDIT_PHASE === "after" ? "after" : "before";
    // Keep repeated evidence writes outside Next's watched project during the run.
    const dir = path.join(process.env.CHROME_AUDIT_OUTPUT_ROOT ?? path.join(tmpdir(), "solartelligence-chrome-audit"), phase, String(width));
    await mkdir(dir, { recursive: true });
    const findings: unknown[] = [];
    const regressions: string[] = [];
    const errors: string[] = [];
    const navigation: string[] = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigation.push(frame.url()); });
    page.on("pageerror", (error) => errors.push(error.message));
    const inspect = async (name: string) => {
      await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(dir, `${name}-viewport.png`) });
      const axe = await new AxeBuilder({ page }).analyze();
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      if (axe.violations.length) regressions.push(`${name}: ${axe.violations.map(({ id }) => id).join(", ")}`);
      if (overflow.content > overflow.viewport) regressions.push(`${name}: horizontal page overflow`);
      findings.push({ name, url: page.url(), violations: axe.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(({ html, target, failureSummary }) => ({ html, target, failureSummary })) })),
        overflow });
      await writeFile(path.join(dir, "findings.json"), JSON.stringify({ findings, errors, navigation }, null, 2));
    };
    await home.open();
    await inspect("home");
    await home.monthlyBillInput().fill("-1");
    await home.monthlyBillInput().blur();
    await inspect("invalid-bill");
    await home.monthlyBillInput().fill("250");
    await home.selectTestAddress();
    await expect(page.getByTestId("roof-scene-3d").locator("canvas")).toBeVisible({ timeout: 25_000 });
    await page.getByTestId("roof-scene-3d").scrollIntoViewIfNeeded();
    await inspect("roof-ready");
    await page.getByRole("button", { name: "View roof from above", exact: true }).click();
    await page.getByRole("button", { name: "Reset 3D view", exact: true }).click();
    await page.getByRole("tab", { name: "Sunlight", exact: true }).click();
    await inspect("sunlight");
    await page.getByRole("tab", { name: "3D Model", exact: true }).click();
    for (const name of ["Overview", "Roof & Shade", "Panels", "Savings", "Financing", "Send Report"]) {
      await page.getByRole("tablist", { name: "Solar report detail sections" }).getByRole("tab", { name, exact: true }).click();
      if (name === "Send Report") await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
      await inspect(name.toLowerCase().replaceAll(/[^a-z]+/g, "-"));
    }
    await page.getByRole("button", { name: "Send My Full Report" }).last().click();
    await inspect("report-validation");
    await page.reload();
    await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 25_000 });
    await inspect("refreshed");
    await page.goBack();
    await expect(home.addressInput()).toBeVisible();
    await inspect("browser-back");
    for (const route of ["privacy", "terms", "report/error?reason=expired", "__audit_missing_page__"]) {
      await page.goto(`/${route}`);
      await inspect(route.split("/")[0] === "report" ? "expired-report" : route);
    }
    expect(errors).toEqual([]);
    if (phase === "after") expect(regressions).toEqual([]);
  });
}
