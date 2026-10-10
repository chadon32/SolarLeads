# Solartelligence UX, QA, CRO, and Accessibility Audit

Date: 2026-07-29
Test surface: local `http://localhost:3000`
Browser testing: Browser Use, desktop viewport approximately 1280x720, mobile viewport 390x844
Test address: 6420 E Nance St, Mesa, AZ 85215

This audit tested the application through the rendered UI. It intentionally stopped before the final report submission because that action creates a real lead, stores personal information, and can send external notifications. Validation was tested through the point where submission was safe without creating that side effect.

## Executive Summary

| Area | Score | Summary |
| --- | ---: | --- |
| Overall UX | 6.4/10 | Strong visual direction and a coherent solar journey, weakened by map trust failures, long analysis pages, and unclear saved-state behavior. |
| UI | 7.4/10 | Premium dark visual system, consistent cards, and good desktop hierarchy. Mobile analysis controls and map framing need work. |
| Trust | 5.5/10 | Disclosures are unusually transparent, but a checked Panels layer with no visible panels is a severe credibility break. |
| Conversion | 6.5/10 | The address-first CTA is clear, but repeated CTAs, a dense report form, and a broken Analysis anchor add hesitation. |
| Accessibility | 6.8/10 | Good labels, native controls, skip link, live validation, and language metadata. Keyboard behavior needs a dedicated pass and some controls expose technical wording without help. |
| Performance | 5.8/10 | Roof analysis is usable, but Google map/3D work takes several seconds and the invalid report path triggered a Next.js worker runtime failure. |

### Highest-risk findings

1. **Critical: the map reports Panels checked and 19 panels, but no panel overlay is visible.** This happened in desktop and mobile views. Toggling Panels off and back on did not make the overlay appear during the desktop test. The user is asked to trust a visualization that contradicts its own controls and metrics.
2. **Critical: panel-selection data is inconsistent with the active roof layout.** The roof workspace showed 19 panels, 7.6 kW, and 8.4 years payback, while the selected Panel Selection card showed 64 panels, 25.6 kW, $67,840, and 28.3 years payback.
3. **Critical: an invalid report URL rendered a blank Next.js runtime-error screen.** The console showed `Jest worker encountered 2 child process exceptions, exceeding retry limit`. A homeowner needs a friendly expired, invalid, or unavailable report message.
4. **High: the mobile map widened to a neighborhood-scale view and collapsed controls into a disclosure.** The selected home remained marked, but the roof was not the visual focus and the panel overlay was still absent.
5. **High: the homepage `Analysis` navigation links target `#solar-workspace`, but that target does not exist on the landing state.** The link has no useful destination until analysis data is already mounted.

## Test Notes By Persona

### Persona 1: Professional Mechanic

Journey: land, search a property, review map, inspect roof/shade, inspect panel selection, inspect savings and financing, open report form.

Emotional path: immediate interest in the fast address-first workflow, then skepticism when the selected layout and the map did not agree. Technical labels were familiar, but the lack of a dependable panel overlay would stop this user from using the tool in a real workflow.

What worked:

- Address autocomplete returned a precise street-address result and a second nearby alternative.
- The analysis exposes system size, panel count, orientation, payback, roof area, sunlight hours, plane scores, confidence scores, and financing controls.
- The 3D model eventually completed and displayed a roof surface with solar modules.
- Roof, Panel Selection, Financing, and Get Report sections are reachable without leaving the report page.

Pain points:

- The main 2D map is not dependable enough for technical review: Panels is checked, but modules are not visible.
- The active 19-panel layout and the selected equipment card's 64-panel estimate look like different reports.
- “Solar API,” “User-adjusted,” “Modeled,” “Primary plane,” and “preliminary ceiling” are useful provenance labels, but they are not organized into one clear source-of-truth panel.
- The user must scroll through a long page to connect the map to financing.
- There is no obvious export of the exact roof layout, coordinates, or a shareable installer snapshot from the tested UI.

Trust concerns:

- A technical user will treat a layer-control mismatch as an instrumentation failure, not a cosmetic bug.
- A 28.3-year payback beside a current 8.4-year payback invites the conclusion that the calculations are broken, even if each card is using a different panel count.

