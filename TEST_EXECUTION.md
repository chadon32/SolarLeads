# Solartelligence QA Test Execution

## Environment

- Date: July 31, 2026
- OS: Windows
- Repository: `C:\Users\chado\Documents\arizona-solar-ai`
- Framework: Next.js 16.2.12, React 19
- Package manager: npm with `package-lock.json`
- Local browser target: `http://127.0.0.1:3100`
- Production read-only target: `https://solartelligence.com/`

## Installation

```powershell
npm install
npx playwright install chromium firefox webkit
```

The lockfile is used. The test suite adds `@axe-core/playwright`.

## Build And Start

Build:

```powershell
npm run build
```

Manual production server:

```powershell
npm start -- -p 3100
```

The Playwright configuration starts this server automatically when
`PLAYWRIGHT_BASE_URL` is not set.

## Test Commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Open the HTML report:

```powershell
npm run test:e2e:report
```

Run against an already-running safe environment:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3000'
npm run test:e2e
```

Do not point the write-path tests at production. The suite intercepts external
and state-changing endpoints, but local or staging remains the intended target.

## Executed Results

- `npm test`: 108 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 2 pre-existing warnings in
  `marketing-ad/landscape/scripts/patch-frame3-duration.mjs`.
- `npm run build`: passed on Next.js 16.2.12.
- Complete Playwright matrix: 69 passed, 0 failed, including the rebuilt
  panel-consistency regression.
- Automated Axe checks: no critical or serious violations on the tested landing
  and ready-estimate fixture states.
- Dependency audit: `npm audit --omit=dev` reports 0 production vulnerabilities.
  PostCSS and Sharp are pinned through the package overrides; do not use npm's
  suggested unsafe framework downgrade.

## Browser Projects

- Chromium desktop: 1440 x 900
- Firefox desktop: 1440 x 900
- WebKit desktop: 1440 x 900
- Laptop Chromium: 1280 x 800
- Tablet portrait: 768 x 1024
- Tablet landscape: 1024 x 768
- Mobile Chromium/WebKit profile: 390 x 844
- Small mobile: 320 x 568

## Covered Workflows

- Landing content, navigation, privacy, terms, support visibility, and console errors.
- Address entry, trim/paste, keyboard selection, no results, slow response, and API failure.
- Empty, low, normal, high, negative, decimal, formatted, text, and oversized bill values.
- Roof loading, selected-home map, panels, roof planes, tabs, confidence, and count consistency.
- Cash, loan, and lease presentation plus financial-estimate wording.
- Report validation, one mocked submission, duplicate-click protection, and expired access.
- Mobile overflow, 44 px targets, 200% zoom, focus visibility, and tab semantics.
- API 400, 403, 404, 429, 500, malformed response, and stylesheet-load regression.
- Four persona journeys.

## Safe Test Data

- Address: `1234 Test Solar Way, Mesa, AZ 85201`
- Email: `test-homeowner@example.test`
- Phone: `(202) 555-0147`
- Lead ID: deterministic non-production UUID

The test address is a fixture string. API responses, map behavior, roof data,
report results, lead submission, and images are mocked.

## External Calls Blocked Or Mocked

- Google Places
- Google Maps browser script and map rendering
- Google Solar roof analysis
- Satellite image and data layers
- Supabase-backed lead mutation
- Report email/PDF write paths
- Google Analytics
- Utility uploads

## Environment Variables

The deterministic suite does not require production secrets. It explicitly
clears:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

A real local application run may require the variables documented in
`.env.example`, including Google, Supabase, Resend, report signing, dashboard
auth, rate-limit, follow-up, and utility-upload settings. Never place service
role keys or provider secrets in `NEXT_PUBLIC_*` variables.

## Skipped Or Not Tested

- Real Google Solar, satellite, or map accuracy: skipped to avoid paid API usage
  and use of an unauthorized property.
- Real lead submission and duplicate persistence: skipped to avoid production
  data writes; persistence logic was inspected and unit-tested.
- Real email delivery: skipped to avoid contacting anyone.
- Real PDF generation for a customer record: skipped to avoid database access
  and private report creation.
- Utility bill upload/download: route security and validation inspected; no real
  personal document uploaded.
- Dashboard production mutation: skipped to avoid changing production data.
- Real session expiry and multi-user races: not safely reproducible without a
  dedicated staging environment.
- JavaScript-disabled full workflow: the application requires JavaScript for the
  interactive analysis; no non-JS roof workflow is expected.
- Cookies-disabled workflow: no blocking cookie dependency was observed, but a
  dedicated manual browser run was not completed.
- Manual screen-reader pass: automated semantics and Axe checks passed, but
  VoiceOver, NVDA, and TalkBack were not executed.
- Production Core Web Vitals: not measured in a controlled run.

## Known Limitations

- Production was reviewed read-only and may be behind the local tested commit.
- Mock map screenshots prove UI state and responsiveness, not satellite-image or
  engineering accuracy.
- Browser automation cannot verify roof measurements, obstructions, electrical
  service, structural suitability, installer pricing, loan eligibility, or tax
  eligibility.
- The HTML report and `test-results` are generated artifacts and may be removed
  or ignored in source control if the team does not retain CI evidence.

## Reproduction

1. Check out the same working tree.
2. Install dependencies with `npm install`.
3. Install Playwright browsers.
4. Run `npm run build`.
5. Run `npm run test:e2e`.
6. Open `playwright-report/index.html`.
7. Review `SOLAR_APP_QA_REPORT.md` and `qa-issues.json`.
8. For visual evidence, open the images in `qa-evidence/`.

If a test fails after source changes, rebuild first. Playwright uses `npm start`,
which serves the latest `.next` production bundle rather than compiling source
on demand.
