# SolarTelligence Project Review

Reviewed September 4, 2026, against the local working tree on `codex/abuse-protection`.

Follow-up: local corrections and validation are tracked in
[Project Review Fixes](C:/Users/chado/Documents/arizona-solar-ai/docs/project-review-fixes-2026-09-04.md).
The findings and before-fix evidence below are preserved as the original audit.

## Conclusion

The current project builds and the existing automated suite passes, but it is not ready for an unconditional release sign-off. The most important remaining problems are lead ownership, disagreement between the on-screen estimate and saved report, and follow-up delivery reliability. Visual polish is a lower priority than those issues.

This was a review pass. Application code, pricing assumptions, database migrations, deployments, Git commits, and production records were not changed. The working tree already contained substantial uncommitted work. Added a local-only diagnostic script and this report; test runners generated evidence artifacts.

## Validation

| Check | Result | Scope |
| --- | --- | --- |
| `npm test` | 125 passed | Existing unit tests |
| `npm run lint` | Passed | Existing repository before diagnostic addition |
| `npm run build` | Passed | Next.js production build, including its TypeScript check |
| `npm run typecheck` | Passed | Web project |
| `npm run mobile:typecheck` | Passed | Expo project |
| `npm run test:e2e` | 120 passed in 4.2 minutes | Chromium, Firefox, WebKit; desktop, laptop, tablet, mobile, small mobile |
| Targeted negative authorization requests | 7/7 returned 403 | Lead status/notes/follow-up, send-now, report email, notification test, utility-bill cleanup |
| Native-injected web content at 393 x 852 | Document width 393 | Actual injection script executed in Chromium; not a physical iPhone |
| `git diff --check` | Passed | Existing tracked diff |
| Root `npm audit --omit=dev` | 1 high, 1 moderate package finding | See dependency caveats below |
| Mobile `npm audit --omit=dev` | 12 moderate package findings | Mostly linked Expo/build-tool dependencies |

Browser tests used synthetic properties, intercepted lead and paid-service requests, and local server kill switches. Supabase was pointed to an unused loopback endpoint for runtime checks. No real contacts, leads, payments, notifications, or production data were used.

The build reported that analytics was not configured in the local environment. That does not establish production analytics configuration. A later standalone local-server launch was rejected by the execution policy; no workaround was attempted, and no fresh standalone performance benchmark was recorded. The completed browser suite had already run against its managed production-build server.

## Priority Findings

### 1. High: Unverified contact matching can overwrite an existing lead