Recommendations:

- Block “Send My Full Report” until the same snapshot drives map, panel card, savings, financing, and PDF.
- Add a visible analysis integrity state: `Layout rendered: 19 of 19` or `Layout unavailable`.
- Make the selected panel card explicitly say whether it reflects the recommended panel count or the preliminary maximum.
- Add a compact technical export or installer handoff view after the core data is trustworthy.

Satisfaction: **5.5/10**

### Persona 2: Everyday Driver With Limited Automotive Knowledge

The automotive profile is not applicable to this solar product, so this persona was evaluated as a homeowner with limited solar knowledge.

Journey: land, enter an address, wait for the model, interpret the roof map, decide whether to request the report.

Emotional path: the homepage is inviting and low-pressure. The analysis introduces many labels and numbers at once. “Solar API,” “User-adjusted,” “Modeled,” “roof plane,” “payback,” and “energy offset” need translation. The checked Panels state with no visible panels creates uncertainty about whether the result worked.

What worked:

- The hero explains the basic promise and gives a clear address entry point.
- Arizona-only validation is clear and polite.
- Empty report submission produced specific, field-level alerts for name, email, ownership, and timeline.
- The AI Solar Advisor provides plain-English context and the FAQ answers open and close.
- Privacy and estimate terms are visible and explain that the output is preliminary.

Confusing moments:

- “Roof measurements and annual flux are projected from the current Solar API building model” is technically precise but not homeowner-friendly.
- The current bill appears as a numeric input on the homepage and as a select inside Savings, which may look like two different values.
- A “Strong Candidate” presentation beside “Preliminary” and “Installer confirmation” language can feel like a sales judgment rather than an estimate.
- The saved-estimate banner interrupts the first viewport for returning users with “Continue my estimate” and “Start fresh,” without first explaining what will be preserved.
- The thank-you route without a valid report context says “Your solar report is ready, there.” and shows several Pending values, which can look broken.

Recommendations:

- Replace technical source badges with a short “What this means” disclosure or tooltip.
- Use one homeowner-facing score name and one confidence explanation.
- Present the active recommendation first; put the preliminary maximum behind “See capacity range.”
- Make the invalid, expired, and missing-report states intentional and reassuring.
- Explain the saved-estimate choice in one sentence before the two actions.

Satisfaction: **6.2/10**

### Persona 3: Average User

Journey: scan hero, enter address, skim result cards, glance at map, decide whether to request the report.

Emotional path: the visual style feels premium and modern. The user can reach a result quickly, but the report page becomes long and repetitive. The strongest hesitation point is the mismatch between visible map content and the numbers in the surrounding cards.

What worked:

- The primary CTA is visible in the navigation and the hero.
- The homepage uses strong whitespace, a restrained palette, and readable card groupings.
- Desktop KPI cards make score, panels, savings, and system size easy to scan.
- The report tabs provide a useful content model.
- No horizontal overflow was detected on the tested 390px homepage viewport.

Pain points:

- “Analyze My Roof,” “Send My Full Report,” “Share estimate,” “Try another address,” top nav actions, report tabs, and repeated lower CTAs create too many competing actions.
- The Analysis nav link is broken on the initial landing state.
- A 3D view loads with a spinner and requires several seconds before becoming useful.
- Mobile collapses map controls, but the roof image itself is still too wide and neighborhood-heavy for the intended analysis job.
- The page is long enough that a user may lose the relationship between the map and the report metrics.

Recommendations:

- Keep one primary action per state: `Analyze My Roof` before analysis and `Send My Full Report` after analysis.
- Keep `Share estimate` secondary and remove duplicate scroll-target CTAs.
- Add a sticky local section index only after analysis is ready, with clear active state.
- Make the map card full-width on mobile and reserve the details panel for below it.

Satisfaction: **6.8/10**

## Page-by-Page Audit

### Landing page `/`

Works well:

- Clear address-first value proposition.
- Premium visual identity and readable primary headline.
- Search status is exposed as accessible live content: “Google Places active” or “Address lookup ready.”
- Privacy, terms, SSL, installer-contact optionality, and preliminary-estimate signals are visible.

