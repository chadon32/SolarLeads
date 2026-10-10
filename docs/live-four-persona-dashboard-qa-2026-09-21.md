# Solartelligence Live Four-Persona QA Report

Date: 2026-09-21
Environment: Production `https://solartelligence.com`
Test mode: Chrome, authenticated dashboard session used for the elevated testing bucket
Scope: Landing page, address lookup, bill input, roof analysis, 3D model, sunlight map, panel layout, equipment, savings, financing, report validation, dashboard operations, CSV/PDF output, back/refresh, keyboard controls, empty/error/loading states

No real report was submitted, no installer follow-up was selected, no email was sent, and no lead status was changed.

## Executive Summary

| Area | Grade | Summary |
| --- | ---: | --- |
| Overall UX | 8.3/10 | Strong end-to-end workflow with clear recovery paths; a few validation and stale-data issues remain. |
| UI and visual hierarchy | 8.6/10 | Polished dark visual system, clear primary actions, useful layered roof views. |
| Trust | 7.6/10 | Good installer disclaimers and data-source labels, weakened by financing copy that does not match active controls and legacy dashboard data. |
| Conversion | 8.2/10 | Address-first flow, no-sales-call promise, share action, and optional contact flow are effective. |
| Accessibility | 8.4/10 | Semantic headings, tabs, comboboxes, checkboxes, sliders, error anchors, and keyboard operation were present. Pixel-level mobile sizing was not measured in this pass. |
| Performance and reliability | 8.1/10 | Live model, sunlight, report tabs, PDF, and CSV completed without a 429 or crash. Quantitative browser profiling was not captured. |

### Highest-priority findings

1. **Medium: Electric bill validation is not blocking enough.** Values of `$0` and `$5,001` were accepted visually. Selecting an address then returned the analysis to the `$200` default without a clear field-level correction message.
2. **Medium: Financing assumptions can contradict the active scenario.** After changing the loan to 20% down, 6.6% APR, and 25 years, the expanded assumptions still described a baseline of 6.49% APR and 20 years.
3. **Medium: Dashboard empty search leaves stale lead detail visible.** "No leads match this view" appeared while the previously selected lead detail remained on screen.
4. **Medium: Dashboard data completeness needs verification.** The existing lead record showed `0 kW`, `0 panels`, `0 yrs`, and "Not captured" equipment fields while the report workflow itself produced populated model values. This may be legacy data, but it is a material operator trust risk.
5. **Low/Medium: Service-area failure copy is ambiguous.** An out-of-state address eventually showed "Address lookup is temporarily unavailable" rather than an explicit Arizona-only explanation.

## Test Matrix

| Workflow | Result | Evidence |
| --- | --- | --- |
| Landing page and primary CTA | Pass | Hero, address form, Arizona-only copy, no-sales-call promise, FAQ, legal links visible. |
| Valid address search | Pass | Google Places suggestions appeared; selecting a valid Arizona address enabled analysis. |
| Missing address | Pass | Start button stayed disabled until an address was selected. |
| Long address input | Pass with UX note | 500-character input did not crash; it produced no actionable result. A max-length/helper could be clearer. |
| Electric bill range | Finding | `$0` and `$5,001` were accepted visually and later normalized to `$200` during address analysis. |
| Loading state | Pass | Roof-model and report-loading messages showed progress and resolved. |
| Back navigation | Pass | Estimate returned to a saved-estimate prompt; Continue returned to the estimate. |
| Refresh during/after analysis | Pass | URL state and analysis recovered without a crash. |
| 3D model | Pass | Interactive model rendered for two Arizona addresses; obstruction label and camera controls were present. |
| 3D camera controls | Pass | Above, perspective, reset, zoom, and keyboard slider controls responded without errors. |
| Panel maximum | Pass | San Tan Valley test reached a 60-panel preliminary ceiling; model label and metrics updated to 24.0 kW. |
| Panel visibility layer | Pass | Hiding and restoring panels changed the 3D module count to 0 and back. |
| Sunlight map | Pass | Sunlight layer, roof planes, legend, and toggles rendered and changed state. |
| Module catalog/specifications | Pass | Six module choices and expanded dimensions, wattage, efficiency, and tier were visible. |
| Panel/inverter/battery selections | Pass | Qcells, Jinko, microinverters, and battery choices updated modeled outputs. |
| Savings | Pass | Bill, annual savings, system size, bill-after-solar, payback, and 20-year values updated together. |
| Financing | Pass with finding | Buy, lease, loan, down payment, APR, term, and keyboard operation worked; baseline copy mismatch noted above. |
| Report form validation | Pass | Blank submit highlighted four required fields and provided linked correction messages. Optional phone and bill upload were not incorrectly marked required. |
| Real report submission | Not run intentionally | Avoided sending a real email or creating a sales lead. |
| Dashboard filters/search/sort | Pass with finding | Status, savings sort, matching search, and no-match empty state worked; stale detail remained on no-match. |
| CSV export | Pass | `leads.csv` downloaded locally. |
| PDF download | Pass with data-quality caveat | A 10-page PDF downloaded and rendered legibly; the existing legacy lead PDF contained limited-confidence/old data. |
| Testing limit | Pass for this run | Multiple analysis/model requests completed without a 429. Exact remaining quota is not exposed in the UI. |

