import { expect, test } from "playwright/test";
import { placeDetailsSuccess } from "../fixtures/mock-api-responses";
import { TEST_ADDRESS } from "../fixtures/test-data";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("background page updates do not restart an in-flight address search", async ({ page }) => {
  await installSafeApiMocks(page);
  let releaseNeighborhood = () => {};
  const neighborhoodGate = new Promise<void>((resolve) => { releaseNeighborhood = resolve; });
  await page.route("**/api/neighborhood", async (route) => {
    await neighborhoodGate;
    await route.fulfill({ json: { totalEstimateCount: 120 } });
  });
  let requests = 0;
  await page.route("**/api/places/autocomplete", async (route) => {
    requests += 1;
    releaseNeighborhood();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ json: { predictions: [{ description: TEST_ADDRESS, place_id: "test-place-id" }] } });
  });
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill("1234");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(requests).toBe(1);
});

test("one- and two-character inputs do not send unusable address lookups", async ({ page }) => {
  await installSafeApiMocks(page);
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/places/autocomplete")) requests += 1;
  });
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill("1");
  await page.waitForTimeout(350);
  await home.addressInput().fill("12");
  await page.waitForTimeout(350);
  expect(requests).toBe(0);
  await home.addressInput().fill("1234");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(requests).toBe(1);
});

test("editing during a delayed details lookup cancels the old selection", async ({ page }) => {
  await installSafeApiMocks(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/places/details**", async (route) => {
    await gate;
    await route.fulfill({ json: placeDetailsSuccess });
  });
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill("1234");
  await page.getByRole("option").first().click();
  await expect(home.addressInput()).toHaveAttribute("aria-busy", "true");
  const edited = "9876 Different Test Street, Mesa, AZ 85201";
  await home.addressInput().fill(edited);
  release();
  await page.waitForTimeout(600);
  await expect(home.addressInput()).toHaveValue(edited);
  await expect(page).not.toHaveURL(/\/estimate\?/);
  await expect(home.addressInput()).toHaveAttribute("aria-busy", "false");
});

test("a failed details lookup does not navigate using an unverified prediction", async ({ page }) => {
  await installSafeApiMocks(page);
  await page.route("**/api/places/details**", (route) => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill("1234");
  await page.getByRole("option").first().click();
  await expect(page.locator("#address-error")).toContainText(/temporarily unavailable/i);
  await expect(page).not.toHaveURL(/\/estimate\?/);
});

test("selects a valid Arizona address with the keyboard", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();

  await home.addressInput().fill("1234 Test");
  await expect(page.getByRole("option", { name: /1234 Test Solar Way/i })).toBeVisible();
  await home.addressInput().press("ArrowDown");
  await home.addressInput().press("Enter");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /1234 Test Solar Way, Mesa, AZ 85201/i,
    })
  ).toBeVisible({ timeout: 20_000 });
});

test("rapid repeated address activation issues one place-details request", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  await page.unroute("**/api/places/details**");

  let detailsRequests = 0;
  await page.route("**/api/places/details**", async (route) => {
    detailsRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(placeDetailsSuccess),
    });
  });

  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill("1234 Test");

  const option = page.getByRole("option", { name: /1234 Test Solar Way/i });
  await expect(option).toBeVisible();
  await option.evaluate((element) => {
    element.addEventListener(
      "click",
      () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      { once: true }
    );
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const selectionStatus = page.getByRole("status");
  await expect(selectionStatus).toContainText("Loading selected address...");
  await expect(selectionStatus).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByRole("button", {
      name: "Start roof analysis with the selected address",
    })
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { level: 1, name: /1234 Test Solar Way/i })
  ).toBeVisible({ timeout: 20_000 });

  expect(detailsRequests).toBe(1);
});

test("Escape closes an in-flight autocomplete popup before results arrive", async ({
  page,
}) => {
  await installSafeApiMocks(page, { autocompleteDelayMs: 500 });
  const home = new HomeEstimatePage(page);
  await home.open();

  await home.addressInput().fill("1234 Test");
  await page.waitForTimeout(300);
  await home.addressInput().press("Escape");
  await page.waitForTimeout(750);

  await expect(home.addressInput()).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox", { name: "Address suggestions" })).toBeHidden();
});

test("reports no results without accepting an unsupported address", async ({ page }) => {
  await installSafeApiMocks(page);
  await page.route("**/api/places/autocomplete", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ predictions: [] }),
    })
  );
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill("not a property");

  await expect(page.locator("#address-error")).toContainText(/No results found/i);
});

test("shows a safe fallback message when Places fails", async ({ page }) => {
  await installSafeApiMocks(page);
  await page.route("**/api/places/autocomplete", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Address lookup is temporarily unavailable." }),
    })
  );
  const home = new HomeEstimatePage(page);
  await home.open();
  await home.addressInput().fill(TEST_ADDRESS);

  await expect(page.getByText(/Local fallback/i)).toBeVisible();
  await expect(page.locator("#address-error")).toContainText(
    /temporarily unavailable/i
  );
});