**Evidence:** [leads route, matching](C:/Users/chado/Documents/arizona-solar-ai/src/app/api/leads/route.ts#L1096), [update branch](C:/Users/chado/Documents/arizona-solar-ai/src/app/api/leads/route.ts#L619).

`findExistingLeadMatch` matches a normalized address with either an email or a phone number supplied by the public caller. On a match, the service-role write updates the existing row. There is no email/phone ownership verification or homeowner session for that update. The signed roof proof proves the analysis, not the identity of the person submitting the form.

**Reproduction setup:** In an isolated database, create a fixture lead. Submit a valid analysis for the same property with its phone number but a different email, or its email but changed lead fields. Trace the matching/update branch. This was established through code inspection, not executed against stored user data.

**Expected:** Anonymous report requests must not authorize modification of another person's existing record.

**Actual:** Name, contact information, estimate, consent fields, and workflow status are included in the overwrite payload. Rate limits and Turnstile do not prove ownership.

**Fix:** Separate submission deduplication from identity. Require a verified session or scoped, expiring edit token before overwriting a lead. Otherwise create a separate unverified submission for later reconciliation. Keep consent history immutable. Add authenticated/unauthenticated cross-contact tests.

### 2. High: The saved report can double the production and savings shown on screen

**Evidence:** [solar metrics](C:/Users/chado/Documents/arizona-solar-ai/src/lib/solar-metrics.ts#L354), [trusted snapshot rebuild](C:/Users/chado/Documents/arizona-solar-ai/src/lib/report-snapshot.ts#L205), [calculation evidence](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/calculations.json).

**Reproduced locally:** Use the existing synthetic roof fixture, its one 20-panel configuration, Qcells 400 W, a $200 monthly bill, and select 10 panels.

| Surface | Panels | Annual production | Annual savings |
| --- | --- | --- | --- |
| Live `buildActiveSolarEstimate` | 10 | 6,800 kWh | $1,054 |
| Server `rebuildTrustedSolarReportSnapshot` | 10 | 13,600 kWh | $2,108 |

**Cause:** `findNearestPanelConfig` falls back to the nearest configuration even when it contains more panels than selected. Its energy total takes precedence over the sum of the selected candidates. The saved numbers feed the lead/report flow. The protected production PDF itself was not generated in this review.

**Fix:** Use a shared energy calculation for the selected modules across UI, server snapshot, lead persistence, and PDF. Do not use an unmatched configuration's whole-system energy. Add a browser-to-server contract test, rather than mocking a fixed success response.

### 3. High: Adding panels can increase price without increasing production

**Evidence:** [catalog energy helper](C:/Users/chado/Documents/arizona-solar-ai/src/lib/solarPanels.ts#L360), [calculation evidence](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/calculations.json).

**Reproduced locally:** With provider configurations for 10 and 20 panels, the following results are returned for the default 400 W module:

| Selected panels | Annual production | Installed estimate |
| --- | --- | --- |
| 10 | 6,800 kWh | $9,200 |
| 11 | 6,800 kWh | $10,120 |
| 15 | 6,800 kWh | $13,800 |
| 19 | 6,800 kWh | $17,480 |

The helper selects the last configuration below the requested count and returns its energy without accounting for additional panels.

**Fix:** Sum the actual selected candidates, or use a documented interpolation when individual energy values are unavailable. Test sparse, exact, below-minimum, and above-maximum configuration cases. Address this together with finding 2.

### 4. High: Interrupted follow-up deliveries are not safely reconciled

**Evidence:** [claim recovery](C:/Users/chado/Documents/arizona-solar-ai/src/lib/follow-up-processing.ts#L71), [scheduler finalization](C:/Users/chado/Documents/arizona-solar-ai/src/lib/follow-up-processing.ts#L341), [manual sender](C:/Users/chado/Documents/arizona-solar-ai/src/app/api/follow-ups/send-now/route.ts#L234).

The scheduler requeues every claim older than 15 minutes. It does not impose an upper retry-age limit, persist a provider delivery ID, or tie finalization to a unique claim owner. A crashed worker that sent successfully but failed to update the database can therefore be retried after the provider's duplicate-protection window. Scheduler and manual sends also use the same key but different payloads.

Resend retains idempotency keys for 24 hours, and reusing a key with a different payload conflicts with the original request. [Resend documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

**Expected:** Uncertain sends are reconciled before retry, and an older worker cannot finalize a newer worker's claim.

**Fix:** Persist an immutable message payload, delivery ID, first-attempt time, and unique lease token. Guard finalization by the lease token. Reconcile uncertain deliveries; route expired uncertainty to manual review instead of blind resend. Use one shared sender. Add mocked provider/database tests for crash-after-send and scheduler/manual overlap.

This is a code-confirmed risk if the processor is used, not evidence that duplicate customer emails have occurred. No external scheduler configuration was inspected.

### 5. Medium: The scheduler marks the initial report sent without checking delivery

**Evidence:** [initial-step shortcut](C:/Users/chado/Documents/arizona-solar-ai/src/lib/follow-up-processing.ts#L199).

For step 1, the processor writes `sent` and says the initial email was delivered. It does not inspect the recorded email result. The public report flow can return a delayed/failed delivery, so these states can contradict one another. The separate `markInitialFollowUpDelivered` helper has no call site in the reviewed source.

**Fix:** Update that step only from confirmed send results, or reconcile it against `email_sent_at` and notification status. Do not turn a provider failure or disabled-email state into a successful delivery.

### 6. Medium: Negative 20-year savings are hidden

**Evidence:** [financial model](C:/Users/chado/Documents/arizona-solar-ai/src/lib/financial-model.ts#L71), [calculation evidence](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/calculations.json).

**Reproduced:** $100 monthly bill, $1,000 annual modeled savings, $30,000 total solar payments. The model returns $32,244 without solar and $42,244 with solar, but `totalSavings` is $0 rather than -$10,000.

**Fix:** Preserve signed net benefit. Show an additional-cost warning when negative, with consistent wording in buy/loan/lease comparisons and reports. This correction does not require changing electricity rates or tax assumptions.

### 7. Medium: Editing the address during lookup can open the old property

**Evidence:** [selection handler](C:/Users/chado/Documents/arizona-solar-ai/src/components/address-search.tsx#L168), [editable input](C:/Users/chado/Documents/arizona-solar-ai/src/components/address-search.tsx#L425), [browser diagnostics](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/diagnostics.json).

**Reproduced in a 393 x 852 browser:** Select `1234 Test Solar Way`, delay its details response, then change the input to `9876 Different Test Street`. When the old response arrives, navigation opens the first property.

**Expected:** The latest user input wins, or editing is explicitly disabled while resolving a selection.

**Fix:** Cancel the selection on edits and use a request-generation guard before calling `onSelect`. The mobile native `HomeScreen` also needs this protection: its selection handler does not guard concurrent selections, while suggestion presses and keyboard submit remain available.

![Address changed while the old lookup is pending](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/address-edited-during-lookup.png)

![Navigation opened the prior address](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/stale-address-opened.png)

### 8. Medium: The 3D selection and financial selection are different

**Evidence:** [3D selection](C:/Users/chado/Documents/arizona-solar-ai/src/components/roof-scene-3d.tsx#L281), [energy selection](C:/Users/chado/Documents/arizona-solar-ai/src/lib/solarPanels.ts#L380).

The 3D renderer selects a cohesive group of panels. The fallback financial model sums the first N provider-ranked panels. In a synthetic mixed-plane example, the displayed 10-module group totals 9,000 kWh while the estimate uses 9,200 kWh.

**Fix:** Share the selected panel IDs and their production across both systems. Otherwise label the visualization as a different sample design and avoid implying that its production was calculated. Prefer the shared-selection approach.

The preliminary ceiling is an area-based planning allowance, not a geometric proof that every selected module respects site-specific setbacks. The UI appropriately retains installer-verification language. Real roof geometry, mounting clearances, usable planes, and manufacturer-specific packing still need representative real-data validation.

### 9. Medium: Re-requesting a report drops an existing utility-bill reference

**Evidence:** [update payload](C:/Users/chado/Documents/arizona-solar-ai/src/app/api/leads/route.ts#L558), [same-record update](C:/Users/chado/Documents/arizona-solar-ai/src/app/api/leads/route.ts#L619).

`utility_bill_file_path` is set to null for every submission before the payload is used to update a matching existing lead. A repeat request without a replacement upload therefore loses the previous reference. The finalized object is not in the pending folder that the cleanup job processes.

**Fix:** Preserve the old reference unless a new upload is successfully finalized or an explicit removal is authorized. Atomically replace the reference; handle removal of superseded objects separately. Test repeat submission, replacement failure, and cleanup behavior in an isolated storage fixture.

### 10. Medium: Native sharing discards the customized estimate

**Evidence:** [native share handler](C:/Users/chado/Documents/arizona-solar-ai/mobile/src/components/AnalysisScreen.tsx#L291), [share URL builder](C:/Users/chado/Documents/arizona-solar-ai/mobile/src/config.ts#L23).

Native sharing sends only the address. Bill, panel count, module, inverter, and battery settings from the WebView are not sent back to the native component. The recipient gets a fresh default estimate, not the customized one. This is established by tracing the code, not by a physical iOS share-sheet test.

**Fix:** Pass a validated, canonical share URL through a typed native bridge. Exclude contact information and private report credentials. Verify parity with the website's share flow.

### 11. Medium: Native loading indicator waits on the wrong event for non-estimate pages

**Evidence:** [load-end fallback](C:/Users/chado/Documents/arizona-solar-ai/mobile/src/components/AnalysisScreen.tsx#L217), [unconditional loading start](C:/Users/chado/Documents/arizona-solar-ai/mobile/src/components/AnalysisScreen.tsx#L409).

Every document navigation turns on the roof-model loading UI, but only an `analysis-status` message ends it immediately. Same-origin report and other pages do not necessarily emit that message, so they can retain the roof-model loading indicator until the 30-second fallback. The overlay is not touch-blocking, but its message is misleading.

**Fix:** Distinguish estimate readiness from ordinary document load completion. Reset section selection when leaving the estimate. Confirm report, refresh, PDF return, offline retry, and Back behavior in TestFlight.

### 12. Medium: Dependencies need a reviewed maintenance pass

Root audit reported `nanoid` as high and `fflate` as moderate. `npm ls` traced `nanoid@3.3.16` through PostCSS/Tailwind and `fflate@0.6.10` through `three-stdlib`. Another `fflate@0.8.3` copy was also present. These are package audit classifications, not proof of a reachable public exploit.

Mobile audit reported 12 moderate package entries, many cascading through Expo CLI/config/build packages. Some suggested automatic fixes proposed older major Expo versions. Do not run `npm audit fix --force` blindly.

**Fix:** Investigate runtime reachability, update compatible transitive dependencies, and validate web build, 3D loaders, Expo checks, and a native export. Distinguish build-tool exposure from shipped mobile runtime exposure.

## Coverage Gaps And Maintenance

- The existing browser suite uses a fixed mocked lead response. Its passing report test does not validate the actual server calculations or PDF output; finding 2 demonstrates the gap.
- The 3D browser assertions check canvas presence, DOM counts, dimensions, and overflow, not visible panel pixels or geospatial accuracy. The synthetic DSM and roof pitch are not a surveyed house. Blank/occluded modules in fixture screenshots cannot establish a production geometry defect or a successful visual rendering check.
- No real iPhone, iOS keyboard, VoiceOver, native PDF/file picker, App Store build, or Android hardware was available for this pass. TypeScript and web emulation do not replace those checks.
- No production database policies, cron registrations, provider delivery receipts, real report PDFs, or installer quotes were inspected. The SQL definitions were reviewed, not applied or verified against production.
- Current prices are modeled installed-cost assumptions, not live installer quotes. Manufacturer specifications and current tax/tariff applicability were not independently re-researched during this repository review.
- No fresh controlled performance benchmark was completed. Existing deferred modules/video and geometry tests are useful, but mobile CPU/GPU idle load and real-device interaction latency need measurement. Do not infer a performance score from fast mocked responses.
- The working tree contains generated browser artifacts, video outputs, and a nested video `node_modules` directory as untracked content. The root ignore pattern only covers root dependencies. Review ignores/staging deliberately before a push.
- No `.github` CI workflow was present. Add release checks and a server/contract test job before treating the current passing suite as a deployment gate.

## Recommended Order

1. Protect lead ownership and preserve existing uploads. Add isolated database contract tests before deployment.
2. Unify panel selection, production, savings, and saved-report math. Include sparse configurations and negative net-benefit scenarios.
3. Reconcile follow-up deliveries and add crash/concurrency tests; distinguish sent from unknown/failed.
4. Fix address cancellation, native share parity, and non-estimate loading behavior.
5. Review dependency updates without forced framework downgrades, then add CI and stronger visual/geometry coverage.
6. Run native-device QA and a controlled performance benchmark before the next store build.

## Reproducible Evidence

- [Diagnostic script](C:/Users/chado/Documents/arizona-solar-ai/scripts/project-review-evidence.ts)
- [Math reproductions](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/calculations.json)
- [Browser and authorization diagnostics](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/diagnostics.json)
- [Native-injected web viewport capture](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-2026-09-04/native-web-content-393x852.png)
- [Playwright report](C:/Users/chado/Documents/arizona-solar-ai/playwright-report/index.html)

Run the math-only evidence script with `npx tsx --conditions=react-server scripts/project-review-evidence.ts --math-only`. Its browser mode requires an already running local server and refuses non-local hosts. It records observed defects; it is intentionally not a replacement for regression tests asserting the corrected behavior.
