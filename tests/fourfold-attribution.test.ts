import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFourfoldAttributionKey } from "../src/lib/attribution";
import { sendFourfoldConversion } from "../src/lib/fourfold-attribution";

const timestamp = "2026-09-22T20:00:00.000Z";
const bearer = `00000000-0000-4000-8000-000000000001.${"a".repeat(43)}`;

function withFourfoldEnvironment<T>(
  endpoint: string | undefined,
  secret: string | undefined,
  run: () => Promise<T>
) {
  const previousEndpoint = process.env.FOURFOLD_ATTRIBUTION_ENDPOINT;
  const previousSecret = process.env.FOURFOLD_ATTRIBUTION_SECRET;

  if (endpoint === undefined) delete process.env.FOURFOLD_ATTRIBUTION_ENDPOINT;
  else process.env.FOURFOLD_ATTRIBUTION_ENDPOINT = endpoint;
  if (secret === undefined) delete process.env.FOURFOLD_ATTRIBUTION_SECRET;
  else process.env.FOURFOLD_ATTRIBUTION_SECRET = secret;

  return run().finally(() => {
    if (previousEndpoint === undefined) delete process.env.FOURFOLD_ATTRIBUTION_ENDPOINT;
    else process.env.FOURFOLD_ATTRIBUTION_ENDPOINT = previousEndpoint;
    if (previousSecret === undefined) delete process.env.FOURFOLD_ATTRIBUTION_SECRET;
    else process.env.FOURFOLD_ATTRIBUTION_SECRET = previousSecret;
  });
}

test("Fourfold attribution is disabled unless endpoint and secret are configured", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await withFourfoldEnvironment(undefined, undefined, () =>
      sendFourfoldConversion({
        eventId: "lead-opaque-1",
        timestamp,
        utmId: "utm-opaque-1",
      })
    );

    assert.deepEqual(result, { status: "disabled" });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fourfold attribution rejects non-opaque values before making a request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await withFourfoldEnvironment(
      "https://fourfold.example/convert",
      bearer,
      () =>
        sendFourfoldConversion({
          eventId: "lead@example.com",
          timestamp,
          utmId: "utm-opaque-1",
        })
    );

    assert.deepEqual(result, { status: "invalid_input", reason: "event_id" });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fourfold payload contains only conversion identifiers and timestamp", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  let requestHeaders: Headers | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestHeaders = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await withFourfoldEnvironment(
      "https://fourfold.example/api/conversions",
      bearer,
      () =>
        sendFourfoldConversion({
          eventId: "lead-opaque-1",
          timestamp,
          utmId: "solarai-threads-123e4567-e89b-12d3-a456-426614174000",
        })
    );

    assert.deepEqual(result, { status: "sent" });
    assert.deepEqual(requestBody, {
      eventId: "lead-opaque-1",
      occurredAt: timestamp,
      attributionKey: "solarai-threads-123e4567-e89b-12d3-a456-426614174000",
    });
    assert.equal(requestHeaders?.get("authorization"), `Bearer ${bearer}`);
    assert.equal(requestHeaders?.get("content-type"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arbitrary client UTM values are discarded instead of forwarded", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await withFourfoldEnvironment(
      "https://fourfold.example/api/conversions",
      bearer,
      () =>
        sendFourfoldConversion({
          eventId: "lead-opaque-1",
          timestamp,
          utmId: "solarai-threads-jane-doe-602-555-1212",
        })
    );

    assert.deepEqual(result, { status: "sent" });
    assert.deepEqual(requestBody, {
      eventId: "lead-opaque-1",
      occurredAt: timestamp,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fourfold deterministic attribution keys are canonicalized and scoped", () => {
  assert.equal(
    normalizeFourfoldAttributionKey(
      "SOLARAI-Threads-123E4567-E89B-12D3-A456-426614174000"
    ),
    "solarai-threads-123e4567-e89b-12d3-a456-426614174000"
  );
  assert.equal(normalizeFourfoldAttributionKey("carpartsradar-threads-post-1"), null);
  assert.equal(normalizeFourfoldAttributionKey("solar savings"), null);
});

test("Fourfold requests reject redirects", async () => {
  const originalFetch = globalThis.fetch;
  let redirectMode: RequestRedirect | undefined;
  globalThis.fetch = (async (_input, init) => {
    redirectMode = init?.redirect;
    throw new TypeError("redirect mode error");
  }) as typeof fetch;

  try {
    const result = await withFourfoldEnvironment(
      "https://fourfold.example/api/conversions",
      bearer,
      () =>
        sendFourfoldConversion({
          eventId: "lead-opaque-1",
          timestamp,
        })
    );

    assert.equal(redirectMode, "error");
    assert.deepEqual(result, { status: "failed", reason: "TypeError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fourfold provider errors are returned without throwing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("provider unavailable");
  }) as typeof fetch;

  try {
    const result = await withFourfoldEnvironment(
      "https://fourfold.example/api/conversions",
      bearer,
      () =>
        sendFourfoldConversion({
          eventId: "lead-opaque-1",
          timestamp,
        })
    );

    assert.deepEqual(result, { status: "failed", reason: "Error" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
