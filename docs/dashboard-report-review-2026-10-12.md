# Dashboard and report workflow review

Review date: October 12, 2026 (America/Phoenix).

## Scope and outcome

This is a focused implementation and verification pass, not a whole-project certification. Scope: dashboard access, lead status management, dashboard analytics, saved report navigation, PDF generation, initial report email, retry safety, and adjacent follow-up input validation.

The main problems were unsafe retry behavior, stale lead editing, misleading report navigation, and inconsistent legacy report values. The review and browser tests used local synthetic data. No real email was sent or production record changed during testing. No dependencies or migrations were added. Unrelated marketing/video files were left untouched.

## System boundaries

- Next.js App Router application with server routes, a shared administrator dashboard session, Supabase storage, and Resend email.
- Dashboard authorization is a shared administrator credential, not a multi-tenant account system. Separate customer-account isolation was not claimed or tested.
- Public lead submission verifies roof-analysis evidence before saving a report snapshot and sending notifications.
- Saved report access uses a dashboard session or a report-specific signed link. The saved PDF must not silently substitute a new property analysis.
- The browser preview used 64 synthetic lead records and 12 synthetic follow-ups on loopback ports 3101/3201. Email, paid solar calls, attribution, analytics, and external API keys were disabled or replaced for this preview.
- Browser testing used Chromium-based in-app browser viewports of 1440 x 960 and 393 x 852. This was not physical iPhone or Safari testing.

## Confirmed problems and fixes

### High: dashboard cookie parsing and origin validation

Malformed percent encoding in a session cookie could throw a URIError. A separate code path treated the mere presence of an Authorization header as explicit-token authentication, even if authentication actually fell back to the session cookie. That could skip the cookie request-origin check.

Fix: invalid cookie encoding fails closed; only a successfully verified explicit token bypasses the cookie-origin branch. Authentication, token comparison, and origin restrictions remain enforced.

Files: `src/lib/dashboard-auth.ts`, `tests/dashboard-auth.test.ts`.

Verification: malformed cookies return 403 instead of throwing; a valid cookie plus an invalid bearer token and foreign origin returns 403. The malformed-cookie regression failed against the original implementation. The origin case passed after the fix; it was not independently run against the original implementation.

### High: stale lead editing and incomplete UI reconciliation

The status endpoint did not check whether the record changed after the dashboard loaded. The client applied the selected status but did not reconcile the database's saved timestamp, leaving derived stale-lead indicators outdated.

Fix: the client sends its known `updated_at`; the server uses it as a compare-and-set condition, returns 409 on a conflict, and returns the persisted timestamp on success. The client validates the response, updates the saved timestamp, rolls back failed optimistic edits, and uses a synchronous per-lead pending guard against repeated events.

Files: `src/app/api/leads/status/route.ts`, `src/components/dashboard-crm.tsx`, `tests/lead-status-route.test.ts`.

Verification: the original test failed on the unchanged timestamp. The fixed test proves a stale request cannot perform a second write. Browser testing confirmed one saved status survives reload, a second stale tab receives the refresh warning, and a saved Test Lead is excluded from the production cohort after reload. The fixture's stored row independently confirmed Test Lead status.

Compatibility: older callers that omit `expectedUpdatedAt` retain their existing behavior. The current dashboard supplies it whenever a saved timestamp exists. Other writes, including PDF engagement updates, can cause a conflict; refreshing resolves it without silently overwriting the record.

### High: duplicate report-email retries and false delivery success

Concurrent report retry requests both called the provider. A response without a message ID could be treated as successful, and a failed status write after provider acceptance was ignored. Retrying an already-sent lead could also repeat delivery or overwrite its prior timestamp.

Fixes:

- Reserve initial delivery in `notification_status` when inserting a lead.
- Claim retry delivery atomically before contacting the provider, matching the prior delivery and lead status.
- Do not resend reports with confirmed acceptance; preserve the saved timestamp.
- Refuse retry delivery for Test Lead records.
- Require a nonempty provider message ID before reporting acceptance.
- Treat missing responses, SDK network failures, and server errors as uncertain acceptance rather than safe-to-repeat rejection.
- Persist `homeowner_email_needs_review` for uncertain acceptance. A failed durable finalization leaves `homeowner_email_sending` in place, blocking blind retry.
- Return a service-unavailable result for a database outage rather than incorrectly calling the lead missing.
- Tell the homeowner when delivery is unconfirmed and give the saved report link without encouraging another submission.
- Preserve unknown savings as unknown in retry email input rather than converting missing data to zero.

Files: `src/app/api/leads/route.ts`, `src/app/api/report/email/route.ts`, `src/lib/notifications.ts`, `src/lib/report-email-status.ts`, and related delivery/submission tests.

Verification: before the claim fix, two simultaneous requests produced two mocked provider calls. Afterward they produce one. Tests cover already-confirmed delivery, Test Lead suppression, missing provider ID, network response loss, accepted email followed by a database finalization failure, and lookup outage. All network destinations in these tests are mocked and asserted; no real email was sent.

Important: provider acceptance is not proof of inbox delivery. Interrupted claims deliberately require manual reconciliation instead of an automatic timeout-based resend.

### Medium: Open Report started a new estimate

Both dashboard report links pointed to `/estimate?address=...`, ignoring the saved report ID and its recorded selections. The browser exposed this incorrect destination.

Fix: row and detail-panel links now open `/report/{leadId}`, where existing dashboard authentication protects the saved report.

Files: `src/components/dashboard-crm.tsx`, `tests/dashboard-workspace.test.ts`.

Verification: the new rendered-markup test failed before the fix and passed after it. In the browser, Open Report opened the correct synthetic homeowner's saved report, and its download link returned a readable 10-page PDF.

### Medium: legacy PDF disagreed with the saved energy offset

The browser report showed a saved 80% energy offset, but the downloaded PDF showed a newly computed 100% because its fallback preferred recalculation over `energy_offset_pct`.

Fix: the precedence is now snapshot coverage, saved lead coverage, then calculation only when neither saved value exists. An explicit zero is preserved.

Files: `src/app/api/report/pdf/route.ts`, `tests/report-pdf.test.ts`.

Verification: the regression failed before the change for a saved 80% value. After the fix, both 80% and 0% cases pass. A second browser download was rendered with Poppler and visually confirmed as 80% on the cover. Only the downloaded cover was visually inspected; automated PDF checks also cover 10-page generation, text bounds, authorization, missing geometry, and serialization failure.

### Medium: invalid follow-up action names could reach storage

The `in` operator accepted inherited object properties such as `constructor` as valid action names.

Fix: use `Object.hasOwn` for the action allowlist.

Files: `src/app/api/leads/follow-up/route.ts`, `tests/lead-follow-up-validation.test.ts`.

Verification: the original request reached storage and returned 500; the corrected route returns 400 for `constructor`, `__proto__`, and an unsupported action without a lead-data request.

### Medium: rejected dashboard token had no visible feedback

Submitting an invalid token returned to `/dashboard?access=denied` with an unchanged sign-in form, leaving the user unsure what happened.

Fix: show a specific alert, connect it to the password input with `aria-describedby`, and mark the input invalid. The label now correctly identifies this as the lead dashboard rather than a homeowner dashboard.

File: `src/app/dashboard/page.tsx`.

Verification: reproduced through the browser before editing; then verified the visible error and successful sign-in using the synthetic credential. Before and after screenshots were saved.

### Medium: dashboard skip link had no matching target

The shared Skip to main content link pointed to `#main-content`, while the signed-in dashboard only supplied `solar-workspace`.

Fix: add a focusable `main-content` target to the content region, and add the target to the sign-in page.

Files: `src/components/dashboard-workspace.tsx`, `src/app/dashboard/page.tsx`, `tests/dashboard-workspace.test.ts`.

