# Solartelligence Web Application QA Report

Audit date: July 31, 2026

Production target: `https://solartelligence.com/`

Local test target: production build at `http://127.0.0.1:3100`

Test data: deterministic Arizona fixture and reserved `.test` identity only

## Executive Summary

- Overall score: **86/100**
- Launch-readiness verdict: **Conditionally ready for local release validation; production release still has explicit blockers**
- Most serious issue: the privacy notice still lacks an operational retention schedule and self-service deletion workflow, and the tested local fixes are not verified in production.
- Strongest product area: the roof-analysis workspace clearly distinguishes Solar API data, modeled values, user-adjusted values, and installer-verification requirements.
- Persona most likely to convert: young first-time homeowners.
- Persona most likely to abandon: an inexperienced older homeowner, mainly because of financial terminology, long report density, and uncertainty about data retention.
- Current issue register: **P0: 0, P1 open: 2, P2 open: 3, P3 open: 0**; 16 issues are fixed, 1 is fixed locally pending deployment, and 5 remain open or decision-dependent.
- Automated result: **70/70 Playwright tests passed** in the complete browser/device matrix, including the panel-consistency and report-error-focus regressions.
- Unit result: **108/108 tests passed**.
- Typecheck result: **passed**.
- Lint result: **passed with 2 pre-existing warnings** in `marketing-ad/landscape/scripts/patch-frame3-duration.mjs`.
- Build result: **passed** on Next.js 16.2.12.
- Production dependency audit: **0 vulnerabilities** with `npm audit --omit=dev`.

The core homeowner journey is functional under deterministic mocks and has good estimate-versus-quote wording. The main reasons not to call it fully launch-ready are the privacy lifecycle gap, unverified production deployment/configuration, the intentionally limited installer-grade model, and decisions still needed around marketing consent.

### Regrade Scorecard

| Dimension | Score | Basis |
|---|---:|---|
| User experience | 86/100 | Complete tested journeys pass, with remaining report density and privacy uncertainty. |
| UI quality | 88/100 | Responsive layouts, focus states, touch targets, and hierarchy passed automated checks; some dense technical sections remain. |
| Trust | 78/100 | Estimate disclosures and source labels are strong; retention/deletion and production verification remain open. |
| Conversion | 87/100 | Address-to-report flow is stable and error recovery is covered; support and consent decisions still affect confidence. |
| Accessibility | 92/100 | Axe, keyboard, tab semantics, 200% zoom, and touch-target checks pass; manual screen-reader verification remains. |
| Performance | 82/100 | Build and local flows are healthy, but production Core Web Vitals and real API latency were not measured. |

These scores are a local release-candidate assessment, not a production availability or installer-design certification.

## Scope And Safety

Executed:

- Production read-only smoke review of the homepage, privacy notice, and terms.
- Local browser workflows with all paid and state-changing APIs mocked.
- Chromium, Firefox, and WebKit coverage.
- Desktop, laptop, tablet portrait, tablet landscape, mobile, and 320 px small-mobile coverage.
- Automated Axe checks, keyboard use, 200% zoom, touch-target checks, console monitoring, and API error simulations.
- Code inspection of calculations, auth, report signing, rate limits, lead persistence, consent, notifications, uploads, and PDF access.

Not executed:

- No production lead was submitted.
- No real homeowner, installer, email, phone, or address data was used.
- No real Google Solar or mapping request was triggered by the test suite.
- No real email, notification, utility upload, or database mutation was performed.
- No destructive deletion or production admin action was performed.
- No financing application or credit decision exists in the tested flow.

## Persona Results

### Marcus: Door-To-Door Solar Salesperson

- Device: 390 x 844 smartphone.
- First impression: premium and focused; the purpose is understandable without scrolling.
- Steps attempted: address search, mocked roof analysis, panel/savings explanation, section navigation, share path, restart path, and error recovery.
- Steps completed: all safe local workflows.
- Time required: under three minutes in the deterministic local flow; real API latency was not measured.
- Confusing moments: the report is information-dense for a doorstep conversation, and financing assumptions require explanation.
- Errors encountered: none after the fixes; slow/error responses produced recoverable messages.
- Trust-building moments: source badges, preliminary language, installer-verification copy, and visible roof confidence.
- Abandonment risks: outdoor readability of muted text, long scrolling, and any mismatch between map panel count and financial metrics.
- Final decision: useful sales-assist preview, not a quote tool.
- Representative quote: “I can show the roof and savings quickly, but I still need a clean assumptions summary before discussing financing.”
- Satisfaction: **8.2/10**.

