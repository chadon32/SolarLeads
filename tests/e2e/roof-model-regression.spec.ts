import { expect, test, type Locator, type Page } from "playwright/test";
import { installSafeApiMocks } from "../helpers/network";
import { installSyntheticRoof } from "../helpers/synthetic-roof-network";
import { TEST_ADDRESS } from "../fixtures/test-data";
import type { SyntheticRoofKind, SyntheticRoofOptions } from "../fixtures/synthetic-roofs";

/**
 * Screenshot regression set for the rebuilt 3D roof. Houses are synthetic
 * (no homeowner data in the repo) but rendered into realistic Solar API
 * rasters: 0.25 m pixels, blended eaves, an eroded rooftop mask and noise.
 */
const HOUSES: Array<{ kind: SyntheticRoofKind; faces: number; options: SyntheticRoofOptions }> = [
  { kind: "gable", faces: 2, options: { rooftopUnit: true, tree: true } },
  { kind: "hip", faces: 4, options: {} },
  { kind: "l-shape", faces: 4, options: {} },
  { kind: "multi-level", faces: 3, options: {} },
];

/** Pairs of visible viewer panels (overlays and the face card) whose boxes intersect. */
async function overlappingOverlays(page: Page) {
  return page.locator('[data-viewer-overlay], [data-testid="roof-scene-3d"] [role="status"]').evaluateAll((elements) => {
    const boxes = elements
      .map((element) => ({ name: element.textContent?.trim().slice(0, 40) ?? "", box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const overlaps: string[] = [];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const [p, q] = [boxes[a].box, boxes[b].box];
        if (p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) {
          overlaps.push(`${boxes[a].name} × ${boxes[b].name}`);
        }
      }
    }
    return overlaps;
  });
}

/** Clicks likely roof points until a face card opens. */
async function selectRoofFace(page: Page, scene: Locator) {
  const box = (await scene.locator("canvas").boundingBox())!;
  const card = page.getByRole("status").filter({ hasText: /-facing roof|Flat roof/ });
  for (const [fx, fy] of [[0.3, 0.45], [0.4, 0.45], [0.25, 0.5], [0.35, 0.35], [0.45, 0.55], [0.5, 0.4]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    if (await card.count()) break;
  }
  await expect(card).toBeVisible();
  return card;
}

async function openHouse(page: Page, kind: SyntheticRoofKind, options: SyntheticRoofOptions) {
  await installSafeApiMocks(page);
  const roof = await installSyntheticRoof(page, kind, { pixelSizeMeters: 0.25, maskErosionPx: 2, mixedEdges: true, ...options });
  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&panels=${roof.panels.length}`);
  const scene = page.getByTestId("roof-scene-3d");
  await expect(scene).toHaveAttribute("data-roof-model", "reconstructed", { timeout: 30_000 });
  await scene.scrollIntoViewIfNeeded();
  return { roof, scene };
}

for (const house of HOUSES) {
  test(`${house.kind} roof rebuilds as one building`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { roof, scene } = await openHouse(page, house.kind, house.options);
    await expect(scene).toHaveAttribute("data-face-count", String(house.faces));
    await expect(scene).toHaveAttribute("data-rendered-panel-count", String(roof.panels.length));
    await page.getByRole("checkbox", { name: "Sunlight quality" }).first().uncheck();
    await expect(scene.locator("canvas")).toHaveScreenshot(`${house.kind}.png`, { maxDiffPixelRatio: 0.02, timeout: 20_000 });
    expect(errors).toEqual([]);
  });
}

test("viewer controls never slide under each other, even with the longer obstruction hint", async ({ page }) => {
  const { scene } = await openHouse(page, "gable", { rooftopUnit: true, tree: true });
  await expect(page.getByText(/Grey blocks are raised features/)).toBeVisible();
  expect(await overlappingOverlays(page)).toEqual([]);
  await selectRoofFace(page, scene);
  expect(await overlappingOverlays(page)).toEqual([]);
});

test("the sunlight layer shows the absolute-scale legend with the heatmap", async ({ page }) => {
  const { scene } = await openHouse(page, "hip", {});
  await page.getByRole("checkbox", { name: "Sunlight quality" }).first().check();
  await expect(page.getByRole("img", { name: /share of this roof's best-case sun/i }).first()).toBeVisible();
  await expect(scene.locator("canvas")).toHaveScreenshot("hip-sunlight.png", { maxDiffPixelRatio: 0.02, timeout: 20_000 });
});

test("tapping a roof face describes it in plain language", async ({ page }) => {
  const { scene } = await openHouse(page, "gable", {});
  await page.getByRole("button", { name: "View roof from above" }).click();
  // The overhead view is framed in the uncovered left part of the canvas.
  const card = await selectRoofFace(page, scene);
  await expect(card).toContainText(/(East|West)-facing roof/);
  await expect(card).toContainText(/20° pitch/);
  await expect(card).toContainText(/% of best-case sun/);
  await page.getByRole("button", { name: "Close roof face details" }).click();
  await expect(card).toHaveCount(0);
});

test.describe("on touch devices", () => {
  test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

  test("the page keeps scrolling past the model until the visitor opts in", async ({ page }) => {
    const { scene } = await openHouse(page, "gable", { rooftopUnit: true, tree: true });
    expect(await overlappingOverlays(page)).toEqual([]);
    const gate = page.getByRole("button", { name: "Explore the 3D model" });
    await expect(gate).toBeVisible();
    expect(await gate.evaluate((element) => getComputedStyle(element).touchAction)).not.toBe("none");
    await gate.tap();
    await expect(gate).toHaveCount(0);
    await page.getByRole("button", { name: "Stop exploring the 3D model" }).tap();
    await expect(page.getByRole("button", { name: "Explore the 3D model" })).toBeVisible();
    await expect(scene).toHaveAttribute("data-roof-model", "reconstructed");
  });
});
