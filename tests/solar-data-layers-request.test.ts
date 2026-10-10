import assert from "node:assert/strict";
import test from "node:test";

test("data layers are requested at the asked-for resolution, 0.5 m by default", async () => {
  process.env.GOOGLE_SOLAR_API_KEY = "test-key";
  const { fetchSolarDataLayers } = await import("../src/lib/google-solar");
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ dsmUrl: "https://solar.googleapis.com/v1/geoTiff:get?id=test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await fetchSolarDataLayers(33.4, -111.8);
    await fetchSolarDataLayers(33.4, -111.8, undefined, { pixelSizeMeters: 0.25 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(new URL(requested[0]).searchParams.get("pixelSizeMeters"), "0.5");
  assert.equal(new URL(requested[1]).searchParams.get("pixelSizeMeters"), "0.25");
});