### Eleanor: Inexperienced Older Homeowner

- Device: 768 x 1024 tablet, keyboard-only desktop, and 200% browser zoom.
- First impression: professional but technically dense.
- Steps attempted: understand the offer, navigate by keyboard, enter an address, review required/optional fields, inspect privacy and terms, and recover from validation errors.
- Steps completed: all safe local workflows.
- Time required: slower than the other personas because source badges, model language, and financing terms require reading.
- Confusing moments: “energy offset,” “system size,” “payback,” “ITC,” “roof plane,” and the difference between a preliminary report and an installer quote.
- Errors encountered: no keyboard trap; form errors were readable. The dashboard-token fields lacked labels before the fix.
- Trust-building moments: no purchase language, installer verification is repeated, installer contact is optional, and sharing disclosure is visible.
- Abandonment risks: no self-service deletion workflow, dense cards, and financial jargon.
- Final decision: would continue if a trusted family member could review the report.
- Representative quote: “I understand that this is an estimate, but I want to know how long you keep my information and exactly who may call me.”
- Satisfaction: **6.7/10**.

### Maya And Daniel: Young First-Time Homeowners

- Devices: 1440 x 900 laptop and 390 x 844 smartphone.
- First impression: modern, credible, and easy to explore together.
- Steps attempted: roof suitability, panel and system metrics, bill adjustment, cash/loan/lease review, report request validation, sharing, refresh, and revisit behavior.
- Steps completed: all mocked non-destructive workflows.
- Time required: fast in the local fixture; real report-generation latency was not measured.
- Confusing moments: dealer fees, degradation, net-metering assumptions, transfer-on-sale effects, and fixed utility charges are not modeled in enough depth.
- Errors encountered: changing the report bill range erased contact details before the fix.
- Trust-building moments: user-adjusted values are labeled, savings are capped to annual bill, and incentive eligibility is not guaranteed.
- Abandonment risks: incomplete financing detail, long report length, and uncertainty about report persistence.
- Strongest conversion factors: immediate visual roof result, annual/monthly savings, and easy report sharing.
- Questions still unanswered: exact utility tariff, loan fees, and what happens to financing when selling.
- Final decision: likely to request a report, then seek installer confirmation.
- Representative quote: “The roof view gets us interested; the exact loan and utility assumptions decide whether we act.”
- Satisfaction: **8.0/10**.

### Luis: Professional Solar Installer

- Devices: 1440 x 900 desktop and 768 x 1024 tablet.
- First impression: credible homeowner preview with unusually good source labeling.
- Steps attempted: inspect roof planes, panel placement, orientation, pitch, confidence, obstructions, setbacks, production, financial assumptions, and verification disclosures.
- Steps completed: all fixture-backed review paths.
- Confusing moments: utility tariff, net metering, degradation, dealer fees, electrical service, and structural constraints are not fully modeled or exposed.
- Errors encountered: visible panel count and advisor count disagreed before the fix.
- Trust-building moments: layout is called preliminary, panel placement is confidence-aware, source badges are explicit, and installer verification is repeated.
- Abandonment risks: no direct roof-plane/layout editing, no obstruction correction workflow, and limited engineering inputs.
- Classification: **Useful homeowner preview**, not a preliminary installer assessment or installation-ready design.
- Representative quote: “This is strong for homeowner education, but I cannot approve a design from it without field measurements, electrical review, and tariff-specific production modeling.”
- Satisfaction: **6.5/10**.

## Persona Scorecard

| Metric | Marcus | Eleanor | Maya & Daniel | Luis |
|---|---:|---:|---:|---:|
| First impression | 9 | 8 | 9 | 8 |
| Ease of use | 8 | 6 | 8 | 7 |
| Device usability | 8 | 7 | 8 | 7 |
| Clarity | 8 | 6 | 8 | 7 |
| Accessibility | 8 | 7 | 8 | 7 |
| Trust | 8 | 6 | 8 | 7 |
| Technical credibility | 7 | 7 | 7 | 6 |
| Financial transparency | 7 | 6 | 7 | 6 |
| Report usefulness | 8 | 7 | 8 | 7 |
| Likelihood of continuing | 8 | 6 | 8 | 6 |