## Persona 1: Door-to-Door Solar Salesperson

### Journey map

1. Opens the landing page and enters a homeowner address.
2. Selects the matching Arizona Places result.
3. Adjusts the monthly bill and waits for the roof report.
4. Uses sunlight and 3D model views while explaining panel placement.
5. Moves the panel slider, changes the module, adds inverter/battery options, and reviews savings.
6. Shares the estimate link or sends the homeowner to the report form.

### What worked

- The address-first workflow is fast and easy to demonstrate.
- The share button confirmed "Link copied to clipboard!" without opening a distracting modal.
- The 3D model and sunlight map provide a visual sales aid, and the layers are understandable.
- Panel count, system size, annual savings, payback, module, inverter, and battery values updated together.
- The report form clearly shows which fields must be completed before submission.

### Pain points and trust concerns

- A salesperson cannot confidently explain the financing assumptions when the expanded baseline text differs from the active APR and term.
- A bill outside the valid range silently reverting to `$200` risks presenting the wrong savings story.
- The dashboard's existing lead detail can show zero system data even though the estimate workflow has populated data.
- A 60-panel ceiling is labeled preliminary and installer-verified, which is good, but the UI should make "preliminary" even more prominent when used in a sales conversation.

### Satisfaction: 8.1/10

### Recommendations

- Make invalid bill values block analysis and show the exact acceptable range beside the field.
- Make the financing assumptions panel derive its text from the active scenario.
- Add a "copy homeowner summary" action with panel count, kW, annual savings, payback, and confidence labels.
- Add a visible "last updated" or "model status" indicator for operator confidence.

## Persona 2: Older Inexperienced Homeowner

### Journey map

1. Starts from the landing page and sees the "real Arizona roof scan" promise.
2. Enters a valid Queen Creek-area address.
3. Tries an invalid electric bill value and expects the app to explain the correction.
4. Watches the loading progress.
5. Reviews the overview, sunlight, roof/shade, and plain-English advisor sections.
6. Uses browser Back and Continue to recover the saved estimate.

### Emotional reactions

- Initial confidence is high because the landing copy explains "free," "about 60 seconds," and "no sales call."
- The loading sequence is reassuring because it states what is being resolved.
- The model, roof/shade summary, and FAQ copy reduce fear around roof damage and installer verification.
- Confidence drops when an invalid bill does not receive an obvious blocking error and later appears as `$200`.

### Confusing moments

- "Solar API," "roof planes," "modeled payback," "orientation," and "system size" need inline plain-language help for a first-time user.
- Financing terms are understandable only after reading the assumptions section.
- "Address lookup is temporarily unavailable" is not clear enough when the user searched outside Arizona.

### Missing features

- A guided "What this number means" mode for readiness, kW, payback, and energy offset.
- A simple recommended path that hides equipment and financing detail until requested.
- A clear service-area message before Google Places results are selected.

### Satisfaction: 7.8/10

### Recommendations

- Use "monthly electric bill" and "estimated time to recover system cost" alongside technical labels.
- Prevent invalid bills from proceeding; keep the entered value visible while asking for correction.
- Explain the difference between a satellite estimate, modeled savings, and installer-confirmed design in one short card.

## Persona 3: Young Couple Considering Solar

### Journey map

1. Searches an address and compares the 3D roof view with the sunlight view.
2. Tests different panel counts and bill assumptions.
3. Compares Qcells and other panel choices.
4. Adds a battery and explores buy, lease, and loan options.
5. Reviews 20-year savings and bill-after-solar values.
6. Decides whether to share the estimate or request the full report.

### What worked

