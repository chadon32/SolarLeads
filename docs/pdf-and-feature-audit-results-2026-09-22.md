# PDF and feature repair results

Date: 2026-09-22. Local changes only. No deployment, commit, database migration, real lead, paid roof scan, email delivery, or real bill upload performed.

## Executive outcome

The PDF now presents a perspective roof illustration with selected modules on the cover and panel-layout page instead of the old satellite panel-overlay stack. Name, address, date, readiness, equipment, footers, QR code and disclosures have bounded layout regions. The ten-page document remains available even when external imagery or saved geometry is missing.

This is a saved-data roof illustration, not a screenshot of the interactive elevation-scan model. Roof heights are inferred from pitch and a shared illustrative base height. The report explicitly states the approximation. It does not fabricate windows, doors, textures, measured house height, or a generic replacement roof when geometry is missing.

The feature audit also reproduced and fixed a report submission failure caused by browser storage throwing after a successful server save. Saved report normalization and the web report preview now distinguish unknown figures from real zero values more carefully.

Three Luna Max workers handled independent geometry, browser-audit/submission, and saved-snapshot assignments. The lead integrated the results, reviewed the patches, fixed additional data/visual issues, and ran the production-build checks. Detailed plan: `docs/pdf-and-feature-repair-plan-2026-09-22.md`.

## Findings and changes

| ID | Severity | Before / reproduction | Expected and implemented behavior | Evidence |
| --- | --- | --- | --- | --- |
| PDF-01 | High | Generate a report with a long date/name/address; fixed-coordinate header fields could collide, including date and readiness in the user's screenshot. | Separate bounded identity/date/readiness regions, fitted text, predictable hierarchy and margins. | `output/pdf/after/standard-01.png`, `long-01.png`; long-text bounds regression |
| PDF-02 | High | Open the old cover/layout page; bright satellite overlays and repeated badges obscure the property and look unlike the 3D view. | Saved face/panel geometry rendered as restrained perspective vectors. Counts show placements drawn versus selected; no speculative replacement modules. | `standard-01.png`, `standard-04.png`; six illustration tests |
| PDF-03 | High | Download an incomplete legacy snapshot; generic fallback geometry could become a seemingly valid saved roof. | Reject absent/malformed persisted outlines; retain available report figures, use genuine satellite context if obtainable, otherwise show an explicit unavailable state. | `missing-01.png`, `missing-02.png`; snapshot and PDF tests |
| PDF-04 | High | Use a saved zero savings/offset/pitch or a bill with null value; truthiness/numeric coercion could replace zero or treat missing as zero. | Preserve zero where meaningful; retain missing bill separately; stale counts are clamped; selected module dimensions and production stay aligned. | `tests/report-snapshot.test.ts`, `tests/report-pdf.test.ts` |
| PDF-05 | Medium | Sunlight hours derived from kWh divided by kW, which measures specific yield rather than recorded sunlight hours. Missing sunlight could also appear as LOW. | Use saved annual sunlight hours. Missing hours show Unavailable, not poor sunlight; legacy advisor copy no longer invents model findings. | Long fixture asserts 2,050 saved hours; missing fixture rejects LOW/fabricated-model wording |
| PDF-06 | Medium | Induce PDF serialization failure after the download flag is set. | Only update PDF flags after successful serialization; bounded optional database update and image/geocode requests. | Serialization-failure test asserts 500 and zero updates |
| PDF-07 | Medium | Long email/equipment strings, next-step QR, financing caveats and narrow cards can overlap. | Bounded wrapping, full selected model details, spaced QR with accurate destination description, clear report-recipient label and separated disclosures. | All 30 rendered sample pages inspected, including `long-04.png` and `long-09.png` |
| FLOW-01 | High | Successful lead response followed by throwing browser Storage.setItem produced a Network error and invited another submission. | Keep the confirmed result in memory; guard optional storage/analytics, show secure report link, truthful email status, focus visible confirmation; no second request. | Before error context and after screenshot in feature audit; browser regression |
| VIEW-01 | High | Open a legacy web report without stored model metrics, or one with zero savings. Viewer could show default zero/estimated values or mark a real zero unavailable. | Read only recorded snapshot/lead values. Preserve zero savings/count/offset; unknown size/payback/coverage stays Unavailable. | `tests/report-summary.test.ts`; production build |

No new confirmed P0 security/data-loss issue was found in the exercised paths. That statement does not certify untested production integrations or owner dashboard operations.

## Feature coverage and remaining gaps