Issues:

- **High:** `Analysis` links point to `#solar-workspace`, which does not exist before an analysis is selected.
- **Medium:** Returning-user saved-estimate controls appear above the hero and compete with the first action.
- **Medium:** The homepage contains more small provenance and helper text than an average user needs before address entry.
- **Low:** “Arizona · real satellite roof scan” and “Arizona only” duplicate geographic qualification.

Recommended fix: make `Analysis` either open the address flow or hide it until a report exists; move saved-state recovery into a compact dismissible prompt; shorten pre-search copy.

### Address search and autocomplete

Works well:

- The control has a visible label, placeholder, combobox semantics, listbox, active selection, and keyboard-related ARIA attributes.
- Two real Google Places suggestions appeared for the known address.
- Non-Arizona selection was rejected with a polite live status and alert: “We currently only serve Arizona homes. Please enter an AZ address.”

Issues:

- **Medium:** Invalid free text does not show a useful immediate message until the user selects or otherwise commits it.
- **Medium:** The address control has no `maxlength`, so an extreme input can be entered before server validation.
- **Low:** The “Use selected address” icon button has an accessible name, but its enabled/disabled affordance should be visually obvious when no suggestion is selected.

### Estimate loading state

Works well:

- Shows “Generating roof model,” “Satellite imagery and Solar API roof data are loading,” and staged AI analysis messages.

Issues:

- **High:** The loading state does not provide a reliable progress estimate or recovery action if external map/solar data stalls.
- **Medium:** The 3D model can remain in “Building the 3D roof model…” for several seconds without explaining what the user can do meanwhile.

### Rooftop analysis / Overview

Works well:

- Roof, Sunlight, and 3D Model tabs exist and are keyboard-addressable through tab semantics.
- Selected-home labeling, Google attribution, map-error links, legend, confidence indicators, and map layers are present.
- Desktop map framing is visually centered enough to identify the selected parcel.

Issues:

- **Critical:** Panels is checked and the interface reports “19 panel layout · 7.6 kW,” but the visible satellite map did not show the blue/black panel overlay. This persisted after a desktop off/on toggle.
- **High:** Roof planes is off by default, which hides important geometry until the user discovers the control.
- **High:** The panel legend says photovoltaic modules are present even when the image shows none.
- **Medium:** The live map uses dense technical badges and a layered legend that can compete with the roof itself.

### Sunlight tab

Works well:

- Selecting Sunlight checked the Sunlight quality layer and added green/yellow/red legend content.
- Supporting cards explain sunlight hours, plane scores, shade risk, and estimated quality.

Issues:

- **High:** The visible screenshot did not show a clear heat layer after the tab/layer was activated; the layer state and visual result need an explicit render-health check.
- **Medium:** “Primary plane,” “Secondary plane,” and “Garage plane” are not explained for homeowners.

### 3D Model tab

Works well:

- The 3D model eventually rendered a roof surface and dark panel geometry.
- Module selection exposes wattage, dimensions, rated power, efficiency, and tier.
- No console errors occurred after the model completed.

Issues:

- **High:** Initial loading is slow enough to create uncertainty, and the spinner has no elapsed-time or retry behavior.
- **Medium:** The 3D view is visually useful to technical users but needs a clear “illustrative model” label for homeowners.
- **Low:** Browser console emits repeated Three.js deprecation warnings for `THREE.Clock` and `PCFSoftShadowMap`.

### Panel Selection tab

Works well:

- Equipment cards expose brand, model, wattage, efficiency, warranty, type, price, system size, and payback.
- Selected and alternative panel cards have clear state labels.

Issues:

- **Critical:** The selected card showed 64 panels / 25.6 kW / $67,840 / 28.3 years while the active roof analysis showed 19 panels / 7.6 kW / 8.4 years.
- **High:** “Panels needed” appears to use the preliminary maximum instead of the active recommendation, but the UI does not say that.
- **Medium:** Payback is easy to misread because the selected card and roof summary use different panel-count bases.

### Savings tab

Works well:

