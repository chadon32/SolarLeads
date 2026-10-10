# Customer Feature Audit

Date: 2026-09-22

## Outcome

The local browser audit covered the customer estimate and report workflows with Chromium, using the guarded development server at `http://localhost:3101`. All API traffic in the new audit was intercepted with the synthetic fixtures in `tests/helpers/network.ts`; no production lead, email, upload, paid scan, or authentication request was made.

The final combined browser run was:

- `26 passed, 0 failed` in 1.5 minutes.
- `tests/e2e/feature-repair-audit.spec.ts`: `19 passed` consisting of 9 desktop journeys at 1440 x 900, 9 mobile journeys at 393 x 852, and 1 desktop storage-failure regression.
- `tests/e2e/report.spec.ts`: `7 passed` in the same run.
- The earlier broader existing-suite batch was `45 passed, 1 failed`. The only failure was the existing roof-analysis camera-controls test expecting a satellite map when the local build has no Google Maps browser key; the app displayed its explicit missing-key fallback instead.

The confirmed application issue was the lead storage failure described below. It was fixed in the owned lead form and now has a passing regression test.

## Confirmed Finding

### P1 fixed: successful lead save was reported as a network error when browser storage failed

Reproduction before the fix:

1. Open a ready synthetic estimate and the Send Report form.
2. Fill the required report fields.
3. Make `Storage.prototype.setItem` throw before submitting.
4. Submit once against the mocked successful `/api/leads` response.

Expected: the confirmed server result remains visible, the secure `reportUrl` remains usable, no second submission is required, and the email delivery status is communicated accurately.

Actual before the fix: the mocked lead request succeeded, but the same `try` block then allowed a browser storage exception to reach the network-error handler. The form showed `Network error. Please try again.` instead of the saved report confirmation, making a retry or duplicate request likely.

Pre-fix browser error context: `qa-evidence/feature-repair-2026-09-22/new-test-results/feature-repair-audit-mocke-9044c-ient-storage-is-unavailable-chromium-desktop/error-context.md`.

Fix in `src/components/lead-capture-form.tsx`:

- Save the server-confirmed `SavedLead` in React state before analytics and browser-storage side effects.
- Guard referral `sessionStorage.getItem`, both `sessionStorage.setItem` calls, and `localStorage.removeItem`.
- Keep the normal redirect to `/thank-you` when storage succeeds.
- When storage cannot persist, render an in-memory confirmation on the current page instead of navigating to an empty thank-you state or showing a network error.
- Render the working server-provided report link and choose sent versus delayed email copy from `emailDeliveryStatus`.
- Focus the newly mounted confirmation heading with a ref/effect and `tabIndex={-1}`, so keyboard and screen-reader users are not left at the document body after the form unmounts.
- No new cookies or URL personal information were added.

Post-fix regression: `tests/e2e/feature-repair-audit.spec.ts` asserts the current estimate remains mounted, the `Your solar report is ready.` heading is visible and focused, the report link equals the mocked `reportUrl`, the storage warning is visible, no `Network error` appears, and exactly one `/api/leads` request was sent.

Post-fix screenshot: `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-storage-failure-after-save.png`.

## Browser Coverage

| Area | Checks performed | Result |
| --- | --- | --- |
| Personas | Salesperson, inexperienced homeowner, young couple, professional installer at both desktop and 393 x 852 mobile sizes | 8 persona journeys passed |
| Address and start state | Blank bill blocks analysis, valid synthetic address reaches estimate, ready estimate navigation | Passed with safe fixtures |
| Electric bill | Blank value, upper-bound invalid value `5001`, edited bill reflected in savings | Passed; existing electric-bill suite also included in the 45-pass batch |
| Upload | Unsupported text file rejected without an upload request; mocked 500 upload shows retryable error | Passed at both viewports; no real storage used |
| Roof 3D and layers | 3D canvas, panel layer off/on, sunlight layer, panel count changes, module selection on desktop | Passed with synthetic roof fixture |
| Roof and sunlight | Roof and shade content, installer checklist, sunlight tab, missing Maps-key fallback, mobile compact map controls | Passed; live satellite map is not proven without a real Maps key |
| Equipment and savings | Panel counts 10, 12, and 19; module selection; battery toggle; savings bill edit | Passed with synthetic analysis |
| Financing | Loan selection, APR/down-payment controls, term change, illustrative/non-offer disclosure | Passed at both viewports |
| Report validation | Empty submit, focused error summary, field errors, corrected-field behavior | Passed in the new audit and existing report suite |
| Report error and recovery | First mocked lead response 500, actionable error, second mocked success, expected thank-you redirect | Passed at both viewports |
| Storage recovery | Successful mocked lead followed by forced client storage failure, inline confirmation, focused heading, report link, one request | Passed |
| Back and refresh | URL state for bill/panels/module, reload restoration, browser back to home and forward to estimate | Passed at both viewports |
| Accessibility | Serious automated violations on ready estimate, error-summary focus, confirmation focus, mobile labels and controls | No serious axe violations in the new audit; this is not a full WCAG certification |
| Overflow | Document width checked at both viewports through persona and navigation journeys | No horizontal overflow observed |