| Feature group | Verification | Remaining gap |
| --- | --- | --- |
| Landing, navigation, address, electric bill | Existing browser batch and new persona starts/validation; bill changes and URL restoration | Real autocomplete latency/provider quotas not remeasured |
| Roof loading, errors, 3D and layers | Production browser tests cover rate-limit/retry, canvas, selected module dimensions, count, camera controls, keyboard controls, sunlight/panels toggles and deferred map | Real roof accuracy, complex roofs, actual DSM/imagery coverage and physical GPU behavior |
| Panel selection, savings, batteries, financing | Persona browser interactions; unit tests for all catalog modules, count/energy/price consistency, negative net benefit and assumptions | Installer quotes, utility-specific bills and real engineering verification |
| Bill upload | Unsupported type, too-large body and MIME rules; simulated failures/recovery; in-flight cancel; mobile successful synthetic upload and claim submission | Real object-storage credentials, production multipart limits and physical iOS file picker |
| Report request and thank-you | Required-field focus/highlights; one request on success; error/retry; optional follow-up; storage-unavailable recovery | Actual email receipt, live Turnstile and native external-link handling |
| PDF and report access | Real PDF generator with fake Supabase/blocked external fetch; invalid/unsigned access; existing signature/expiry unit tests; long/absent/zero data; visual raster review | Actual customer saved record, real satellite embedding, physical-device PDF download/share and screen-reader PDF reading order |
| Dashboard and follow-up | Existing unit coverage of authentication, dashboard null handling, delivery claims/idempotency, consent and provider failure recovery | Authenticated browser CRM, notes/status edits, owner email and scheduled delivery in staging |
| Native app | Mobile TypeScript, native bridge/unit checks and app=ios web-layout browser test | Installed iOS/Android builds, device keyboard, permissions, share sheet, orientation and memory pressure |
| Accessibility | No serious axe violations on the exercised ready-estimate pages; focus recovery; keyboard camera; 44px report navigation in mobile WebKit | Full manual WCAG audit; tagged accessible PDF structure is not implemented by this redesign |
| Privacy and security | No new PII in URL/cookies; preserved auth/signatures/private PDF headers; synthetic-only submissions | Not a full penetration test or production configuration audit |

The four personas were the salesperson, inexperienced homeowner, young couple and installer. Their targeted journeys were executed separately at desktop 1440 x 900 and mobile 393 x 852. They were not real research participants and did not each independently exercise every administrative function. Full steps and screenshots are in `docs/feature-audit-2026-09-22.md`.

## Verification results

| Check | Result |
| --- | --- |
| Full unit suite | **204 passed, 0 failed** |
| PDF route integration | 6 passing tests, actual generated ten-page PDF, private headers, auth rejection, failure bookkeeping, long/missing/zero values |
| Roof illustration | 6 passing tests for finite projection, mixed faces, selected cohort, no replacement panels, geometry failure |
| Report snapshot | 11 passing tests, including empty placement array with inflated stored count |
| Report web summary | 3 passing tests for unknown/zero/legacy handling |
| Worker final browser run | 26 passed: 19 new audit checks and 7 report checks |
| Lead production-build browser run | **33 passed**, including all seven roof-analysis tests; one-worker Chromium, desktop and 393px mobile |
| Mobile WebKit | **2 passed**, 393 x 852 navigation/touch targets and synthetic upload-to-report flow |
| Visual follow-up | 3 passed; confirmation inside viewport and desktop/mobile 3D canvas captures |
| Earlier broader browser run | 45 passed; 1 development Maps-key fixture failure. Same camera test passed in production-build rerun with intercepted Maps script |
| Web TypeScript | Passed directly and in final production build |
| Mobile TypeScript | Passed |
| Production build | Passed after final PDF text changes |
| ESLint | 0 errors; 2 existing internal-navigation warnings, one in generated `mobile/.eas-inspect` and one in lead form |
| Whitespace diff check | Passed; Git reports Windows line-ending normalization notices |
| PDF visual QA | Normal, long-text, missing-data PDFs: 10 pages each; rasterized and visually inspected, revised and rechecked |

These counts overlap across reruns; they should not be added together as unique feature coverage. Browser APIs were mocked, while the PDF integration used the actual route/generator with synthetic persistence. Poppler emitted missing Symbol/ArialUnicode fallback warnings; rendered Helvetica text was visually readable with no observed missing glyph boxes in the fixtures.

Build notices remain: the existing Edge Runtime declaration is deprecated, and this local environment lacks a Google Analytics measurement ID. No tracking ID was invented and no analytics was added. Production analytics configuration was not inspected.

## Before and after artifacts

- Baseline: `output/pdf/before/solartelligence-standard.pdf`, `page-01.png` through `page-10.png`, and long/missing variants.
- Final sample: `output/pdf/after/solartelligence-standard.pdf` using synthetic Alex Example / 1234 Test Solar Way data, not the homeowner in the uploaded screenshot.
- Stress samples: `solartelligence-long.pdf`, `solartelligence-missing.pdf` in the same after directory.
- Final page images: `standard-01.png` through `standard-10.png`, with corresponding `long-` and `missing-` sets.
- Reproduce safely: `npm run pdf:preview -- after`. The harness stubs expected database operations, disables image-provider credentials and rejects unexpected external requests. It does not add a public unauthenticated PDF-preview endpoint.

