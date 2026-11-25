import { defineConfig } from "playwright/test";

// This suite mutates a disposable in-memory database. Never reuse a running server or accept a remote base URL.
const baseURL = "https://localhost:3183";
export default defineConfig({
  testDir: "./tests/operations",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: "qa-evidence/operations-results",
  use: { baseURL, ignoreHTTPSErrors: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "operations-desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "operations-mobile", testMatch: "contact-preferences.spec.ts", use: { browserName: "webkit", viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "npm run preview:dashboard -- --qa-build",
    url: baseURL + "/dashboard",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
