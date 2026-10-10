import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Read-only audit: no address lookup, report submission, or paid API request.
async function main() {
  const base = process.env.SEO_BASE_URL ?? "http://localhost:3101";
  const phase = process.env.SEO_PHASE ?? "current";
  const output = `qa-evidence/seo-${phase}`;
  const browser = await chromium.launch();
  try {
    await mkdir(output, { recursive: true });
    const context = await browser.newContext({ javaScriptEnabled: false });
    const parser = await context.newPage();
    await parser.evaluate("globalThis.__name = (fn) => fn");
    const inventory = [];
    for (const path of ["/", "/privacy", "/terms", "/solar-guide", "/estimate", "/dashboard", "/dashboard/installer", "/thank-you", "/report/seo-audit-invalid", "/seo-audit-missing", "/robots.txt", "/sitemap.xml"]) {
      const response = await context.request.get(`${base}${path}`);
      const html = await response.text();
      const document = await parser.evaluate((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const meta = (selector: string) => doc.querySelector(selector)?.getAttribute("content") ?? null;
        return {
          titles: Array.from(doc.querySelectorAll("title"), (el) => el.textContent),
          description: meta('meta[name="description"]'),
          canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
          robots: Array.from(doc.querySelectorAll('meta[name="robots"]'), (el) => el.getAttribute("content")),
          ogTitle: meta('meta[property="og:title"]'),
          ogUrl: meta('meta[property="og:url"]'),
          ogImage: meta('meta[property="og:image"]'),
          h1: Array.from(doc.querySelectorAll("h1"), (el) => el.textContent),
          headings: Array.from(doc.querySelectorAll("h2"), (el) => el.textContent),
          links: Array.from(doc.querySelectorAll("a[href]"), (el) => el.getAttribute("href")),
          schemas: Array.from(doc.querySelectorAll('script[type="application/ld+json"]'), (el) => JSON.parse(el.textContent ?? "{}")),
          analyticsLoaded: html.includes("googletagmanager.com/gtag/js"),
        };
      }, html);
      inventory.push({
        path, status: response.status(), xRobots: response.headers()["x-robots-tag"] ?? null, ...document,
        ...(/\.(txt|xml)$/.test(path) ? { text: html } : {}),
      });
    }
    await context.close();
    await writeFile(`${output}/inventory.json`, JSON.stringify({ base, date: new Date().toISOString(), inventory }, null, 2));
    console.log(JSON.stringify(inventory.map(({ path, status, titles, canonical, robots, xRobots, schemas }) => ({ path, status, titles, canonical, robots, xRobots, schemas: schemas.length }))));

    if (process.env.SEO_INVENTORY_ONLY !== "1") {
      const samples = [];
      for (const path of (process.env.SEO_ROUTES ?? "/,/privacy").split(",")) {
        for (const width of [393, 1440]) {
          for (let run = 1; run <= 3; run++) {
            const ctx = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, isMobile: width === 393, hasTouch: width === 393, serviceWorkers: "block" });
            const page = await ctx.newPage();
            await page.addInitScript("globalThis.__name = (fn) => fn");
            // Keep third-party variability out of this local cold-browser lab test.
            await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            const cdp = await ctx.newCDPSession(page);
            await cdp.send("Network.enable");
            await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
            await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: 200_000, uploadThroughput: 93_750 });
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
            let encodedBytes = 0;
            let videoRequests = 0;
            cdp.on("Network.dataReceived", (event) => { encodedBytes += event.encodedDataLength; });
            page.on("request", (request) => { if (request.url().includes(".mp4")) videoRequests++; });
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.addInitScript(() => {
              const metric = { lcp: 0, cls: 0, sessionValue: 0, sessionStart: 0, lastShift: 0 };
              Object.assign(window, { seoMetrics: metric });
              new PerformanceObserver((list) => { for (const entry of list.getEntries()) metric.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
              new PerformanceObserver((list) => {
                for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number })[]) {
                  if (entry.hadRecentInput) continue;
                  if (entry.startTime - metric.lastShift > 1000 || entry.startTime - metric.sessionStart > 5000) { metric.sessionStart = entry.startTime; metric.sessionValue = 0; }
                  metric.sessionValue += entry.value;
                  metric.lastShift = entry.startTime;
                  metric.cls = Math.max(metric.cls, metric.sessionValue);
                }
              }).observe({ type: "layout-shift", buffered: true });
            });
            await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(8000);
            const metric = await page.evaluate(() => {
              const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
              const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
              const data = (window as unknown as { seoMetrics: { lcp: number; cls: number } }).seoMetrics;
              return { lcpMs: Math.round(data.lcp), cls: Number(data.cls.toFixed(4)), ttfbMs: Math.round(nav.responseStart - nav.requestStart), fcpMs: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0), jsEncodedBytes: resources.filter((r) => r.name.includes("/_next/") && r.name.endsWith(".js")).reduce((n, r) => n + r.encodedBodySize, 0), overflow: document.documentElement.scrollWidth > innerWidth };
            });
            const sample = { path, width, run, ...metric, encodedBytes, videoRequests, errors };
            samples.push(sample);
            console.log(JSON.stringify(sample));
            if (run === 1) await page.screenshot({ path: `${output}/${path === "/" ? "home" : path.slice(1)}-${width}.png`, fullPage: true });
            await ctx.close();
          }
        }
      }
      await writeFile(`${output}/performance.json`, JSON.stringify({ base, date: new Date().toISOString(), browser: browser.version(), conditions: "Cold browser contexts; warm local production server; Chromium; 4x CPU; 80ms latency; 1.6Mbps download; 750Kbps upload; external requests blocked; 8s observation after DOMContentLoaded; encoded response body bytes exclude headers", samples }, null, 2));
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
