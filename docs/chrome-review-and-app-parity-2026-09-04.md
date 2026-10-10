# Chrome review and iPhone app parity

## Scope

Reviewed the current local website, not a deployed revision. Opened it in the
user's Chrome and exercised navigation, FAQ, privacy/terms, bill validation,
short address input, background pause, mobile menu, and missing-page recovery.
Also ran installed-Chrome synthetic walkthroughs at 1440 x 1000 and 393 x 852.
These covered address selection, roof/3D controls, sunlight, every report tab,
report validation, refresh, browser Back, legal pages, and missing/expired links.
All analysis, contact submission, and paid-service responses in those complete
walkthroughs were intercepted with test fixtures. No real lead or email was sent.

## Fixed findings

| Severity | Reproduction / previous behavior | Fix | Evidence |
| --- | --- | --- | --- |
| High | Enter a $237 bill, open the report: its quick bill selector displays $100 while calculations use $237. | Both selectors include the current custom amount and stay synchronized after changes/refresh. Calculations and pricing unchanged. | New custom-bill regression failed with received value 100 before the fix and passed afterward. |
| High | Open Savings with a screen reader: the second bill selector has no accessible name. | Associated visible label and distinct accessible name. | Chrome `select-name` failure removed. |
| Medium | Tab through the desktop homepage: invisible progress buttons receive keyboard focus before analysis exists. | Inactive progress navigation is inert and hidden from accessibility APIs. | New keyboard regression. |
| Medium | Read inverter descriptions, financing assumptions, and report consent copy. | Raised the specific failing text colors, without changing wording. | Previous contrast ratios 4.42, 4.26, and 4.1; no contrast violations detected in final inspected states. |
| Medium | Navigate headings on the home page: h1 jumps to h3. | Section titles and FAQ now use h2 elements. | `heading-order` failure removed. |
| Medium | Visit an invalid URL: generic error page has no recovery route or main landmark. | Branded accessible 404 with a home link and a 44px-minimum target. | Chrome screenshot and regression verify the 404 response, landmark, title, and recovery link. |
| Medium | Background video continues without a user pause control. | Added pause/resume, retained reduced-motion/data-saver handling, and prevented the loop timer from restarting paused playback. | Manual Chrome pause confirmation and regression verify playback stays stopped. |
| Medium | First opening of Send Report can briefly show an empty panel while its chunk loads. | Added a status placeholder for the lazily loaded form. | Source loading boundary; walkthrough waits for the loaded form before inspecting it. |
| High | In the native app, press Overview/Report while analysis is loading: selected state changes although the target does not exist. | Readiness is distinct from page loading; tabs stay disabled until valid completion and reset on errors/reloads. Navigation selects only after a valid target acknowledgement. | New native-state unit tests and injected-script checks. |
| Medium | Scroll or switch report tabs inside the app: native indicator stays on an old section. | Scoped report-tab and scroll observation, de-duplicated across bootstrap injection, updates the indicator. | 393 x 852 bridge regression covers Report, Overview, Roof, and duplicate injection. |
| High | A cropped elevation scan has no ground pixels: the 3D counter says panels are present but the surface hides them. Individually clipped roof corners no longer match the panel plane. | Apply one shared display-ground offset to fitted roof planes and panels; preserve slopes, relative plane heights, and module standoff. No energy, count, pricing, or source data changes. | Roof-only pixel regression failed before and passed after; two geometry regressions verify coplanarity and no change to already-valid roofs. |

## Results

The two complete Chrome walkthroughs inspected 17 states each. Final automated
accessibility scans found zero violations and no horizontal page overflow at
either viewport. No uncaught JavaScript page errors were recorded. This is not
a claim of full WCAG conformance or that all possible defects are eliminated.

The baseline scans recorded 10 rule violations across desktop states and 9
across phone states (repeated rules across pages, not 19 unique defects).

Final validation:

- Unit suite: 160 passed, 0 failed (10.1 seconds).
- Final broad browser suite against the updated local production build:
  137 passed, 0 failed (5.8 minutes), including both installed-Chrome evidence
  walkthroughs and the new pixel-based 3D regression. Only the two opt-in
  performance benchmarks were skipped.
