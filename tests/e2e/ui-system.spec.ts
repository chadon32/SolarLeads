import { expect, test, type Page } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { TEST_ADDRESS } from "../fixtures/test-data";

/**
 * Design-system rules from the October 2026 UI overhaul: readable type,
 * sentence-case labels, one primary button style, two typefaces, and an
 * estimate page that shows the roof early and states each number once.
 */
const reportTabs = (page: Page) =>
  page.getByRole("tablist", { name: "Solar report detail sections" }).getByRole("tab");

async function openEstimate(page: Page) {
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&bill=200`);
  await expect(page.locator("#report-dashboard")).toBeVisible({ timeout: 20_000 });
}

/** Visible elements that render their own text, with the computed style the rule cares about. */
async function visibleText(page: Page) {
  return page.evaluate(() => {
    const rows: Array<{ text: string; size: number; transform: string; font: string }> = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const ownText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (ownText.length < 2) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === "hidden" || style.display === "none") continue;
      if (el.closest("[aria-hidden='true'], nextjs-portal, .sr-only")) continue;
      rows.push({
        text: ownText.slice(0, 50),
        size: parseFloat(style.fontSize),
        transform: style.textTransform,
        font: style.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      });
    }
    return rows;
  });
}

async function everyEstimateTab(page: Page, check: (tab: string) => Promise<void>) {
  const count = await reportTabs(page).count();
  for (let index = 0; index < count; index += 1) {
    const tab = reportTabs(page).nth(index);
    await tab.click();
    await check((await tab.textContent())?.trim() ?? `tab ${index}`);
  }
}

test.beforeEach(async ({ page }) => {
  await installSafeApiMocks(page);
});

test("no visible text is smaller than 12px", async ({ page }) => {
  const tooSmall = async (where: string) => {
    const rows = (await visibleText(page)).filter((row) => row.size < 12);
    expect(rows, `${where}: ${rows.map((row) => `${row.size}px "${row.text}"`).join("; ")}`).toEqual([]);
  };
  await page.goto("/");
  await tooSmall("home");
  await openEstimate(page);
  await everyEstimateTab(page, (tab) => tooSmall(`estimate / ${tab}`));
  await page.goto("/thank-you");
  await tooSmall("thank-you");
});

test("labels are written in sentence case, not forced into capitals", async ({ page }) => {
  const shouting = async (where: string) => {
    const rows = (await visibleText(page)).filter((row) => row.transform === "uppercase");
    expect(rows.map((row) => row.text), where).toEqual([]);
  };
  await page.goto("/");
  await shouting("home");
  await openEstimate(page);
  await everyEstimateTab(page, (tab) => shouting(`estimate / ${tab}`));
});

test("the site uses two typefaces: Manrope for text and Instrument Serif for display", async ({ page }) => {
  for (const open of [() => page.goto("/"), () => openEstimate(page)]) {
    await open();
    const fonts = new Set((await visibleText(page)).map((row) => row.font));
    for (const font of fonts) {
      expect(["Manrope", "Instrument Serif"], `unexpected font ${font}`).toContain(font);
    }
  }
});

test("every primary action uses the same sun-gold button", async ({ page }) => {
  const sun = "rgb(242, 181, 68)";
  await page.goto("/");
  const analyze = page.getByRole("link", { name: /^Analyze my roof$/i });
  expect(await analyze.count()).toBeGreaterThan(0);
  for (const cta of await analyze.all()) {
    if (!(await cta.isVisible())) continue;
    expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(sun);
  }
  await openEstimate(page);
  const send = page.getByRole("button", { name: /^Send my full report$/i });
  expect(await send.count()).toBeGreaterThan(0);
  for (const cta of await send.all()) {
    if (!(await cta.isVisible())) continue;
    expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(sun);
  }
});

test("the estimate states each headline number at most twice", async ({ page }) => {
  await openEstimate(page);
  // Each summary metric is a label followed by its value.
  const values = await page
    .getByTestId("report-kpi-grid")
    .evaluate((grid) => Array.from(grid.children).map((metric) => metric.lastElementChild?.textContent ?? ""));
  expect(values.length).toBe(4);
  for (const value of values.map((text) => text.trim())) {
    const shown = await page.evaluate((needle) => {
      return Array.from(document.querySelectorAll("main *")).filter((el) => {
        const own = Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        const rect = el.getBoundingClientRect();
        return own === needle && rect.width > 0 && rect.height > 0;
      }).length;
    }, value);
    expect(shown, `"${value}" appears ${shown} times`).toBeLessThanOrEqual(2);
  }
});

test("on a phone the 3D roof appears on the first screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEstimate(page);
  const roof = page.getByTestId("roof-scene-3d");
  await expect(roof).toBeVisible({ timeout: 20_000 });
  const box = (await roof.boundingBox())!;
  expect(box.y, "roof model starts with at least 200px of it on the first screen").toBeLessThanOrEqual(844 - 200);
});
