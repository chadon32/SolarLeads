import assert from "node:assert/strict";
import test from "node:test";
import { trackEvent } from "../src/lib/analytics";

test("analytics forwards only aggregate allow-listed fields", () => {
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    gtag: (_command: string, name: string, params?: Record<string, unknown>) => {
      calls.push({ name, params });
    },
  };

  try {
    trackEvent("scenario_share_copied", {
      content_version: "illustrative_v1",
      output: "clipboard",
      placement: "home_sample",
      surface: "overview",
      address: "1234 Example Way",
      bill: 300,
      email: "homeowner@example.com",
      url: "https://example.com/private",
      token: "lead-token",
    });
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }

  assert.deepEqual(calls, [
    {
      name: "scenario_share_copied",
      params: {
        content_version: "illustrative_v1",
        output: "clipboard",
        placement: "home_sample",
        surface: "overview",
      },
    },
  ]);
});

test("analytics rejects malformed event names", () => {
  const calls: unknown[] = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    gtag: () => calls.push(true),
  };

  try {
    trackEvent("private url?address=123", { surface: "overview" });
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }

  assert.deepEqual(calls, []);
});