## Persona Notes

- Salesperson: verified disabled blank start, valid address, 3D panel visibility, layer toggles, desktop module selection, and savings adjustment.
- Inexperienced homeowner: verified blank report submission gives a focused review summary and field-level required errors.
- Young couple: verified reduced panel count, battery addition, financing controls, and non-offer disclosure.
- Professional installer: verified roof and shade explanation, installer checklist, sunlight fallback/map state, 3D layer, and mobile map-control disclosure.

## Evidence

Representative desktop screenshots:

- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-salesperson-savings.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-inexperienced-homeowner-report-validation.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-young-couple-financing.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-professional-installer-sunlight.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-invalid-bill.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-upload-error-retry.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-refresh-restored.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-report-error-recoverable.png`
- `qa-evidence/feature-repair-2026-09-22/desktop-1440x900-storage-failure-after-save.png`

Representative mobile screenshots use the matching `mobile-393x852-` names in the same directory for each persona, bill, upload, refresh, and report-error journey.

The existing Maps-key limitation is recorded at `qa-evidence/feature-repair-2026-09-22/existing-test-results/roof-analysis-camera-contr-1576f--and-leave-the-map-deferred-chromium-desktop/test-failed-1.png`.

Playwright reporter output for the final combined run is in `qa-evidence/feature-repair-2026-09-22/final-report-and-audit-results`.

## Limitations and Risks

- Synthetic API mocks prove UI behavior and request handling only. They do not prove live Maps, Supabase, email delivery, upload storage, Turnstile, PDF generation, signed-link expiry, or provider availability.
- The missing Google Maps browser key forced the explicit sunlight fallback. The existing camera-controls expectation for a rendered satellite map therefore failed; this is recorded as a fixture/environment limitation, not a confirmed application defect.
- Roof geometry, panel placement, savings, and financing values are synthetic. This audit does not validate roof accuracy or financial correctness against a live provider.
- The storage-failure confirmation is intentionally in-memory. If a user refreshes after browser storage is unavailable, the page cannot restore that transient confirmation; the regression verifies that no resubmission is needed during the failed-save interaction itself.
- No real authentication was bypassed and no live dashboard owner workflow was exercised.
- PDF route integration and visual rendering are owned by the root worker and were not duplicated here. The report tests use safe mocked report links.
- Automated accessibility coverage checks serious axe violations and key focus paths only; it is not a complete manual or WCAG audit.

## Checks

### Lead verification after worker completion

- Production build: passed. The lead reran `feature-repair-audit.spec.ts`, `report.spec.ts`, and `roof-analysis.spec.ts` against `npm start` on localhost:3101: **33 passed, 0 failed** in 1.3 minutes.
- The previously blocked camera/Maps test passed on this production build with the configured browser-key path and intercepted Maps script. This proves the mocked map integration, not live Google availability.
- Mobile WebKit: `audit-report-mobile.spec.ts`, **2 passed**, including 393 x 852 navigation/touch targets and a synthetic bill upload followed by report submission.
- Visual evidence follow-up: **3 passed**, with the confirmation explicitly asserted inside the viewport and screenshots taken with CSS animations disabled. Added full 3D scene images after camera use and canvas measurement, rather than relying on a potentially transitional viewport capture.
- Model screenshots: `desktop-1440x900-professional-installer-3d-model.png` and `mobile-393x852-professional-installer-3d-model.png` in the evidence directory above. These show the synthetic fixture, not a measured customer property.
- Production results: `qa-evidence/feature-repair-2026-09-22/production-results`; mobile results: `webkit-results`; visual follow-up: `visual-confirmation-results`.
- See `docs/pdf-and-feature-audit-results-2026-09-22.md` for PDF, snapshot, viewer, unit and build verification. The temporary local servers were stopped after testing.

### Worker verification

- Final combined browser run: `26 passed, 0 failed`.
- New audit run: `19 passed, 0 failed`.
- Existing report suite in the final combined run: `7 passed, 0 failed`.
- Existing broader browser batch: `45 passed, 1 Maps-key fixture limitation`.
- Typecheck passed after the lead-form storage fix.
- Targeted ESLint passed with one pre-existing Next warning for the existing `window.location.assign("/thank-you")` navigation.
- No commit, server stop, deployment, production write, or real external request was performed.
