/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const ADDRESS = "1084 W Fever Tree Avenue, Queen Creek, AZ 85140";
const LOCAL_URLS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const FALLBACK = process.env.BASE_URL || "https://solartelligence.com";
const OUT_DIR = path.join(
  process.cwd(),
  "marketing-ad",
  "landscape",
  "assets",
  "fever-tree"
);

const files = {
  overview: "fever-tree-overview.png",
  panelsClose: "fever-tree-panels-close.png",
  sunlight: "fever-tree-sunlight.png",
  model3d: "fever-tree-3d-model.png",
  report: "fever-tree-report.png",
};

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const baseUrl = await resolveBaseUrl();
  console.log(`base=${baseUrl}`);
  console.log(`address=${ADDRESS}`);
  console.log(`out=${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newPage(browser, { width: 1920, height: 1080 });
    await openAnalysis(page, baseUrl);

    // Overview + panels
    await setView(page, "Overview");
    await ensureLayer(page, "Panels", true);
    await ensureLayer(page, "Roof planes", true);
    await ensureLayer(page, "Sunlight", false);
    await settle(page, 2500);
    await shotSection(page, files.overview);
    await shotMap(page, files.panelsClose);

    // Sunlight / irradiance
    await setView(page, "Sunlight");
    // Some UIs use "Sunlight hours" / "Irradiance" tab label
    if (!(await isViewActive(page, "Sunlight"))) {
      await setView(page, "Irradiance");
    }
    await ensureLayer(page, "Sunlight", true);
    await settle(page, 3000);
    await shotSection(page, files.sunlight);
    await shotMap(page, "fever-tree-sunlight-map.png");

    // 3D model
    await setView(page, "3D Model");
    await ensureLayer(page, "Panels", true);
    await ensureLayer(page, "Sunlight", true);
    await settle(page, 4500);
    // Wait for canvas
    await page
      .locator("#rooftop-analysis canvas")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});
    await settle(page, 2500);
    await shotSection(page, files.model3d);
    await shotMap(page, "fever-tree-3d-close.png");

    // Report dashboard if present
    const report = page.locator("#report-dashboard").first();
    if (await report.count()) {
      await report.scrollIntoViewIfNeeded();
      await settle(page, 1500);
      await report.screenshot({
        path: path.join(OUT_DIR, files.report),
        type: "png",
      });
      console.log(`saved ${files.report}`);
    }

    // Full-page safety shot
    await page.screenshot({
      path: path.join(OUT_DIR, "fever-tree-fullpage.png"),
      fullPage: false,
      type: "png",
    });
    console.log("saved fever-tree-fullpage.png");
  } finally {
    await browser.close();
  }

  const listing = await fs.readdir(OUT_DIR);
  console.log("files:", listing.join(", "));
}

async function resolveBaseUrl() {
  for (const u of LOCAL_URLS) {
    if (await canReach(u)) return u;
  }
  if (FALLBACK && (await canReach(FALLBACK))) return FALLBACK.replace(/\/$/, "");
  throw new Error("No reachable site");
}

async function canReach(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 3000);
  try {
    const r = await fetch(url, { signal: c.signal });
    return r.ok || r.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function newPage(browser, viewport) {
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
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) {
      console.log(`[browser:${m.type()}] ${m.text()}`);
    }
  });
  return page;
}

async function prepare(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay],
      [data-nextjs-dialog], .print-static-ui { display: none !important; }
      html { scroll-behavior: auto !important; }
    `,
  });
}

async function openAnalysis(page, baseUrl) {
  const url = `${baseUrl}/estimate?address=${encodeURIComponent(ADDRESS)}`;
  console.log(`goto ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await prepare(page);
  await page.locator("#rooftop-analysis").waitFor({ state: "attached", timeout: 60_000 });

  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        const ready =
          text.includes("Preliminary roof model ready") ||
          text.includes("panel sample layout") ||
          text.includes("Estimated capacity") ||
          text.includes("accepted panels") ||
          text.includes("Roof model");
        const busy = text.includes("Analyzing roof with Google Solar data");
        return ready && !busy;
      },
      undefined,
      { timeout: 120_000 }
    );
  } catch (e) {
    console.log(`wait warning: ${e.message}`);
  }

  await page.locator("#rooftop-analysis").scrollIntoViewIfNeeded();
  await settle(page, 3000);
}

async function setView(page, label) {
  const tab = page
    .locator('[role="tab"]')
    .filter({ hasText: new RegExp(label, "i") })
    .first();
  if (await tab.count()) {
    await tab.click({ force: true });
    await settle(page, 1200);
    console.log(`view → ${label}`);
    return true;
  }
  // Button fallback
  const btn = page.getByRole("button", { name: new RegExp(label, "i") }).first();
  if (await btn.count()) {
    await btn.click({ force: true });
    await settle(page, 1200);
    console.log(`view button → ${label}`);
    return true;
  }
  console.log(`view not found: ${label}`);
  return false;
}

async function isViewActive(page, label) {
  const tab = page
    .locator('[role="tab"][aria-selected="true"]')
    .filter({ hasText: new RegExp(label, "i") });
  return (await tab.count()) > 0;
}

async function ensureLayer(page, labelText, wantChecked) {
  const label = page.locator("label").filter({ hasText: labelText }).first();
  if (!(await label.count())) {
    console.log(`layer missing: ${labelText}`);
    return;
  }
  const checkbox = label.locator('input[type="checkbox"]').first();
  if (!(await checkbox.count())) return;
  const checked = await checkbox.isChecked();
  if (checked !== wantChecked) {
    await checkbox.setChecked(wantChecked, { force: true });
    await settle(page, 1000);
  }
}

async function shotSection(page, fileName) {
  const el = page.locator("#rooftop-analysis").first();
  await el.scrollIntoViewIfNeeded();
  await settle(page, 800);
  await el.screenshot({ path: path.join(OUT_DIR, fileName), type: "png" });
  console.log(`saved ${fileName}`);
}

async function shotMap(page, fileName) {
  const map = page.locator("#rooftop-analysis .gm-style, #rooftop-analysis canvas").first();
  try {
    await map.waitFor({ state: "visible", timeout: 15_000 });
    const box = await map.boundingBox();
    if (!box) throw new Error("no box");
    await page.screenshot({
      path: path.join(OUT_DIR, fileName),
      type: "png",
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width, 1920),
        height: Math.min(box.height, 900),
      },
    });
    console.log(`saved ${fileName}`);
  } catch (e) {
    console.log(`map shot skip ${fileName}: ${e.message}`);
  }
}

async function settle(page, ms = 800) {
  await page.waitForTimeout(ms);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