Scores below 7 reflect dense terminology for Eleanor, missing data-lifecycle controls, and the lack of installer-grade tariff, degradation, electrical, structural, and layout-editing inputs for Luis.

## Page-By-Page Audit

### Homepage And Address Search

What works:

- Strong product identity and clear primary action.
- Address autocomplete supports keyboard selection.
- Privacy and terms are reachable.
- Responsive layouts passed at 1440, 1280, 1024, 768, 390, and 320 px.

Issues:

- `SOLAR-008`: Escape did not close an in-flight autocomplete popup. Fixed.
- `SOLAR-009`: the brand logo linked to `#`, not the homepage. Fixed locally.
- `SOLAR-017`: support contact was not prominent on the main journey. Fixed locally.
- `SOLAR-020`: the empty-address arrow was visually actionable before the required address existed. Fixed locally.

Impact: moderate conversion and keyboard-confidence improvement.

### Roof Analysis

What works:

- Panels and roof planes load enabled.
- Map has an accessible text alternative.
- Confidence and preliminary-design language are visible.
- Layout remains usable at mobile widths and 200% zoom.

Issues:

- `SOLAR-002`: the generic map showed 20 panels while module-fit calculations and advisor copy used 19. Fixed by sharing one module-aware ceiling.
- `SOLAR-004`: the map label used `aria-label` without a valid semantic role. Fixed.
- `SOLAR-005`: tab relationships were incomplete. Fixed.
- `SOLAR-014`: the tool cannot edit roof planes, obstructions, setbacks, or individual panel positions.

Impact: the fixed count mismatch removes a major trust problem; direct layout editing remains an installer limitation.

### Savings And Financing

What works:

- Shared functions cover annual savings, monthly savings, system size, energy offset, 20-year utility cost, loan payments, state credit, and federal-credit timing.
- Savings do not exceed the homeowner’s entered annual bill.
- Energy offset is capped at 100%.
- Invalid bill values cannot drive calculations.
- Financing is described as illustrative rather than approved.

Issues:

- `SOLAR-013`: tariff, net-metering, degradation, dealer fees, maintenance, and fixed utility charges are explicitly disclosed as excluded from the preliminary model; installer-grade modeling is still outside scope.
- `SOLAR-015`: some formula paths remain spread across components despite the shared metric model, increasing drift risk.
- Tax and incentive eligibility remains homeowner-specific and is correctly not guaranteed.

Impact: appropriate for a preliminary homeowner estimate, insufficient for an installer quote or lending decision.

### Lead And Report Request

What works:

- Required fields are labeled.
- Phone remains optional.
- Installer follow-up is opt-in.
- Privacy and lead-sharing disclosures are visible.
- Duplicate submit behavior is guarded and mocked tests produced one request.
- Expired report links fail with a friendly page.

Issues:

- `SOLAR-001`: changing the bill range remounted the form and erased contact data. Fixed.
- `SOLAR-010`: no formal retention schedule or self-service deletion workflow.
- `SOLAR-012`: the marketing-follow-up consent path is intentionally disabled from the public form and requires a product/legal decision before activation.

Impact: the fixed form-state defect protects conversion; privacy lifecycle work is still required.

### Dashboard And Installer Views

What works:

- Token validation is server-side and report/utility access is protected.
- Dashboard state-changing routes use shared auth.

Issues:

- `SOLAR-006`: token fields lacked accessible labels. Fixed.
- `SOLAR-011`: CRM mutation failures previously rolled back without visible feedback. Fixed locally with an accessible error region.
- `SOLAR-018`: production still serves an older build and does not yet contain all local fixes.

Impact: admin reliability and accessibility improve after deployment; visible mutation feedback remains needed.

### Privacy And Terms

What works:

- Preliminary estimate, installer verification, consent, and data-sharing language are direct.
- Support email is present.
- No savings guarantee or financing approval is implied.

Issues:

- `SOLAR-010`: retention and deletion are not operationalized.
- `SOLAR-016`: Vercel Cron and `CRON_SECRET` are configured locally, but the production schedule and secret still need verification.

Impact: privacy operations should be completed before scaling lead volume.

## Detailed Issue Log

The machine-readable reproduction record is in `qa-issues.json`.

