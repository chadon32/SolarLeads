import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
const leadId = "00000000-0000-0000-0000-000000000000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    const homepage = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    assert.ok(homepage?.ok(), `homepage returned ${homepage?.status() ?? "no response"}`);
    await page.getByText("Address lookup ready").waitFor({ timeout: 10_000 });
    console.log("PASS homepage: updated address-search copy is visible");

    const checks = [
      ["unsigned PDF", `/api/report/pdf?leadId=${leadId}&raw=1`],
      ["unauthenticated lead status", "/api/leads/status"],
      ["unauthenticated follow-up send", "/api/follow-ups/send-now"],
    ] as const;

    for (const [label, path] of checks) {
      const method = path.includes("status")
        ? "PATCH"
        : path.includes("send-now")
          ? "POST"
          : "GET";
      const response = await page.request.fetch(`${baseUrl}${path}`, {
        method,
        data: path.includes("status") ? { leadId, status: "New" } : undefined,
      });
      assert.equal(response.status(), 403, `${label} returned ${response.status()}`);
      console.log(`PASS ${label}: rejected with 403`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`QA smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
