import { chromium } from "playwright";

type RouteSample = {
  status: number | null;
  domContentLoadedMs: number;
  loadMs: number;
  firstContentfulPaintMs: number;
  resourceCount: number;
  scriptCount: number;
  jsEncodedBytes: number;
  videoRequestCount: number;
  videoResponseBytes: number;
};

type RouteResult = {
  route: string;
  samples: RouteSample[];
  median: RouteSample;
};

const baseUrl =
  process.env.PERF_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3100";
const routes = (process.env.PERF_ROUTES ?? "/,/estimate")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const sampleCount = Math.max(1, Number(process.env.PERF_SAMPLES ?? 3));

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function getMedianSample(samples: RouteSample[]): RouteSample {
  return {
    status: samples[Math.floor(samples.length / 2)]?.status ?? null,
    domContentLoadedMs: median(samples.map((sample) => sample.domContentLoadedMs)),
    loadMs: median(samples.map((sample) => sample.loadMs)),
    firstContentfulPaintMs: median(
      samples.map((sample) => sample.firstContentfulPaintMs)
    ),
    resourceCount: median(samples.map((sample) => sample.resourceCount)),
    scriptCount: median(samples.map((sample) => sample.scriptCount)),
    jsEncodedBytes: median(samples.map((sample) => sample.jsEncodedBytes)),
    videoRequestCount: median(
      samples.map((sample) => sample.videoRequestCount)
    ),
    videoResponseBytes: median(
      samples.map((sample) => sample.videoResponseBytes)
    ),
  };
}

async function measureRoute(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  route: string
): Promise<RouteResult> {
  const samples: RouteSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    let videoRequestCount = 0;
    let videoResponseBytes = 0;

    page.on("response", (response) => {
      if (!new URL(response.url()).pathname.endsWith(".mp4")) {
        return;
      }

      videoRequestCount += 1;
      videoResponseBytes += Number(response.headers()["content-length"] ?? 0);
    });

    try {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: "load",
        timeout: 30_000,
      });
      await page.waitForTimeout(300);

      const sample = await page.evaluate(() => {
        const navigation = performance.getEntriesByType(
          "navigation"
        )[0] as PerformanceNavigationTiming | undefined;
        const firstContentfulPaint = performance
          .getEntriesByType("paint")
          .find((entry) => entry.name === "first-contentful-paint");
        const resources = performance.getEntriesByType(
          "resource"
        ) as PerformanceResourceTiming[];
        const scripts = resources.filter(
          (entry) =>
            entry.name.includes("/_next/static/") && entry.name.endsWith(".js")
        );

        return {
          status: null,
          domContentLoadedMs: Math.round(
            navigation?.domContentLoadedEventEnd ?? 0
          ),
          loadMs: Math.round(navigation?.loadEventEnd ?? 0),
          firstContentfulPaintMs: Math.round(firstContentfulPaint?.startTime ?? 0),
          resourceCount: resources.length,
          scriptCount: scripts.length,
          jsEncodedBytes: scripts.reduce(
            (total, entry) => total + (entry.encodedBodySize || 0),
            0
          ),
        } satisfies Omit<
          RouteSample,
          "status" | "videoRequestCount" | "videoResponseBytes"
        > & { status: null };
      });

      samples.push({
        ...sample,
        status: response?.status() ?? null,
        videoRequestCount,
        videoResponseBytes,
      });
    } finally {
      await context.close();
    }
  }

  return {
    route,
    samples,
    median: getMedianSample(samples),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    const results = [];

    for (const route of routes) {
      results.push(await measureRoute(browser, route));
    }

    console.log(
      JSON.stringify(
        {
          baseUrl,
          sampleCount,
          measuredAt: new Date().toISOString(),
          results,
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

void main();
