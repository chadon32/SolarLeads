# Address suggestion latency fix

## Scope and cause

The reported delay occurs while typing, before suggestions appear. Measured on
the existing guarded Next.js Webpack dev server at http://localhost:3000.

The configured database hostname fails DNS resolution (`ENOTFOUND`). The atomic
rate-limit RPC fails quickly, but the legacy request-event count then retries
after 1, 2, and 4 seconds. This adds approximately seven seconds before the
Google Places request even starts. A fetch-stage probe measured Google at 190 ms
and the overall handler at 7,279 ms. No credentials or provider payloads were
logged. No leads or messages were submitted.

## Changes

- Skip the redundant legacy database attempt after a transport failure and use
  the existing memory limiter immediately.
- Give the complete database rate-limit check a shared two-second deadline and
  disable SDK retries. Preserve healthy atomic enforcement, legacy-schema
  fallback, thresholds, and excess-request rejection.
- Keep autocomplete independent of unrelated parent renders using an Effect
  Event for automatic selection. Selection still uses the latest callback.
- Do not issue suggestions requests until the input has three characters,
  matching the API's existing minimum. Keep the 220 ms typing debounce and
  existing stale-request cancellation.

## Measurements

Three sequential requests to the same local autocomplete endpoint, with the
same public address prefix. Real Google suggestions; no report generation.

| Measure | Before | After |
| --- | --- | --- |
| Endpoint sample 1 | 7,478 ms | 875 ms, includes route recompilation |
| Endpoint sample 2 | 7,238 ms | 104 ms |
| Endpoint sample 3 | 7,239 ms | 121 ms |
| Endpoint median | 7,239 ms | 121 ms |

The endpoint median improved by approximately 98%. These are local development
measurements, not production latency guarantees.

A separate Chromium interaction check measured 800, 794, and 804 ms from filling
the address input until Playwright observed the visible options. This includes
the debounce, real local API request, rendering, and observation overhead.
All three runs returned three suggestions; no page errors were recorded.
The neighborhood-count endpoint and analytics were stubbed/blocked in this
check. Screenshot: `qa-evidence/address-search-after.png`.

## Validation

- The outage regression failed before the fix: five database attempts and
  approximately seven seconds of delay. It passes after the fix.
- `npm test`: 144 passed, including atomic allow/deny, legacy fallback, network
  outage, stalled-request deadline, and memory-limit rejection assertions.
- `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/address.spec.ts --project=chromium-desktop --reporter=list`:
  9 passed. Covers background-render restarts, short input, keyboard selection,
  rapid activation, stale details cancellation, Escape, no results, and failures.
- TypeScript check, focused ESLint, and diff whitespace check passed.
- Browser tests use localhost, not 127.0.0.1: the dev server rejects the latter
  origin for development resources, so that earlier run was not a valid UI
  regression baseline. No dev-origin configuration was changed.

## Remaining limits

The underlying database DNS/configuration problem is not repaired by this fix.
The existing in-memory outage fallback is per process, not a distributed rate
limiter. Healthy database enforcement remains the normal path. Database-backed
features still need working connectivity; no production data was inspected.

No production deployment, Git push, native build, or full production build was
performed for this local search fix. The original localhost server remains
running; no additional dev server was started.
