# Project Review Fixes

September 4, 2026. Local fixes for the 12 priority findings in
[the original review](C:/Users/chado/Documents/arizona-solar-ai/docs/project-review-2026-09-04.md).
No deployment, Git commit, database migration, production data access, or real notification was performed.
Pre-existing working-tree changes were preserved.

## Resolution Board

| Finding | Implemented correction | Verification |
| --- | --- | --- |
| 1. Anonymous lead overwrite | Public submission is insert-only. Contact matching no longer grants update access. Database duplicate conflicts return a generic 409 without disclosing an existing report URL. | Actual route invoked with mocked Supabase; duplicate and changed-email/same-phone cases cannot read or patch an existing homeowner. |
| 2. Saved report doubles output | Trusted server rebuild uses the same active-estimate model and original signed roof as the UI. Module wattage is applied once. | Live, trusted, serialized, and persisted contracts across all six catalog modules and multiple counts. |
| 3. Sparse configuration plateaus | Shared selected-panel energy totals the selected cohort; missing per-panel data uses interpolation between aggregate configurations rather than a neighboring system's whole output. | Exact, intermediate, below-minimum, above-maximum, and zero-production regressions. |
| 4. Unsafe interrupted follow-up retries | One sender for manual and scheduled sends, atomic claim, claim-time guarded finalization, provider reference on acceptance, and terminal `needs_review` for uncertain/interrupted outcomes. Scheduling again does not reset existing rows. | Mocked concurrent claims, provider timeout, accepted-send/database-failure, expired recovery, and stale-worker finalization tests. |
| 5. False initial-email success | Initial status requires a valid recorded `email_sent_at`; scheduling or processing alone never fabricates email acceptance. | Confirmed, missing, and invalid timestamp cases; unconfirmed processing never invokes the email sender. |
| 6. Hidden negative savings | Signed 20-year net benefit flows through calculation, persistence, roof summary, dashboard, and PDF labels. Loss warnings are limited to modeled cash/loan scenarios, not unquoted leases. | Negative $10,000 fixture retained; browser regression for loss warning and lease exclusion. |
| 7. Stale address lookup | Editing aborts pending details and invalidates stale autocomplete work. Duplicate native selections are guarded. Failed details cannot navigate with an unverified prediction. | Browser delayed-response cancellation and failed-details tests; native typecheck/export. |
| 8. 3D/financial panel mismatch | Financial output and PDF overlay use the cohesive selector already used by 3D, with selected module dimensions. | Mixed-plane fixture: displayed cohort and modeled energy both 9,000 kWh. Physical placement accuracy is not asserted. |
| 9. Existing bill reference lost | Insert-only anonymous submissions cannot clear or replace an existing homeowner's bill reference. Only a newly created row receives this submission's upload metadata. | Public-route regression rejects any old-row patch or storage access. |
| 10. Native sharing drops settings | Web estimate sends its canonical URL to native; native accepts only same-origin public estimate settings and excludes tokens/contact fields. | Allowlist/unit tests; actual web bootstrap at 393 x 852 preserves bill, panel count, and module in share messages and after refresh. |
| 11. Wrong native loading event | Ordinary documents finish on document load; estimate documents wait for analysis readiness. Completion/error/retry clear fallback timers. Estimate-only tabs hide and reset on other pages. | Document classification tests, mobile typecheck and iOS export; physical WebView lifecycle testing remains required. |
| 12. Dependency advisories | Compatible transitive updates/overrides address nanoid, fflate, XML, UUID, and related tooling findings without forcing an Expo downgrade. | Root/mobile audits, production web build, native export, and Xcode UUID compatibility smoke check. |

## Measured Corrections

Synthetic fixture results, not installation guarantees or live property estimates:

| Scenario | Before | After |
| --- | --- | --- |
| 10-panel saved annual production | 13,600 kWh, versus 6,800 on screen | Both 6,800 kWh |
| 10-panel saved annual savings | $2,108, versus $1,054 on screen | Both $1,054 |
| 11 / 15 / 19 panels with sparse provider configurations | 6,800 / 6,800 / 6,800 kWh | 7,480 / 10,200 / 12,920 kWh |
| Mixed-plane selected cohort | Displayed 9,000 kWh; estimated 9,200 kWh | Both 9,000 kWh |
| Losing 20-year scenario | $0 shown | -$10,000 retained |
| Root production dependency audit | 1 high, 1 moderate | 0 reported vulnerabilities in full audit |
| Mobile production dependency audit | 12 moderate entries | 0 reported vulnerabilities in full audit |

Installed prices, tariff assumptions, tax assumptions, and consent requirements were not changed by these fixes.

[After-fix calculation evidence](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-fixes-2026-09-04/calculations.json)
is separate from the preserved original audit evidence.

## Validation

- Unit/server-contract tests: 143 passing at the latest completed run.
- Web and mobile TypeScript: passed.
- ESLint: passed.
- Next.js production build: passed; local analytics configuration warning remains.
- Expo iOS export: passed, single worker, 610 modules. This is an export, not a signed App Store build.
- Full root and mobile `npm audit`: zero reported vulnerabilities at check time, not a security guarantee.
- Xcode dependency UUID smoke check: passed, 24-character hexadecimal identifier.
- Browser suite: 124 passed in 4.3 minutes on the final rebuilt web app, including Chromium, Firefox, WebKit, tablet, mobile, and small-mobile projects. The added native-bootstrap regression uses a 393 x 852 Chromium viewport, not a physical iPhone.
- Tracked diff whitespace check: passed.

Browser runs use mocked paid services and submissions, disabled real email/solar requests, and a loopback database endpoint.
No real homeowner report was generated or modified.

An intermediate run had 123 passes and one WebKit click/scroll timeout on the retry button. The test now explicitly scrolls the button into view and asserts viewport presence before clicking, without forced clicks or weakening the exactly-one-retry assertion. The complete rerun passed. The intermediate failure remains recorded rather than being discarded.

- [Final browser results](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-fixes-2026-09-04/final-browser-results.json)
- [Intermediate browser results](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-fixes-2026-09-04/intermediate-browser-results.json)
- [Native-width savings screenshot](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-fixes-2026-09-04/native-estimate-393x852.png)
- [Negative net-benefit screenshot](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/project-review-fixes-2026-09-04/negative-net-benefit.png)

## Operational Tradeoffs

- Repeat anonymous submissions no longer edit existing reports. A duplicate rejected by the existing database constraint receives 409 and guidance to use the original link or support. Verified homeowner editing is a separate future feature, not an identity check invented from matching contact details.
- `needs_review` means an operator must reconcile the provider result before any deliberate resend. There is no automatic retry of an uncertain send, including after the provider's deduplication window. Legacy `failed` entries also need manual review rather than blind retry.
- Existing report snapshots and stored financial values were not backfilled. These corrections apply to newly generated estimates/reports; historical repairs require a separately approved, scoped data process.

## Remaining Release Checks

- Physical iPhone/TestFlight: keyboard behavior, sharing, navigating to reports, Back, refresh, PDF return, offline retry, and VoiceOver. Browser injection and TypeScript do not prove native behavior.
- Actual PDF rendering with representative saved reports, especially long text and negative values. PDF data/selection/label code was corrected, but this pass did not visually validate a protected production PDF.
- Isolated staging database/storage/provider integration: real constraint and claim behavior, delivery receipts, and upload lifecycle. Mocked contracts cannot prove deployed schema or provider configuration.
- Real roof geometry, surveyed setbacks, shading, and installer pricing remain outside this synthetic regression pass. The preliminary-design disclaimer remains necessary.
- No new controlled performance benchmark, CI workflow, or App Store submission was completed as part of these 12 fixes.
