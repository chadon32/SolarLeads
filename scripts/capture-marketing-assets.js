/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const LOCAL_URLS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const FALLBACK_BASE_URL = process.env.BASE_URL;
const TEST_ADDRESS = "6420 E Nance St, Mesa, AZ 85215";
const ASSET_DIR = path.join(process.cwd(), "marketing-assets");

const captures = {
  homepageDesktop: "01-homepage-address-input-desktop.png",
  rooftopDesktop: "02-rooftop-analysis-panels-desktop.png",
  rooftopCrop: "03-rooftop-analysis-close-crop.png",
  reportDashboard: "04-report-dashboard-desktop.png",
  reportSummary: "05-pdf-report-summary-desktop.png",
  homepageMobile: "06-homepage-mobile-vertical.png",
  rooftopMobile: "07-rooftop-analysis-mobile-vertical.png",
};

async function main() {
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const baseUrl = await resolveBaseUrl();
  console.log(`Using base URL: ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const desktop = await newCleanPage(browser, { width: 1920, height: 1080 });
    await captureHomepage(desktop, baseUrl, captures.homepageDesktop);
    await captureRooftopSet(desktop, baseUrl);
    await desktop.close();

    const mobileHome = await newCleanPage(browser, {
      width: 1080,
      height: 1920,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    await captureHomepage(mobileHome, baseUrl, captures.homepageMobile);
    await mobileHome.close();

    const mobileRoof = await newCleanPage(browser, {
      width: 1080,
      height: 1920,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    await captureMobileRooftop(mobileRoof, baseUrl);
    await mobileRoof.close();
  } finally {
    await browser.close();
  }

  console.log(`Marketing assets saved to ${ASSET_DIR}`);
}

async function resolveBaseUrl() {
  for (const candidate of LOCAL_URLS) {
    if (await canReach(candidate)) {
      return candidate;
    }
  }

  if (FALLBACK_BASE_URL && (await canReach(FALLBACK_BASE_URL))) {
    return FALLBACK_BASE_URL.replace(/\/$/, "");
  }

  throw new Error(
    "No reachable site found. Start local dev on http://localhost:3000 or set BASE_URL."
  );
}

async function canReach(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function newCleanPage(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });

  await context.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(45_000);
  await trimOversizedAnalysisRequests(page);
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    }
  });

  return page;
}

async function trimOversizedAnalysisRequests(page) {
  await page.route("**/api/analyze-roof", async (route) => {
    const request = route.request();

    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    try {
      const payload = request.postDataJSON();
      const trimmedPayload = {
        address: payload.address,
        lat: payload.lat,
        lng: payload.lng,
      };
      const headers = { ...request.headers() };
      delete headers["content-length"];

      await route.continue({
        headers,
        postData: JSON.stringify(trimmedPayload),
      });
    } catch {
      await route.continue();
    }
  });
}

async function preparePage(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay],
      [data-nextjs-dialog],
      .print-static-ui {
        display: none !important;
      }
      html {
        scroll-behavior: auto !important;
      }
      * {
        animation-duration: 0.001ms !important;
        transition-duration: 0.001ms !important;
      }
    `,
  });
}

async function gotoClean(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await preparePage(page);
  await settle(page);
}

async function captureHomepage(page, baseUrl, fileName) {
  await gotoClean(page, `${baseUrl}/`);
  await page.locator("body").waitFor({ state: "visible" });
  await page.getByPlaceholder(/enter your arizona address/i).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await screenshotPage(page, fileName);
}

async function captureRooftopSet(page, baseUrl) {
  await openAnalysis(page, baseUrl);

  await screenshotLocator(
    page,
    page.locator("#rooftop-analysis").first(),
    captures.rooftopDesktop
  );

  await screenshotMapCrop(page, captures.rooftopCrop);

  const reportDashboard = page.locator("#report-dashboard").first();
  if (await reportDashboard.count()) {
    await reportDashboard.scrollIntoViewIfNeeded();
    await settle(page);
    await screenshotLocator(page, reportDashboard, captures.reportDashboard);
  } else {
    console.log("Report dashboard was unavailable; capturing the current page.");
    await screenshotPage(page, captures.reportDashboard);
  }

  await ensureReportOverview(page);
  if (await reportDashboard.count()) {
    await screenshotLocator(page, reportDashboard, captures.reportSummary);
  } else {
    await screenshotPage(page, captures.reportSummary);
  }
}

async function captureMobileRooftop(page, baseUrl) {
  await openAnalysis(page, baseUrl);
  await screenshotLocator(
    page,
    page.locator("#rooftop-analysis").first(),
    captures.rooftopMobile
  );
}

async function openAnalysis(page, baseUrl) {
  const estimateUrl = `${baseUrl}/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`;
  await gotoClean(page, estimateUrl);
  await page.locator("#rooftop-analysis").waitFor({ state: "attached" });

  try {
    await waitForAnalysisReady(page);
    await ensureLayerChecked(page, "Panels");
    await ensureLayerChecked(page, "Roof planes");
  } catch (error) {
    console.log(`Rooftop analysis wait warning: ${error.message}`);
  }

  await page.locator("#rooftop-analysis").scrollIntoViewIfNeeded();
  await settle(page, 3500);
}

async function waitForAnalysisReady(page) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      const hasReadyCopy =
        text.includes("Preliminary roof model ready") ||
        text.includes("panel sample layout") ||
        text.includes("Estimated capacity");
      const noProcessing = !text.includes("Analyzing roof with Google Solar data");
      return hasReadyCopy && noProcessing;
    },
    undefined,
    { timeout: 90_000 }
  );

  await page.locator(".gm-style").first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function ensureLayerChecked(page, labelText) {
  const label = page.locator("label").filter({ hasText: labelText }).first();
  const checkbox = label.locator('input[type="checkbox"]').first();

  if ((await checkbox.count()) && !(await checkbox.isChecked())) {
    await checkbox.check({ force: true });
    await settle(page, 1500);
  }
}

async function ensureReportOverview(page) {
  const overview = page.getByRole("tab", { name: /^overview$/i }).first();
  if (await overview.count()) {
    await overview.click();
    await settle(page);
  }
}

async function screenshotMapCrop(page, fileName) {
  const map = page.locator("#rooftop-analysis .gm-style").first();

  try {
    await map.waitFor({ state: "visible", timeout: 10_000 });
    const box = await map.boundingBox();
    if (!box) {
      throw new Error("Map bounding box unavailable.");
    }

    await page.screenshot({
      path: assetPath(fileName),
      animations: "disabled",
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: box.height,
      },
    });
    console.log(`Captured ${fileName}`);
  } catch (error) {
    console.log(`Map crop failed, capturing rooftop section instead: ${error.message}`);
    await screenshotLocator(page, page.locator("#rooftop-analysis").first(), fileName);
  }
}

async function screenshotLocator(page, locator, fileName) {
  await locator.scrollIntoViewIfNeeded();
  await settle(page);

  try {
    await locator.screenshot({
      path: assetPath(fileName),
      animations: "disabled",
    });
  } catch (error) {
    console.log(`Element screenshot failed for ${fileName}: ${error.message}`);
    await screenshotPage(page, fileName);
    return;
  }

  console.log(`Captured ${fileName}`);
}

async function screenshotPage(page, fileName) {
  await settle(page);
  await page.screenshot({
    path: assetPath(fileName),
    animations: "disabled",
    fullPage: false,
  });
  console.log(`Captured ${fileName}`);
}

async function settle(page, timeout = 1200) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(timeout);
}

function assetPath(fileName) {
  return path.join(ASSET_DIR, fileName);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