- Monthly bill, bill-after-solar, annual savings, 20-year cost, and 20-year savings are grouped logically.
- Savings are labeled modeled or user-adjusted.

Issues:

- **High:** “Total 20-year cost with solar,” “without solar,” and “Total 20-year savings” need a one-line definition of whether financing, utility escalation, tax credits, and cash cost are included.
- **Medium:** The monthly bill is exposed in more than one location, which risks conflicting user inputs.

### Financing tab

Works well:

- Cash, lease, and loan choices exist.
- Loan controls expose down payment, APR, and term.
- Disclaimers correctly explain lender, installer, incentive, APR, and tax-professional dependencies.

Issues:

- **High:** The financing view inherits the same active-count ambiguity and can show costs/payback for the preliminary maximum rather than the selected recommendation.
- **Medium:** The buttons are exposed as lowercase accessible names (`buy`, `Lease`, `loan`), which is inconsistent and less polished.
- **Medium:** “No federal residential credit is assumed for new 2026 expenditures under current IRS guidance” is important but should be paired with a plain-language “how this changes your estimate” explanation.

### Send Report form

Works well:

- Required fields validate with specific alerts for name, email, ownership, and timeline.
- Native select controls expose the required options.
- Utility-bill upload is clearly optional and states accepted file types.
- Installer follow-up consent and sharing disclosure are visible.
- “What happens next” gives a three-step expectation.

Issues:

- **High:** The form is dense on desktop and becomes a long scroll on small screens.
- **Medium:** “Protected submission” is technical and does not explain what protection the user receives.
- **Medium:** The report status says “Your AI solar report is being generated” even before the final request is submitted, which creates a state contradiction.
- **Medium:** The user must understand several qualification inputs without inline help.

### Thank-you page `/thank-you`

Works well:

- The page contains a report summary, sharing section, and next-step content.
- Sharing language avoids unsupported reward/referral promises.

Issues:

- **High:** Opening `/thank-you` without a valid query/context produced “Your solar report is ready, there.” and several “Pending” report values. The grammar and empty-state framing are not production-ready.
- **High:** The page should distinguish “report request received,” “report generated,” and “email delivery pending.”
- **Medium:** A homeowner could interpret Pending values as a failed submission.

### Privacy `/privacy`

Works well:

- Clearly describes contact, property, bill, report-request, and optional utility-bill data.
- Describes service providers and report-link handling.

Issue:

- **Low:** The page is accurate but dense; use a short summary box for the main homeowner takeaways.

### Terms `/terms`

Works well:

- Strongly states preliminary estimate, non-contract, installer verification, financing, tax, and production limitations.

Issue:

- **Low:** The legal disclaimer is appropriate but long for a homeowner; offer a concise summary before the full text.

### Dashboard `/dashboard` and `/dashboard/installer`

Works well:

- Both routes fail closed with an access-required state when no token is present.
- The access copy explains why the dashboard is gated.

Issue:

- **Medium:** “Start secure session” is not very specific; “Unlock dashboard” plus a short token-handling explanation would reduce hesitation for administrators.

### Report viewer `/report/[leadId]`

Issue:

- **Critical:** Invalid report access triggered a Next.js runtime-error page in local testing instead of the intended friendly invalid/expired report state.

### Mobile experience

Works well:

- Homepage at 390px showed no horizontal overflow.
- Mobile navigation collapses to Menu and Analyze.
- The report form uses stacked controls where appropriate.

Issues:

- **High:** The mobile roof image can show a neighborhood-scale crop, making the selected roof too small.
- **High:** Map controls are hidden behind a “Map controls / Panels” disclosure. This is reasonable for density, but the checked state and overlay failure make the control feel broken.
- **Medium:** The report model card truncates long address content with ellipsis at narrow widths.
- **Medium:** Long report sections require substantial vertical scrolling before the user can reach the send action.

## Intentional Break Tests