Verification: rendered-markup regression confirms the signed-in focus target. Full keyboard and screen-reader verification was not completed after the browser automation stalled.

### Test harness safety

The preview cleared attribution variables with names different from those used by the application and did not explicitly override all relevant `.env.local` integrations.

Fix: disable outbound effects, clear the actual attribution settings, and use fixture-only signing secrets. The REST fixture now honors the expected timestamp filter so it can reproduce stale writes.

File: `scripts/preview-dashboard-workspace.ts`. This changes only the local preview, not production configuration.

## Feature and test matrix

| Workflow | Outcome checked | Result and boundary |
| --- | --- | --- |
| Dashboard access | Invalid token rejected with feedback; valid fixture token opens dashboard | PASS, real local browser |
| Session misuse | Malformed cookie and cross-origin cookie fallback denied | PASS, route/auth tests |
| Lead status | Saved status and timestamp; stale edit rejected; reload persistence | PASS, route tests, browser, independent fixture read |
| Test Lead classification | Removed from default analytics; available when tests are included | PASS, browser; 54 to 53 production-cohort leads after classification |
| Search and empty state | Filter to one lead; no matches clears selected detail | PASS, desktop browser |
| Analytics | 54 non-test vs 64 including test records at baseline; cohort calculations and unknown values | PASS, browser plus existing unit tests; not production analytics |
| Saved report link | Opens recorded report rather than new estimate | PASS, browser and rendered-markup test |
| PDF download | Saved viewer and dashboard both produce downloads; cover preserves saved 80% | PASS, browser download, PDF parsing and cover render |
| Report creation | Signed model, nullable optional fields, schema fallback and unauthorized access | PASS, isolated existing route regression tests; no full browser submission |
| Email retry | At-most-one claim, uncertain acceptance, database failure and Test Lead suppression | PASS, mocked boundary tests; no provider/inbox delivery check |
| Utility bill | Size/MIME/error redaction protections | PASS, existing route tests; storage round trip NOT RUN |
| Follow-up sending | Claims, consent, interrupted sends, provider uncertainty and Test Lead suppression | PASS, existing isolated regression tests; browser send NOT RUN |
| Delete lead | Native confirmation dialog and cancel path | BLOCKED, in-app browser automation timed out on the dialog; no deletion claimed |
| Mobile layout | Dashboard overview, analytics, pipeline and saved report at 393 x 852 | PASS for inspected views; no physical-device claim |
| Keyboard/accessibility | Labels, visible focus in search, focusable skip target markup | Partial PASS; complete keyboard traversal/screen-reader audit NOT RUN |
| Production/deployment | Live database, real delivery, live analytics and release | NOT RUN; not authorized in this pass |

## Automated verification

- Baseline `npm test`: 323 passed, 0 failed, 0 skipped.
- Final `npm test`: 330 passed, 0 failed, 0 skipped, about 13.1 seconds. This is test-run duration, not a performance benchmark.
- `npm run typecheck`: PASS.
- `npm run build`: PASS with fake database credentials, outbound providers disabled, and analytics disabled. Compilation took 7.6 seconds and the build TypeScript phase 21.6 seconds. No before/after runtime performance gain is claimed.
- `git diff --check`: PASS; Git emitted normal Windows line-ending notices.
- `npm run lint`: PASS with 0 errors and 1 pre-existing warning in the generated `mobile/.eas-inspect/src/components/lead-capture-form.tsx:628` copy (`@next/next/no-location-assign-relative-destination`). The generated copy was not edited.
- Regression tests were added before the relevant fixes and shown to fail for malformed cookies, stale timestamp writes, missing provider acceptance IDs, concurrent email retries, wrong saved-report links, inherited follow-up actions, and legacy PDF coverage.

Local logs: `.dev-logs/dashboard-review-tests.log`, `.dev-logs/dashboard-review-build.log`, `.dev-logs/dashboard-review-lint.log`. Logs are ignored artifacts, not release files.

## Evidence

Evidence folder on the test machine:

`C:/Users/chado/.codex/visualizations/2026/05/27/019e66d8-d28d-7910-8459-e548bc1b2ed5/dashboard-review-2026-10-12/`

- `login-before.jpg` and `login-after.jpg`: rejected-token feedback.
- `overview-desktop.jpg`, `overview-mobile.jpg`, `analytics-mobile.jpg`: inspected responsive views with synthetic data.
- `status-conflict.jpg`: stale-edit error in the second tab.
- `pipeline-mobile-test-lead.jpg`: synthetic lead inspection. Final saved status was additionally checked against the fixture and after reload.
- `report-mobile.jpg`: actual saved-report page opened from the corrected link.
- `pdf-cover.png` and `pdf-cover-after.png`: legacy PDF coverage changes from a recalculated 100% to the saved 80%.

The PDF fixture intentionally has no usable house geometry, so its cover correctly says Roof visual unavailable. This pass does not establish real-property 3D accuracy. The downloaded PDFs are untagged according to `pdfinfo`; no accessible-PDF conformance claim is made. Poppler reported missing display-font aliases, but rendered the inspected covers without visible missing glyphs.

## Remaining risks and next actions

1. **High, release verification:** run one approved staging round trip through real upload storage, lead persistence, signed report retrieval, and an email test inbox. Mocks cannot prove deployed schema, bucket policy, provider setup, or inbox delivery.
2. **High, interruption recovery:** expose initial report-email delivery status and a reviewed reconciliation action to administrators. A stuck sending/needs-review state must be checked against provider evidence before releasing a retry. The current change intentionally blocks uncertain resends; it does not add a reconciliation UI or receipt webhook.
3. **Medium, public submission idempotency:** lost responses between lead insertion and client confirmation can still encourage repeated public submissions. Existing duplicate-constraint behavior is tested, but a complete request-idempotency design across initial lead creation is not implemented here. Confirm the deployed constraints before planning that change.
4. **Medium, legacy report consistency:** the legacy PDF still derives some costs/payback from available fields, while the viewer can use a saved ROI value. The energy-offset mismatch is fixed; a single shared legacy-summary contract for every metric remains worthwhile. Do not infer current snapshot reports are affected without a representative saved fixture.
5. **Medium, accessibility and browser coverage:** complete keyboard/screen-reader checks, native Safari testing, bill viewing, CSV download, pagination, Back/Forward, and delete/cancel browser checks in an unblocked browser session. The native confirm timeout blocked subsequent browser work. Closing that test tab and resetting its viewport also timed out; no real data was in it.
6. **Low, edit friction:** record-wide timestamps can become stale after background/report-engagement writes. The dashboard now gives a safe conflict error, but a future status-specific revision or explicit refresh/retry affordance could reduce unnecessary refreshes.

## Product improvements

- Delivery status and reconciliation view: high value, medium effort; distinguish accepted, uncertain, bounced, and delivered instead of implying all are the same.
- Refresh-and-review conflict action: medium value, small effort; keep the user's intended status visible while requiring review of the newer saved record.
- Shared saved-report summary contract: high value, medium effort; align legacy dashboard, viewer, PDF and email numbers without inventing missing values.
- Replace native delete confirmation with an accessible in-app dialog: medium value, medium effort; improve keyboard focus management, cancellation, and repeatable browser tests.
- Tagged, accessible PDFs with a readable HTML equivalent: medium value, larger effort; the current PDF is visually structured but untagged.

## Release and rollback

No new environment variable, dependency, or migration is required. The retry guard uses the existing `notification_status`, `email_sent_at`, and `updated_at` lead columns already declared in `supabase/leads.sql`; confirm that existing schema is installed before releasing. A missing required retry column causes a service-unavailable response rather than sending without a guard.

All changes are ordinary source/test changes and can be reverted selectively. Do not remove uncertain delivery state or automatically requeue it during a rollback: that could repeat an email whose acceptance was lost. Review provider evidence first. The synthetic preview processes were stopped; the pre-existing service on port 3100 was not touched.