Baseline standard file was 33,557 bytes. Final standard is 45,791 bytes; long is 47,420 bytes; missing is 31,097 bytes. All remain ten pages. The last local in-process generator timings were 122ms, 47ms and 38ms respectively. These are single offline-fixture observations, not load tests, field performance, or cold production latency. The geometry fixture was strengthened from one to two roof planes during verification, so a performance improvement cannot be claimed from the before/after timings.

## Changed implementation files

| File | Purpose |
| --- | --- |
| `src/app/api/report/pdf/route.ts` | Redesigned PDF layout, vector integration, truthful missing-data/sunlight copy, bounded optional fetches, post-generation bookkeeping |
| `src/lib/report-roof-illustration.ts` | New server-safe perspective roof/panel projection |
| `src/lib/report-snapshot.ts` | Persisted geometry validation, missing/zero handling and count consistency |
| `src/lib/report-summary.ts` | New conservative saved-summary/formatting helpers |
| `src/app/report/[leadId]/page.tsx` | Viewer uses recorded values, not invented fallback metrics |
| `src/components/lead-capture-form.tsx` | Resilient saved confirmation when client storage fails |
| `tests/report-pdf.test.ts`, `tests/helpers/pdf-fixture.ts`, `scripts/preview-report-pdf.ts` | Offline actual-generator harness and regression checks |
| `tests/report-roof-illustration.test.ts`, `tests/report-snapshot.test.ts`, `tests/report-summary.test.ts` | Geometry/data invariants |
| `tests/e2e/feature-repair-audit.spec.ts` | Persona, failure recovery and visual evidence checks |
| `package.json`, `.gitignore` | PDF preview command; keep generated PDFs out of source control |

The checkout already contained substantial uncommitted SEO, feature and video work. It was preserved. A Git diff from HEAD includes those previous changes as well; it is not an isolated patch for this task.

## Prioritized release and improvement plan

| Priority / phase | Action | Effort | Acceptance gate |
| --- | --- | --- | --- |
| P1 / before release | Review the sample and approve a separately scoped deployment containing these fixes | Small | Confirm selected files/branch; build and tests pass; do not publish all unrelated dirty changes inadvertently |
| P1 / staging verification | Run one complete address -> real synthetic bill -> report -> owner CRM -> delivered email -> signed PDF workflow using approved staging credentials | Medium | No duplicate lead; upload claim associated; actual inbox/link/expiry confirmed; errors recover without losing result |
| P1 / native verification | Exercise report PDF and upload on an installed app/physical iPhone and Android device | Medium | Keyboard/file picker work; secure links open; PDF share/download successful; storage-restricted flow remains usable |
| P1 / geometry validation | Review saved examples of flat, gable, hip, split-level, detached garage and complex multi-face homes | Medium | Drawn cohort and module sizes match selections; unavailable/omitted geometry clearly labeled; no claim of construction accuracy |
| P2 / next sprint | If exact 3D visual parity is required, persist a verified render or measured elevation data when the analysis is created | Large | Signed snapshot association, provenance, privacy/retention, reproducible image, bounded worker cost, fallback on failed capture |
| P2 / next sprint | Add a compact printable/light report variant and answer the homeowner FAQ prompts within the PDF | Medium | Legible print contrast, useful answers, tested pagination; preserve current dark branded option |
| P2 / next sprint | Add accessible tagged PDF export or an equivalent fully accessible HTML report with complete content | Medium/Large | Manual screen-reader and reading-order verification, not just visual QA |
| P2 / next sprint | Add staging release smoke tests and privacy-safe report/upload failure observability | Medium | Classify provider, validation, storage and delivery failures without storing bill contents or contact details in logs |
| P2 / next sprint | Reconcile older partial report records only when trustworthy saved data exists | Medium | No bulk fabrication or destructive migration; preserve originals and show partial-data status |
| P3 / maintenance | Migrate the existing deprecated Edge route and replace legacy internal location.assign navigation after dedicated parity checks | Small/Medium | Same image output/native navigation, no build warnings from owned source |

## Rollback and limits

No schema changes were made; report snapshot version remains 1. Existing signed access paths remain. Partial legacy snapshots without persisted outlines now deliberately fall back instead of drawing an invented model. Perspective depth ordering is illustrative and not a full geometry z-buffer; unusual intersecting or different-height roof faces need the explicit complex-roof QA above.

Rollback must revert only this task's changes, not reset the dirty checkout. Keep the preview harness and evidence for comparison; avoid changing or deleting customer records. For a future release, monitor PDF 5xx/timeouts, report saves versus client confirmations, bill rejection reasons and signed-link failures. Production release and App Store resubmission were not performed or implied by these local results.