- The product feels modern and interactive without requiring a long form before showing value.
- Equipment comparison is more credible than a single hard-coded recommendation.
- Battery, inverter, down payment, APR, and term controls expose meaningful choices.
- The report and advisor text consistently remind users that the result is preliminary.

### Pain points

- The UI contains many badges such as "Solar API," "User-adjusted," "Modeled," and "Estimated." These are useful but visually repetitive.
- The financing baseline mismatch creates hesitation at exactly the point where users need confidence.
- "20-year savings" and "annual savings" are modeled values; the relationship should be explained beside both numbers.

### Satisfaction: 8.4/10

### Recommendations

- Add a compact comparison summary before the full equipment catalog.
- Show a single "your current scenario" card that repeats the active bill, panel count, equipment, down payment, APR, and term.
- Add a visual range or sensitivity view so users can see how savings change under conservative assumptions.

## Persona 4: Professional Solar Installer

### Journey map

1. Opens the dashboard and filters/sorts the lead pipeline.
2. Opens a homeowner estimate and checks model status, roof/shade, and 3D layout.
3. Reviews panel candidates, raw positions removed, preliminary ceiling, orientation, and confidence scores.
4. Checks equipment specifications, inverter, battery, pricing, and financing assumptions.
5. Downloads CSV/PDF outputs for follow-up.

### What worked

- Dashboard status and savings sorting support triage.
- The roof model exposes accepted panel locations, raw candidates removed, orientation, and confidence scores.
- 3D controls and layer toggles are useful for explaining the model while keeping final-design disclaimers visible.
- The module catalog shows dimensions, rated power, efficiency, and tier.
- CSV and PDF controls worked; the PDF was a valid 10-page letter-size file and rendered without visible clipping.

### Pain points

- Existing dashboard records can lack panel count, system size, equipment, and payback even when the estimate workflow has those values.
- Nurture cards showed failed follow-ups with "Lead record not found," which undermines operator confidence.
- The dashboard has no obvious "data freshness" or "legacy record" label.
- A no-match search retains a stale detail panel, which is risky in a pipeline workflow.

### Satisfaction: 7.9/10

### Recommendations

- Add a clear selected-lead state and hide or clear detail when the filtered list is empty.
- Reconcile report data into the lead record, or label legacy/partial records explicitly.
- Add a dashboard health card for failed nurture jobs and a retry path that does not require manual guesswork.
- Add export metadata: report ID, analysis timestamp, data version, and whether the model is preliminary.

## Page-by-Page Audit

### Landing page

Works: Strong hero, address-first hierarchy, Arizona scope, no-sales-call message, FAQ, legal links, and disabled Start button before selection.

Issue: Out-of-area address failure copy is ambiguous. Severity: Medium. Steps: enter a valid non-Arizona address, select it, wait for resolution. Expected: explicit "Arizona addresses only." Actual: "Address lookup is temporarily unavailable" and disabled Start. Fix: validate region and show a dedicated service-area message. Impact: fewer abandoned or confused searches.

### Address and bill form

Works: Google Places suggestions, selected-address state, keyboard-compatible bill stepper, whole-dollar helper text.

Issue: Range validation. Severity: Medium. Steps: set bill to `0` or `5001`, then choose a valid address. Expected: inline correction and no analysis until fixed. Actual: value is accepted visually and analysis later returns to `$200` without explaining the normalization. Fix: enforce range at input and submission; preserve the invalid value and focus the field. Impact: prevents wrong savings estimates.

### Roof analysis workspace

Works: Loading progress, model-ready state, 3D model, sunlight map, layers, legend, share, try-another-address, confidence labels, and disclaimers.

Issue: No critical functional defect observed. Residual risk: the model was not independently checked against measured roof dimensions or an installer design. Severity: Low/Informational. Fix: add a visible "estimate only" engineering note near the model and retain current disclaimers. Impact: protects trust and reduces overinterpretation.

### Panel selection

Works: Catalog choices, selected state, pricing, specifications, inverter options, battery add-on, and recalculated metrics.

Issue: No functional defect observed. Severity: Low/Informational. Recommendation: keep equipment assumptions and price timestamp adjacent to the selected card.

### Savings and financing

Works: Savings values update with bill and panel choices; buy, lease, and loan scenarios work; APR/down-payment/term controls respond, including keyboard operation.

