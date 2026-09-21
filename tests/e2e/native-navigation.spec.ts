import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import { TEST_ADDRESS } from "../fixtures/test-data";
import { installSafeApiMocks } from "../helpers/network";

test.use({ viewport: { width: 393, height: 852 } });

type NativeMessage = { section?: string; type?: string };
type NativeWindow = Window & {
  __nativeListenerCounts?: { scroll: number };
  __nativeMessages?: string[];
};

async function sectionMessages(page: Page) {
  return page.evaluate(() => {
    const nativeWindow = window as unknown as NativeWindow;
    const messages = nativeWindow.__nativeMessages ?? [];

    return messages.flatMap((rawMessage) => {
      try {
        const message = JSON.parse(rawMessage) as NativeMessage;
        return message.type === "analysis-section" ? [message.section] : [];
      } catch {
        return [];
      }
    });
  });
}

test("native bootstrap syncs report tabs and scroll position without duplicate listeners", async ({ page }) => {
  await installSafeApiMocks(page);
  await page.addInitScript(() => {
    const messages: string[] = [];
    Object.assign(window, {
      __nativeMessages: messages,
      ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    });
  });

  const source = await readFile("mobile/src/components/AnalysisScreen.tsx", "utf8");
  const bootstrap = source.match(/const nativeBootstrapScript = `([\s\S]*?)`;/)?.[1];
  expect(bootstrap).toBeTruthy();

  await page.goto(`/estimate?address=${encodeURIComponent(TEST_ADDRESS)}&app=ios`);
  await expect(page.locator("#report-dashboard")).toBeVisible();
  await page.evaluate(() => {
    const counts = { scroll: 0 };
    const addEventListener = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === "scroll") counts.scroll += 1;
      addEventListener(type, listener, options);
    }) as unknown as typeof window.addEventListener;
    Object.assign(window, { __nativeListenerCounts: counts });
  });
  await page.evaluate(bootstrap!);
  await page.evaluate(bootstrap!);

  await expect.poll(() => page.evaluate(() => {
    const nativeWindow = window as unknown as NativeWindow;
    return nativeWindow.__nativeListenerCounts?.scroll ?? 0;
  })).toBe(1);
  await page.evaluate(() => {
    const nativeWindow = window as unknown as NativeWindow;
    nativeWindow.__nativeMessages?.splice(0);
  });

  await page.locator("#report-dashboard").scrollIntoViewIfNeeded();
  await page.getByRole("tab", { name: "Send Report", exact: true }).click();
  await expect.poll(() => sectionMessages(page)).toContain("report");

  await page.evaluate(() => {
    const nativeWindow = window as unknown as NativeWindow;
    nativeWindow.__nativeMessages?.splice(0);
  });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect.poll(() => sectionMessages(page)).toContain("overview");

  await page.evaluate(() => {
    const nativeWindow = window as unknown as NativeWindow;
    nativeWindow.__nativeMessages?.splice(0);
    document.getElementById("rooftop-analysis")?.scrollIntoView();
  });
  await expect.poll(() => sectionMessages(page)).toContain("roof");
});
