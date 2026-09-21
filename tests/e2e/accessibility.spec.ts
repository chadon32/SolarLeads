import { expect, test } from "playwright/test";
import { getSeriousAccessibilityViolations } from "../helpers/accessibility";
import { installSafeApiMocks } from "../helpers/network";
import { HomeEstimatePage } from "./pages/home-estimate-page";

test("landing page has no critical or serious automated accessibility violations", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();
  expect(await getSeriousAccessibilityViolations(page)).toEqual([]);
});

test("ready estimate supports keyboard navigation and valid tab relationships", async ({
  page,
}) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.openReadyEstimate();

  const reportTablist = page.getByRole("tablist", {
    name: "Solar report detail sections",
  });
  const overviewTab = reportTablist.getByRole("tab", {
    name: "Overview",
    exact: true,
  });
  const roofTab = reportTablist.getByRole("tab", {
    name: "Roof & Shade",
    exact: true,
  });
  const panelsTab = reportTablist.getByRole("tab", {
    name: "Panels",
    exact: true,
  });
  const savingsTab = reportTablist.getByRole("tab", {
    name: "Savings",
    exact: true,
  });
  const financingTab = reportTablist.getByRole("tab", {
    name: "Financing",
    exact: true,
  });
  const sendTab = reportTablist.getByRole("tab", {
    name: "Send Report",
    exact: true,
  });
  const reportTabs = [
    overviewTab,
    roofTab,
    panelsTab,
    savingsTab,
    financingTab,
    sendTab,
  ];
  const expectReportTabState = async (selectedIndex: number) => {
    for (const [index, tab] of reportTabs.entries()) {
      await expect(tab).toHaveAttribute(
        "aria-selected",
        index === selectedIndex ? "true" : "false"
      );
      await expect(tab).toHaveAttribute(
        "tabindex",
        index === selectedIndex ? "0" : "-1"
      );
    }
    await expect(reportTabs[selectedIndex]).toBeFocused();
  };

  await overviewTab.focus();
  await expectReportTabState(0);
  await expect(overviewTab).toHaveAttribute("aria-controls", /.+/);

  await overviewTab.press("ArrowRight");
  await expectReportTabState(1);

  await roofTab.press("End");
  await expectReportTabState(5);

  await sendTab.press("Home");
  await expectReportTabState(0);

  await overviewTab.press("ArrowLeft");
  await expectReportTabState(5);

  expect(await getSeriousAccessibilityViolations(page)).toEqual([]);
});

test("focus indicators remain visible at 200 percent zoom", async ({ page }) => {
  await installSafeApiMocks(page);
  const home = new HomeEstimatePage(page);
  await home.open();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await home.addressInput().focus();
  await expect(home.addressInput()).toBeFocused();
  const box = await home.addressInput().boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
});

test("privacy choices remain accessible and touch friendly", async ({ page }) => {
  await page.goto("/privacy");

  for (const name of ["Request my data", "Correct my data", "Delete my data"]) {
    const link = page.getByRole("link", { name });
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  expect(await getSeriousAccessibilityViolations(page)).toEqual([]);
});
