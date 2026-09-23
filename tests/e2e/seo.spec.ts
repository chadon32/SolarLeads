import { expect, test } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { getSeriousAccessibilityViolations } from "../helpers/accessibility";
import { installSafeApiMocks } from "../helpers/network";

const publicPaths = ["/", "/solar-guide", "/privacy", "/terms"];

test("public metadata and useful content are present without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const titles = [];
  for (const path of publicPaths) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).toString()).toBe(`https://solartelligence.com${path}`);
    const directives = await page.locator('meta[name="robots"]').evaluateAll((elements) => elements.map((el) => el.getAttribute("content")).join(","));
    expect(directives).not.toContain("noindex");
    const title = await page.title();
    titles.push(title);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    expect(new URL(ogUrl!).toString()).toBe(`https://solartelligence.com${path}`);
    const image = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(image).toMatch(/^https:\/\/solartelligence\.com\/opengraph-image/);
    const localImage = new URL(image!).pathname;
    const imageResponse = await context.request.get(localImage);
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()["content-type"]).toContain("image/");
  }
  expect(new Set(titles).size).toBe(publicPaths.length);
  await page.goto("/solar-guide");
  await expect(page.getByRole("heading", { name: "5. Check your actual utility plan" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start my solar estimate" })).toHaveAttribute("href", "/#address-estimate");
  await context.close();
});

test("private pages retain noindex without unrelated canonicals or homepage schema", async ({ page }) => {
  await installSafeApiMocks(page);
  for (const path of ["/estimate", "/dashboard", "/dashboard/installer", "/thank-you", "/report/seo-audit-invalid"]) {
    const response = await page.goto(path);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  }
  await page.goto("/dashboard");
  await expect(page.getByLabel("Dashboard access token")).toBeVisible();
  const missing = await page.goto("/seo-audit-missing");
  expect(missing?.status()).toBe(404);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("sitemap, status codes, parameter canonical and scoped JSON-LD stay consistent", async ({ page, request }) => {
  await installSafeApiMocks(page);
  const sitemap = await request.get("/sitemap.xml");
  const xml = await sitemap.text();
  const urls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), (match) => match[1]);
  expect(urls).toEqual(publicPaths.map((path) => `https://solartelligence.com${path}`));
  expect(xml).not.toContain("<lastmod>");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).not.toMatch(/Disallow: \/(estimate|dashboard|report|thank-you)/);
  expect(robots).toContain("Disallow: /api/");
  const api = await request.get("/api/dashboard/session");
  expect(api.headers()["x-robots-tag"]).toContain("noindex");
  const trailing = await request.get("/privacy/", { maxRedirects: 0 });
  expect(trailing.status()).toBe(308);
  expect(trailing.headers().location).toBe("/privacy");
  await page.goto("/?utm_source=seo-test");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(new URL(canonical!).toString()).toBe("https://solartelligence.com/");
  const graph = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(graph["@graph"].map((node: Record<string, unknown>) => node["@type"])).toEqual(["Organization", "WebSite", "Service"]);
  expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|FAQPage|postalAddress|telephone/);
  await page.goto("/solar-guide");
  const breadcrumbs = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(breadcrumbs["@type"]).toBe("BreadcrumbList");
  expect(breadcrumbs.itemListElement.map((item: { position: number }) => item.position)).toEqual([1, 2]);
  await expect(page.getByRole("navigation", { name: "Breadcrumb", exact: true })).toContainText("Arizona solar guide");
});

test("public internal links and anchors resolve", async ({ page, request }) => {
  await installSafeApiMocks(page);
  for (const path of publicPaths) {
    await page.goto(path);
    const links = await page.locator("a[href]").evaluateAll((elements) => elements.map((el) => el.getAttribute("href")!).filter((href) => href.startsWith("/") || href.startsWith("#")));
    for (const href of new Set(links)) {
      const target = new URL(href, page.url());
      const response = await request.get(target.pathname);
      expect(response.status(), `${path} -> ${href}`).toBe(200);
      if (target.hash) {
        const body = await response.text();
        expect(body, `${path} -> ${href}`).toContain(`id="${target.hash.slice(1)}"`);
      }
    }
  }
});

for (const width of [393, 1440]) {
  test(`guide, navigation and keyboard journey at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 900 });
    await installSafeApiMocks(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    if (width === 393) await page.getByLabel("Open site navigation").click();
    await page.getByRole("link", { name: "Solar guide", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/solar-guide$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await getSeriousAccessibilityViolations(page)).toEqual([]);
    await mkdir("qa-evidence/seo-after", { recursive: true });
    await page.screenshot({ path: `qa-evidence/seo-after/guide-${width}.png`, fullPage: true });
    const cta = page.getByRole("link", { name: "Check my roof with the free calculator" });
    await cta.focus();
    await cta.press("Enter");
    await expect(page.getByRole("combobox", { name: "Enter your Arizona address" })).toBeVisible();
    await page.goBack();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Arizona home");
    expect(errors).toEqual([]);
  });
}

test("mobile decorative video downloads only after opting in", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await installSafeApiMocks(page);
  let requests = 0;
  page.on("request", (request) => { if (request.url().includes(".mp4")) requests++; });
  await page.goto("/");
  await page.waitForTimeout(3000);
  expect(requests).toBe(0);
  await expect(page.locator("video")).toHaveAttribute("poster", "/hero-poster.jpg");
  await page.getByRole("button", { name: "Play background" }).click();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Pause background" })).toBeVisible();
});
