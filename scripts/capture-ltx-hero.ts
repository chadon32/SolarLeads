import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";

const BASE_URL = "https://solartelligence.com";
const TEST_ADDRESS = "6420 E Nance St, Mesa, AZ 85215";
const OUTPUT_FILE = path.join(
  process.cwd(),
  "marketing-assets",
  "solartelligence-rooftop-hero.png"
);
const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 2800, height: 2100 },
    colorScheme: "dark",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });

  await context.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);

  try {
    await trimOversizedAnalysisRequests(page);
    await openAndSeedAddress(page);
    await waitForAnalysisReady(page);
    await ensureLayerChecked(page, "Panels");
    await ensureLayerChecked(page, "Roof planes");
    await togglePanelsOnceIfNeeded(page);
    await frameRooftopView(page);
    await captureHero(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function trimOversizedAnalysisRequests(page: Page) {
  await page.route("**/api/analyze-roof", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    try {
      const payload = request.postDataJSON() as {
        address?: string;
        lat?: number;
        lng?: number;
      };
      const headers = { ...request.headers() };
      delete headers["content-length"];

      await route.continue({
        headers,
        postData: JSON.stringify({
          address: payload.address,
          lat: payload.lat,
          lng: payload.lng,
        }),
      });
    } catch {
      await route.continue();
    }
  });
}

async function openAndSeedAddress(page: Page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await preparePage(page);
  await settle(page, 1200);

  const input = page.getByPlaceholder(/enter your arizona address/i).first();
  await input.waitFor({ state: "visible" });
  await input.fill(TEST_ADDRESS);
  await settle(page, 1200);

  const suggestion = page
    .locator('[role="option"], .pac-item, [data-address-option]')
    .filter({ hasText: TEST_ADDRESS.split(",")[0] })
    .first();

  if (await suggestion.count()) {
    await suggestion.click({ force: true });
  } else {
    await input.press("Enter").catch(() => undefined);
  }

  await page
    .waitForURL(/\/estimate(\?|$)/, { timeout: 15_000 })
    .catch(async () => {
      await page.goto(
        `${BASE_URL}/estimate?address=${encodeURIComponent(TEST_ADDRESS)}`,
        { waitUntil: "domcontentloaded" }
      );
      await preparePage(page);
    });
}

async function preparePage(page: Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay],
      [data-nextjs-dialog],
      [data-radix-popper-content-wrapper],
      .print-static-ui,
      iframe[title*="cookie"],
      iframe[src*="consent"],
      .grecaptcha-badge {
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

async function waitForAnalysisReady(page: Page) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      const hasReadyCopy =
        text.includes("Preliminary roof model ready") ||
        text.includes("panel sample layout") ||
        text.includes("accepted panels") ||
        text.includes("Estimated capacity");
      const noProcessing = !text.includes("Analyzing roof with Google Solar data");
      return hasReadyCopy && noProcessing;
    },
    undefined,
    { timeout: 90_000 }
  );

  await page.locator("#rooftop-analysis").first().waitFor({ state: "visible" });
  await page.locator("#rooftop-analysis .gm-style").first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await settle(page, 3500);
}

async function ensureLayerChecked(page: Page, labelText: string) {
  const label = page.locator("label").filter({ hasText: labelText }).first();
  const checkbox = label.locator('input[type="checkbox"]').first();

  if (!(await checkbox.count())) {
    return;
  }

  if (!(await checkbox.isChecked())) {
    await checkbox.check({ force: true });
    await settle(page, 1800);
  }
}

async function togglePanelsOnceIfNeeded(page: Page) {
  const mapText = await page
    .locator("#rooftop-analysis .gm-style")
    .first()
    .evaluate((node) => node.textContent || "")
    .catch(() => "");

  if (/panel/i.test(mapText)) {
    return;
  }

  const label = page.locator("label").filter({ hasText: "Panels" }).first();
  const checkbox = label.locator('input[type="checkbox"]').first();
  if (!(await checkbox.count())) {
    return;
  }

  await checkbox.uncheck({ force: true }).catch(() => undefined);
  await settle(page, 800);
  await checkbox.check({ force: true }).catch(() => undefined);
  await settle(page, 2000);
}

async function frameRooftopView(page: Page) {
  const analysis = page.locator("#rooftop-analysis").first();
  await analysis.scrollIntoViewIfNeeded();
  await settle(page, 1200);

  for (let i = 0; i < 3; i += 1) {
    const zoomIn = page.locator('[aria-label="Zoom in"], button[title="Zoom in"]').first();
    if (await zoomIn.count()) {
      await zoomIn.click({ force: true }).catch(() => undefined);
      await settle(page, 900);
    }
  }

  await page.evaluate(() => {
    document.documentElement.style.zoom = "2.65";
  });
  await settle(page, 1200);

  await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>("#rooftop-analysis");
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const top = window.scrollY + rect.top - 60;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" as ScrollBehavior });
  });
  await settle(page, 2500);
}

async function captureHero(page: Page) {
  const map = page.locator("#rooftop-analysis .gm-style").first();
  const mapBox = await map.boundingBox();

  if (!mapBox) {
    throw new Error("Rooftop map bounding box was unavailable.");
  }

  const clip = await computeHeroClip(page, map, mapBox);
  await page.screenshot({
    path: OUTPUT_FILE,
    clip,
    animations: "disabled",
  });

  const { width, height } = await readImageSize(OUTPUT_FILE);
  if (width !== TARGET_WIDTH || height !== TARGET_HEIGHT) {
    throw new Error(`Unexpected screenshot size ${width}x${height}.`);
  }
}

async function computeHeroClip(
  page: Page,
  map: Locator,
  mapBox: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>
) {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Viewport size unavailable.");
  }

  const docSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  const centerX = mapBox.x + mapBox.width / 2;
  let clipX = Math.round(centerX - TARGET_WIDTH / 2) - 110;
  let clipY = Math.round(mapBox.y - 40);

  clipX = clamp(clipX, 0, Math.max(0, docSize.width - TARGET_WIDTH));
  clipY = clamp(clipY, 0, Math.max(0, docSize.height - TARGET_HEIGHT));

  if (clipX + TARGET_WIDTH > viewport.width || clipY + TARGET_HEIGHT > viewport.height) {
    await page.setViewportSize({
      width: Math.max(viewport.width, clipX + TARGET_WIDTH + 40),
      height: Math.max(viewport.height, clipY + TARGET_HEIGHT + 40),
    });
    await settle(page, 1000);
  }

  return {
    x: clipX,
    y: clipY,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
  };
}

async function readImageSize(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function settle(page: Page, timeout = 1200) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
  await page.waitForTimeout(timeout);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