| ID | Severity | Status | Title |
|---|---|---|---|
| SOLAR-001 | P1 | Fixed | Bill-range change erased report contact fields |
| SOLAR-002 | P1 | Fixed | Panel count disagreed across map, KPIs, and advisor |
| SOLAR-003 | P2 | Fixed | Production-mode CSP broke local WebKit stylesheet loading |
| SOLAR-004 | P2 | Fixed | Map used invalid ARIA labeling |
| SOLAR-005 | P2 | Fixed | Tab and tabpanel relationships were incomplete |
| SOLAR-006 | P2 | Fixed | Dashboard token inputs had no programmatic labels |
| SOLAR-007 | P2 | Fixed | Roof-analysis progress was not announced as live status |
| SOLAR-008 | P3 | Fixed | Escape could not dismiss in-flight address results |
| SOLAR-009 | P3 | Fixed | Logo link targeted an empty page fragment |
| SOLAR-010 | P1 | Open | Retention schedule and user deletion workflow are missing |
| SOLAR-011 | P2 | Fixed | Dashboard mutation failures now show an accessible error region |
| SOLAR-012 | P2 | Open | Marketing follow-up consent path is unreachable |
| SOLAR-013 | P1 | Fixed | Report and PDF now disclose excluded financial assumptions |
| SOLAR-014 | P2 | Open | Installer cannot correct roof geometry or layout |
| SOLAR-015 | P2 | Open | Calculation logic still has component-level duplicates |
| SOLAR-016 | P1 | Fixed locally | Vercel Cron configuration and CRON_SECRET auth added; production env/schedule still need verification |
| SOLAR-017 | P3 | Fixed | Homepage now exposes a direct support link |
| SOLAR-018 | P1 | Open | Production deployment is behind the tested local code |
| SOLAR-019 | P2 | Fixed | README limits now match the route implementations |
| SOLAR-020 | P3 | Fixed | Empty address action is disabled until a suggestion exists |
| SOLAR-021 | P1 | Fixed | PostCSS and Sharp are overridden to patched versions; npm audit is clear |
| SOLAR-022 | P2 | Fixed | Report validation now focuses an accessible error summary with field links |

## Accuracy Review

### Verified In Code And Tests

- System size: selected panel count multiplied by selected panel wattage, converted to kW and rounded to one decimal.
- Annual savings: estimated annual production multiplied by the Arizona average rate, capped at the entered annual bill.
- Monthly savings: annual savings divided by 12 and rounded.
- Energy offset: annual production value divided by modeled annual consumption, capped at 100%.
- Cash payback: net modeled cost divided by annual savings.
- Loan payment: standard amortization formula using principal, annual rate, and term.
- Arizona state credit: 25% of modeled cost capped at $1,000.
- Federal residential credit: shared date-aware assumption; current 2026 behavior does not automatically apply the expired 2025 residential credit.
- Panel count: after the fix, the active count is clamped to the selected module’s roof capacity and shared by map, dashboard, advisor, and report request.
- Formatting: invalid values do not render as `NaN`; currency and percentage helpers have unit coverage.

### Not Verifiable From The Information Displayed

- Property-specific utility tariff and time-of-use schedule.
- Export compensation or net-metering rules.
- Annual degradation and inverter replacement.
- Dealer fees and lender-specific APR adjustments.
- Structural capacity and roof condition.
- Main service-panel upgrade requirements.
- Exact obstruction, pathway, fire-setback, and access requirements.
- Final production guarantee.

The application is correctly positioned as a preliminary estimate, not a quote or installation-ready design.

## Trust And Consent Review

- Privacy wording: clear about report delivery and optional provider sharing.
- Lead sharing: disclosed near report submission.
- Calls and texts: phone is collected, but active SMS sending is not part of this flow.
- Marketing consent: not preselected; the public path currently does not request a separate marketing opt-in.
- Installer contact: optional.
- Savings claims: presented as modeled estimates.
- Tax credit: eligibility is not guaranteed.
- Testimonials/social proof: production showed a low live report count; accuracy of that counter was not independently verified.
- Data deletion: no self-service route was found; this is the largest trust gap.

No dark pattern was observed in the tested report request.

## Recommended Copy Changes

These are recommendations only; legal, privacy, tax, and financial copy was not changed.