Issue: Assumptions copy mismatch. Severity: Medium. Steps: select Loan, change down payment to 20%, press APR right once, choose 25-year term, expand assumptions. Expected: assumptions reflect active scenario or explicitly identify a separate baseline. Actual: active controls showed approximately 6.6% APR and 25 years while text still said baseline 6.49% APR and 20 years. Fix: bind copy to active inputs or label baseline as a comparison. Impact: improves financial trust and reduces conversion hesitation.

### Report form

Works: Blank submit produced a summary that four fields need review; red highlights and linked error messages appeared for name, email, ownership, and timeline. Optional phone and utility bill upload were not highlighted.

Not fully exercised: a real utility-bill upload and a successful email submission were intentionally not performed to avoid handling personal information or creating a lead. Recommended next test: use a disposable test PDF/JPG and a controlled test inbox in a staging environment.

### Dashboard

Works: Status filter, savings sort, matching search, no-match empty state, refresh, CSV export, and PDF download all worked.

Issue: Stale detail on empty search. Severity: Medium. Steps: search for a non-existent lead. Expected: list and detail both become empty or detail explains the previous selection. Actual: "No leads match this view" appeared while the old selected lead detail remained visible. Fix: clear selection when filtered results are empty. Impact: prevents operator mistakes.

Issue: Legacy/incomplete record data. Severity: Medium pending confirmation. Evidence: existing lead detail showed zero/"Not captured" model fields and failed nurture records, while the estimate UI generated populated model values. Fix: verify lead persistence and migration; show "partial/legacy record" until reconciled. Impact: improves CRM reliability.

## Accessibility and Interaction Review

Passed observations:

- Skip-to-content link was present.
- Headings, tab groups, selected tab state, comboboxes, checkboxes, sliders, and definition lists appeared in the accessibility tree.
- Keyboard ArrowUp changed the bill stepper; ArrowRight changed the APR slider.
- Validation messages were linked to the affected fields.
- Color was paired with text labels such as Solar API, Modeled, User-adjusted, and Estimated.

Not measured in this pass:

- Exact mobile viewport layout at 393 x 852.
- Pixel-level touch-target dimensions.
- Screen-reader output on a physical iPhone.
- Reduced-motion behavior beyond the visible background pause control.

## Performance and Reliability Notes

- The production app completed two distinct Arizona address analyses and repeatedly re-entered the 3D model without a visible crash.
- Model and report loading states were exposed rather than leaving the user on a blank screen.
- Multiple interactions used the dashboard-authenticated testing bucket; no 429/rate-limit error occurred.
- Browser-side quantitative timing, Core Web Vitals, and network waterfall measurements were not captured, so the performance grade is observational rather than benchmark-grade.

## Prioritized Improvement Backlog

### Critical

- No critical production blocker was observed in this run.

### High impact

- Enforce bill range validation before analysis and preserve the user's invalid value while explaining the correction.
- Synchronize financing assumptions copy with the active scenario.
- Reconcile estimate results into dashboard lead records and surface persistence failures.
- Clear stale dashboard detail when filters produce no results.

### Medium

- Add explicit Arizona-only rejection copy for out-of-area addresses.
- Add a model/data timestamp and report-data version to dashboard and PDF outputs.
- Add staging-only successful report submission and utility-bill upload coverage.
- Simplify repeated badges and expose a homeowner-friendly explanation mode.

### Low

- Add a max-length hint for unusually long address text.
- Add a compact copyable homeowner summary for sales conversations.
- Add a financing sensitivity chart and conservative savings range.

## Recommended Roadmap

### Phase 1: Immediate

1. Fix bill validation and out-of-area messaging.
2. Fix financing assumption synchronization.
3. Clear dashboard selection on empty results.
4. Add persistence/error telemetry for model fields and nurture jobs.

### Phase 2: Next sprint

1. Add staging fixtures for successful report submission and utility-bill upload.
2. Add data freshness/version labels to the dashboard and PDF.
3. Add homeowner-friendly helper text and a simplified view.
4. Run a controlled 393 x 852 mobile pass with touch-target measurement.

### Phase 3: Future

1. Add conservative/expected/optimistic savings bands.
2. Add installer export metadata and a report comparison history.
3. Add automated persona regression tests for dashboard filters, model state, financing, and report validation.

## Final Assessment

The live product is in good shape for a preliminary solar-readiness experience. The differentiating roof visualization, sunlight map, equipment controls, and transparent installer disclaimers are working and feel credible. The main risks are not the core analysis UI; they are data integrity and trust details around validation, financing assumptions, and dashboard persistence. Fixing those four items should move the experience materially closer to a 9/10 release standard.