| Test | Result |
| --- | --- |
| Empty report form | Passed validation: name, email, ownership, and timeline alerts appeared without submission. |
| Invalid email | Passed validation: “Enter a valid email address.” appeared. |
| Non-Arizona address | Passed rejection with an alert and live status. |
| Blank/invalid free-text address | Weak: no useful immediate error until a valid suggestion is selected or committed. |
| Rapid layer toggle | State remained checked, but the panel visual did not appear. |
| Refresh analysis | Loading state appeared and recovered to a ready state. |
| Back/forward navigation | Passed in a fresh browser tab. One existing tab lost its browser context during a prior back/forward attempt, so navigation should be regression-tested under real user history conditions. |
| Mobile horizontal overflow | No overflow detected on the 390px homepage. |
| Invalid report ID | Failed: runtime-error page instead of friendly unavailable state. |
| Empty final submission | Not executed because it would create a real external lead/notification side effect. |
| Extreme text payload | Not submitted; code-side tests cover request-size and validation rules, but browser-side long-input behavior should still be tested after the report form is safe to submit in a staging environment. |

## Improvement Backlog

### Critical

- Fix the map render lifecycle so the visible panel count, checkbox state, legend, and drawn panels all come from one verified snapshot.
- Make panel-selection and financing cards use the active recommended panel count, or clearly label maximum-capacity numbers as a separate scenario.
- Add a route-level error boundary and friendly invalid/expired report page for `/report/[leadId]`.
- Add a render-health guard that prevents report generation while the map/panel snapshot is empty or inconsistent.

### High Impact

- Tighten map bounds around the selected building, roof polygon, and panel bounds on desktop and mobile.
- Make Roof planes enabled when geometry is available, or show a clear “Show roof planes” affordance beside the map.
- Fix the `#solar-workspace` landing link or route it to the address form.
- Add a real progress state and timeout/retry action for Google imagery and 3D model loading.
- Replace repeated CTAs with one primary action per state and one secondary Share action.
- Rewrite thank-you empty/loading states so they never claim a report is ready with Pending values.

### Medium

- Add plain-language explanations for Solar API, Modeled, User-adjusted, roof plane, energy offset, and payback.
- Consolidate the monthly bill input into one source of truth and show where it affects the estimate.
- Add a “Recommended” versus “Preliminary maximum” label to all panel, cost, and payback cards.
- Improve mobile map card sizing and keep the roof as the focus rather than the neighborhood.
- Replace lowercase `buy` and `loan` labels with consistent user-facing names.
- Add an accessible focus regression test for the skip link, navigation, autocomplete, tabs, sliders, disclosure controls, and form errors.

### Low

- Remove or upgrade Three.js deprecated APIs.
- Resolve the CSS optimizer warning for the `env(...)` utility selector.
- Add a short privacy/terms summary before long legal text.
- Hide duplicate geographic trust copy and reduce technical badges on the first viewport.

## Feature Recommendations

| Feature | Helps | Complexity | Expected impact |
| --- | --- | ---: | --- |
| Analysis integrity badge | All personas | Medium | High: tells users whether map overlays and metrics are synchronized. |
| Recommended vs maximum capacity toggle | Mechanic, average user | Low | High: prevents the 19 vs 64 confusion. |
| Installer handoff snapshot | Professional reviewer | Medium | High: makes the product useful beyond lead capture. |
| Plain-language metric tooltips | Everyday homeowner | Low | Medium-high: reduces uncertainty without removing technical depth. |
| Staged loading with retry | All personas | Medium | High: lowers abandonment during Solar API and 3D work. |
| Report preview before submission | Average user | Medium | Medium: clarifies what the user will receive. |
| Staging-only submission harness | QA and product team | Low | High for reliability: enables full notification and duplicate-lead tests without production side effects. |

## Competitive Pattern Analysis

The relevant comparison set is consumer property-analysis and solar-estimate products rather than automotive apps: Zillow/Redfin-style property context, Google Project Sunroof-style roof framing, and installer design tools such as Aurora-inspired workflows.

Patterns leading products use that Solartelligence should strengthen:

- One clearly framed property view before secondary metrics.
- A visible distinction between measured/model-derived values and assumptions.
- A single recommended result, with maximum capacity treated as an expandable scenario.
- Fast, reassuring loading states with recovery actions.
- A simple homeowner summary first, with technical detail available progressively.
- A report/share handoff that feels like a finished artifact, not a form appended to a long dashboard.