| Current wording | Concern | Suggested replacement |
|---|---|---|
| “Solar score” | Can sound like a guaranteed property rating. | “Preliminary Solar Readiness Score” |
| “Energy offset” | Unfamiliar to non-technical homeowners. | “Estimated share of your annual electricity use covered by solar” |
| “Simple payback” | Does not state what is included. | “Modeled payback after listed incentives and assumptions” |
| “System size” | kW meaning is unclear. | “Estimated solar system size (kW)” |
| “Panel positions come from the Google Solar API model” | Could imply construction accuracy. | “Sample panel positions use available Solar API roof data; an installer must verify measurements, setbacks, obstructions, and electrical design.” |
| “Financing” | Can imply an offer. | “Illustrative financing scenarios — not a loan offer” |

## Prioritized Improvements

### Five Required Launch Decisions

1. Deploy the tested local fixes and verify the production commit.
2. Implement a documented retention schedule and user data-deletion request workflow.
3. Add `CRON_SECRET` in Vercel Production and verify the scheduled pending-upload cleanup run.
4. Decide whether to add a formal retention/deletion policy before scaling acquisition.
5. Decide whether the installer correction workflow is required for the next release or explicitly defer it.

### Five Conversion Improvements

1. Keep the persistent, visible support/contact path on the homeowner journey.
2. Explain system size, energy offset, and payback in plain language beside each value.
3. Summarize financial assumptions in one compact expandable card.
4. Keep the disabled empty-address action state covered by regression tests.
5. Provide a concise “save and return” explanation before report submission.

### Five Installer-Credibility Improvements

1. Keep tariff, export-credit, degradation, dealer-fee, maintenance, and fixed-charge exclusions visible and review them with installers.
2. Add roof-plane and obstruction correction tools.
3. Add individual panel add/remove and layout reset controls.
4. Show electrical-service and structural-review assumptions.
5. Export a machine-readable design summary with source provenance.

### Five Accessibility Improvements

1. Complete manual VoiceOver, NVDA, and TalkBack testing.
2. Review muted text contrast in bright-light mobile conditions.
3. Add a keyboard-operable non-map summary of every map layer.
4. Verify PDF reading order and tagged-PDF behavior with assistive technology.
5. Exercise utility-bill upload and recovery states with a screen reader.

### Three Future Features

1. Homeowner data/privacy center for access and deletion requests.
2. Installer correction workflow for roof planes, obstructions, and panel layout.
3. Utility-specific tariff and export-rate modeling with assumption history.

## Performance Observations

- Local automated tests did not reveal repeated paid API calls.
- Roof-analysis and report calls were mocked, so real production latency was not measured.
- Core Web Vitals were not captured in a controlled production performance run.
- The production homepage loaded successfully during read-only browser review.
- Large map/3D dependencies remain candidates for a dedicated bundle and memory profile.

## Follow-up Implementation Pass

The local implementation now includes visible dashboard mutation errors, explicit financial exclusions in the dashboard and PDF, a disabled empty-address action, a homepage support link, reconciled rate-limit documentation, a Vercel Cron definition for pending utility-bill cleanup, patched PostCSS/Sharp dependency overrides, a synchronized keyboard-selection path for address autocomplete, and a focused report-validation error summary with links to invalid controls. The complete local browser/device matrix is green after these changes.

The remaining items are not safe to infer or complete without a product or deployment decision: a formal retention period and authenticated deletion workflow (`SOLAR-010`), whether marketing follow-up should remain intentionally disabled (`SOLAR-012`), installer editing of roof geometry/layout (`SOLAR-014`), a deeper canonical-snapshot migration (`SOLAR-015`), and deployment/configuration verification for this tested build (`SOLAR-018`).

## Evidence

- `qa-evidence/production-homepage-desktop.jpg`
- `qa-evidence/local-homepage-desktop.png`
- `qa-evidence/local-roof-analysis-desktop.png`
- `qa-evidence/local-roof-analysis-mobile.png`
- `playwright-report/`
- `test-results/playwright-results.json`

Local roof screenshots use a deterministic mock map, not live satellite imagery. They demonstrate layout and state behavior, not imagery accuracy.

## Final Verdict

**86/100: local release candidate validated; production release still requires the listed privacy, consent, installer-scope, and deployment decisions.**

The homeowner flow is materially stronger after the safe fixes, its core estimate language is responsible, the dependency audit is clear, and the complete local browser matrix passes. Do not treat the product as high-volume or installer-grade until the remaining privacy lifecycle and production verification work is completed and the installer-scope decisions are explicit.