- Web and Expo mobile TypeScript checks passed.
- Focused ESLint for every code/test file changed in this review passed.
- Production Webpack build passed, using two workers. Existing GeoTIFF worker
  bundling and missing Google Analytics configuration warnings remain.
- Scoped Git whitespace check passed; preexisting worktree edits were preserved.

### Screenshots

Before evidence and raw Axe findings:
`qa-evidence/chrome-audit/before/{1440,393}/`.

Verified after evidence and raw findings:
`qa-evidence/chrome-audit/final-review/{1440,393}/`.

![Corrected desktop Savings control](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/chrome-audit/final-review/1440/savings-viewport.png)

![Before: roof surface hides panels](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/chrome-audit/3d-occlusion-before.png)

![After: panels and roof share the same plane](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/chrome-audit/final-review/1440/roof-ready-viewport.png)

Screenshots show a synthetic test roof, not a real surveyed property. The map
and elevation fixtures validate UI behavior, not satellite quality or field accuracy.

The visual regression compares only roof pixels, excluding changing counters,
checkboxes, and other overlays. Before the geometry fix, only 0.0051% of sampled
color channels changed by more than 20/255 when panels were hidden. Afterward,
16.46% changed and the modules are visibly present. Whole-canvas screenshots
alone were misleading because the counter and checkbox changed even when the
panels were buried. The display-ground adjustment is not a surveyed eave height.

## Is the app exactly the same?

No. The current Expo source uses a native React Native address-search home
screen and native Home/Share/bottom navigation. The analysis workspace opens
`https://solartelligence.com/estimate?...&app=ios` in a WebView. That workspace
uses the shared roof model, panel equipment, savings, and report components.
The app hides/rearranges website navigation for the phone shell.

- Local website changes are not yet visible in the installed app. Shared-web
  changes reach it after deployment to the configured production website.
- This task also changes native navigation code. Those fixes require a new
  iPhone build and delivery through TestFlight/App Store.
- Current Expo configuration is version 1.1.1, SDK 57, WebView 13.16.1, bundle
  `com.solartelligence.app`. There is no configured `expo-updates` package,
  runtime version, update URL, or OTA update channel.
- A separate older Capacitor wrapper exists with the same bundle ID. Source
  inspection cannot identify which exact binary/build is installed on a phone.

The SDK's WebView role is described in the
[versioned Expo WebView documentation](https://docs.expo.dev/versions/v57.0.0/sdk/webview/).
Parity conclusions above come from this repository's configuration and components,
not assumptions about the user's installed binary.

## Testing caveats

- The user's Chrome produced a hydration warning showing Grammarly-injected
  body attributes (`data-gr-ext-installed`). It was not reproduced as an app
  error in isolated browser profiles. No warning suppression or extension
  removal was applied.
- Repeated evidence writes inside the watched project disrupted the dev audit
  with reloads. Moving the generated files to the system temporary directory
  made the same workflows pass. Audit output now defaults outside the project;
  reviewed evidence is copied back only after the run. Earlier failed runs
  are not counted as passing runs.
- The existing local database DNS/connectivity problem is not repaired by UI
  changes. Healthy live data persistence and real report email delivery were
  not verified or exercised.
- No physical iPhone keyboard, native gestures, camera/file picker, installed
  TestFlight binary, or production release was verified. Browser app-mode and
  native-state tests are not substitutes for on-device release QA.
- The native shell still uses its original Home/analysis navigation model.
  WebView history gestures and native header/address synchronization need an
  on-device pass before claiming full browser Back parity. That navigation
  architecture was not replaced as part of the tab-readiness fix.
- Private dashboards were not unlocked, and production homeowner records were
  not inspected. Public error/auth boundaries are covered by regression tests.
- No Git commit, push, deployment, store submission, or cloud app build was made.

## Reproduce

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3000'
$env:RUN_CHROME_AUDIT = 'true'
$env:CHROME_AUDIT_PHASE = 'after'
npx playwright test tests/e2e/chrome-audit.spec.ts --project=chromium-desktop --reporter=list --output="$env:TEMP/solartelligence-chrome-audit/test-results"
Remove-Item Env:RUN_CHROME_AUDIT
npm test
npm run mobile:typecheck
```

Reuse the existing local server; never stack duplicate servers on port 3000.