Solartelligence already has the premium visual foundation, source disclosures, confidence indicators, and technical depth. The product currently loses trust at the point where the visualization and numerical narrative diverge.

## Final Roadmap

### Phase 1: Immediate

1. Fix panel overlay rendering and add a synchronized snapshot/render-health check.
2. Normalize active recommendation versus preliminary maximum across Panel Selection, Savings, Financing, PDF, and report pages.
3. Add friendly report error boundaries and correct thank-you empty/loading states.
4. Fix or remove the broken landing Analysis anchor.
5. Add desktop/mobile screenshot regression tests for map overlays, selected home framing, controls, and report metrics.

### Phase 2: Next Sprint

1. Tighten mobile map bounds and keep the selected roof centered.
2. Reduce CTA duplication and shorten the first-viewport technical copy.
3. Add progressive disclosure/tooltips for technical terms.
4. Add explicit loading timeouts, retry actions, and an external-API status summary.
5. Add a staging submission harness for full lead, email, PDF, duplicate, and error-path testing.

### Phase 3: Future

1. Build an installer handoff/export view.
2. Add report version history so users can see when a model changed.
3. Add richer accessibility automation and reduced-motion verification.
4. Add analytics around search completion, report-form abandonment, map-layer toggles, and report request completion.

## Checks Run

- Browser Use desktop and mobile interaction testing: completed.
- `npm run lint`: passed with 2 existing warnings in `marketing-ad/landscape/scripts/patch-frame3-duration.mjs` (`modes` and `re` unused).
- `npm run typecheck`: passed.
- `npm test`: passed, 108 tests.
- `npm run build`: passed. Build emitted a CSS optimizer warning for an `env(...)` utility selector and repeated development analytics-disabled messages because `NEXT_PUBLIC_GA_MEASUREMENT_ID` is not set.

## Evidence Screenshots

- [Desktop homepage](../.codex-screenshots/ux-qa/home-desktop.png)
- [Desktop rooftop map](../.codex-screenshots/ux-qa/map-desktop.png)
- [Mobile homepage](../.codex-screenshots/ux-qa/home-mobile.png)
- [Invalid report runtime error](../.codex-screenshots/ux-qa/invalid-report-runtime-error.png)

## Scope Notes

- The application is a solar homeowner analysis product; “vehicle lookup” and mechanic-specific automotive workflows are not present and were marked not applicable rather than inferred.
- No real lead was submitted, no homeowner email/SMS was sent, and no production data was accessed.
- The source fixes listed below were applied after the initial exploratory pass and verified locally with browser smoke tests.

## Post-Fix Verification

The following findings were fixed in the local build:

- The rooftop map now defaults Panels and Roof planes on, retries custom overlay drawing until a Google Maps projection exists, and renders a polygon fallback beneath the custom canvas overlay.
- Initial map framing now focuses on the selected property and nearby roof geometry instead of broad neighborhood bounds.
- Panel metrics in the report dashboard now use the shared recommended panel-count calculation when no active count is supplied.
- Invalid report IDs are rejected before the Supabase lookup, and the report route now has a friendly error boundary for unavailable or malformed links.
- Homepage Analysis navigation now sends users to the address flow before analysis exists and to the analysis workspace after it is ready.
- Direct visits to the thank-you page no longer claim a report is ready with a placeholder name or display misleading Pending metrics.
- Three.js shadow-map usage was updated to the supported constant to remove the observed deprecation warning.

Browser verification with `6420 E Nance St, Mesa, AZ 85215` confirmed checked Panels and Roof planes states, visible panel geometry, a focused roof view, and no browser error or warning logs during the tested flow. The malformed report URL displayed the friendly unavailable-report state instead of a runtime-error page.

## Files Changed During Remediation

- `src/components/solar-analysis.tsx`
- `src/components/solar-report-dashboard.tsx`
- `src/components/home-client.tsx`
- `src/app/report/[leadId]/page.tsx`
- `src/app/report/error.tsx`
- `src/components/roof-model-3d.tsx`
- `src/components/roof-scene-3d.tsx`
- `src/components/thank-you-client.tsx`
