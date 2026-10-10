/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { chromium } = require("playwright");

const ADDRESS = "1084 W Fever Tree Avenue, Queen Creek, AZ 85140";
const OUT_DIR = path.join(
  process.cwd(),
  "marketing-ad",
  "landscape",
  "assets"
);

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);

    const url = `http://localhost:3000/estimate?address=${encodeURIComponent(ADDRESS)}`;
    console.log("goto", url);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("#rooftop-analysis").waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(8000);

    // Open 3D Model tab
    const tab = page.locator('[role="tab"]').filter({ hasText: /3D Model/i }).first();
    await tab.click({ force: true });
    await page.waitForTimeout(2000);

    // Panels ON, Sunlight OFF — clean geometric 3D
    await setLayer(page, "Panels", true);
    await setLayer(page, "Sunlight quality", false);
    await setLayer(page, "Sunlight", false);

    await page.locator("#rooftop-analysis canvas").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.waitForTimeout(3500);

    // Full rooftop analysis section
    await page.locator("#rooftop-analysis").screenshot({
      path: path.join(OUT_DIR, "roof-3d-model.png"),
      type: "png",
    });
    console.log("saved roof-3d-model.png");

    // Tight canvas crop only
    const canvas = page.locator("#rooftop-analysis canvas").first();
    const box = await canvas.boundingBox();
    if (box) {
      // Expand slightly around canvas for UI chrome of 3D viewport
      const pad = 24;
      await page.screenshot({
        path: path.join(OUT_DIR, "roof-3d-close.png"),
        type: "png",
        clip: {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - 60),
          width: Math.min(1920 - box.x + pad, box.width + pad * 2),
          height: Math.min(900, box.height + 80),
        },
      });
      console.log("saved roof-3d-close.png", box);
    }

    // Also capture full viewport for safety
    await page.screenshot({
      path: path.join(OUT_DIR, "fever-tree", "fever-tree-3d-clean.png"),
      type: "png",
    });
    console.log("saved fever-tree-3d-clean.png");
  } finally {
    await browser.close();
  }
}

async function setLayer(page, labelText, wantChecked) {
  const label = page.locator("label").filter({ hasText: new RegExp(labelText, "i") }).first();
  if (!(await label.count())) {
    console.log("layer missing", labelText);
    return;
  }
  const checkbox = label.locator('input[type="checkbox"]').first();
  if (!(await checkbox.count())) return;
  const checked = await checkbox.isChecked();
  if (checked !== wantChecked) {
    await checkbox.setChecked(wantChecked, { force: true });
    await page.waitForTimeout(800);
  }
  console.log("layer", labelText, "=>", wantChecked);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
