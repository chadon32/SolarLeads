# Production flow verification

Date: 2026-09-22. Target: https://solartelligence.com.

## Scope and safety

This pass verifies live integrations, separately from the earlier mocked browser and offline PDF tests. The user approved one clearly labeled QA report to their own email and a matching dashboard record with a synthetic bill. No real bill data, installer contact, marketing opt-in, customer record edits, or broad follow-up processing is authorized by this test.

The user-requested San Tan Valley example address is used to exercise actual provider data. Testing is not a roof survey or independent engineering certification. Installed mobile app behavior cannot be inferred from a desktop mobile viewport.

## Execution plan

1. Inspect production configuration names and existing routes without exposing secrets.
2. Run real address lookup, roof analysis, 3D controls, panel selection, and financial scenario interactions.
3. Upload a clearly synthetic PDF through the normal browser file chooser.
4. Submit exactly one QA report with installer/marketing contact off; capture the success state and any errors.
5. Confirm persisted model and bill association, private storage access, signed report access, and generated PDF.
6. Check provider delivery evidence separately from actual inbox receipt.
7. Exercise dashboard search and reversible CRM edits on the QA record only; verify no follow-up scheduled without consent.
8. Check 393 x 852 layout, refresh/back navigation, console errors, and native release configuration.
9. Document passed, failed, and blocked checks; fix safe reproducible defects with focused regression coverage. Do not claim deployment of any new fixes unless actually deployed.

## Initial observations

- Vercel lists report-signing, bill-upload, database, email, and dashboard credentials in production.
- No `NEXT_PUBLIC_GA_MEASUREMENT_ID` is listed: production conversion analytics remains unconfigured.
- The existing dashboard tab initially showed stale content; refresh correctly required a new session. After user login, the current dashboard displayed two records and the updated missing-data labels.
- The production scheduler configuration contains utility-bill cleanup only. Automatic nurture scheduling must be investigated separately; the process endpoint will not be invoked because it can send messages for unrelated records.

## Results

Completed against production with one owner-approved QA lead and a synthetic PDF fixture. The exact residential address and the owner's email are intentionally omitted from this document.

| Journey | Result | Production evidence |
| --- | --- | --- |
| Address autocomplete | Pass | Google Places returned the requested San Tan Valley match. Selecting it started live roof analysis. |
| Roof analysis / 3D | Pass, preliminary only | Live model loaded with 19 initial placements and a 60-panel ceiling. Slider changes updated model size, savings, and the URL. 3D/perspective view and panel layer responded. At 60 panels the saved scenario showed 24.0 kW; setting it back to 2 showed 0.8 kW and $254 annual savings. No engineering accuracy claim was independently verified. |
| Synthetic utility bill upload | Pass | Real production form returned “Bill uploaded - estimate ready for review.” Database row confirmed upload association. The private stored object returned HTTP 200 and `application/pdf` using a short-lived signed URL. Owner download route also returned HTTP 200 and a `%PDF-` file. |
| Report submit / lead persistence | Pass | Exactly one QA report was submitted. Confirmation page reported the bill received, 2 panels, 0.8 kW, $254 annual savings, and no installer follow-up. The database record matched those values. |
| Signed report viewer | Pass | Signed viewer opened and displayed the saved QA report and the same model/savings figures. |
| Generated PDF | Pass with a score issue | Stored signed PDF URL returned HTTP 200, `application/pdf`, 622,444 bytes, valid `%PDF-` signature, 10 pages, attachment disposition, and private/no-store caching. All 10 production pages were rendered and reviewed: the summary and panel-layout pages contain the improved 3D roof illustration, satellite context remains on analysis pages, and no clipping or overlap was observed. |
| Solar readiness score | **Incorrect in current production; fixed locally, not deployed** | The report showed `100/100 Strong Candidate` for the selected 2-panel, 0.8 kW layout with 11% energy offset. Code tracing found that `solarReadinessScore` was copied from roof-model confidence, although the PDF described the score as being driven by panel count and offset. Recalculating from this record's saved factors produces `48/100 Preliminary Estimate`; roof-model confidence remains `100/100`. |
| Dashboard visibility and edits | Pass | Authenticated production dashboard HTML included the QA record. Status and notes PATCHes each returned HTTP 200; status was restored to `New` and notes cleared. No existing customer record was modified. |
| Follow-up consent | Pass | QA record has installer consent=false, marketing consent=false, and zero follow-up rows. No provider/installer outreach was requested or triggered. |
| Homeowner email | **Fail: production sender configuration** | Report save returned an accessible on-page report, but database status is `homeowner_email_failed` with no sent timestamp. Resend rejected the sender because the `gmail.com` domain is unverified. The test email was not delivered; no resend was attempted. |
| Report URL hostname | **Issue: canonical host configuration** | Saved email/PDF link uses `solar-leads-psi.vercel.app`, not `solartelligence.com`. The signed PDF works on that alias. This is a hostname/configuration defect, not a failed report render. |
| Analytics | **Intentionally not configured yet** | Production Vercel environment does not contain `NEXT_PUBLIC_GA_MEASUREMENT_ID`; tracking is disabled. The current privacy notice does not describe Google Analytics, while adding an ID immediately loads GA and sends events. Keep it disabled until the disclosure and consent behavior are reviewed. |
| Automatic nurture scheduling | **Unverified** | Repository `vercel.json` schedules only utility-bill cleanup, not `/api/follow-ups/process`. No external scheduler was inspected. The process endpoint was deliberately not invoked because it can deliver messages for unrelated production leads. |
| Mobile / installed app | **Not verified** | No installed iOS or Android device was available in this pass. Desktop browser results and prior synthetic 393 x 852 browser tests do not establish native file picker, keyboard, share-sheet, or PDF behavior. |

### Follow-up actions

1. Resend confirms DKIM and SPF are verified and sending is enabled for `solartelligence.com`. The remaining Resend warning is the inbound MX record only; leave it unchanged unless inbound mail is intentionally configured. `FROM_EMAIL` is set in Vercel to `reports@solartelligence.com` for Production and Preview. The current production deployment has been rebuilt with the updated project settings. The local code fallback for Gmail/unset senders was not included. Do not retry the prior QA message; delivery still needs a separately authorized fresh test.
2. The local URL resolver forces `https://solartelligence.com` in production even if `NEXT_PUBLIC_SITE_URL` contains a deployment alias. This source fix was not included in the redeploy. Newly generated viewer/PDF links may therefore continue using the Vercel alias until the local source change is released. Existing signed links remain functional until expiry.
3. Keep Google Analytics disabled until the privacy notice accurately describes it and the owner reviews the consent behavior. Then create a dedicated Solartelligence GA4 property/stream and add its measurement ID to Vercel.
4. Decide whether automated nurture email is intended. If so, configure and verify a scheduler for `/api/follow-ups/process`; exercise it with an explicit-consent QA record and ensure it cannot process unrelated users during the test.
5. Check the report/upload flow on installed iOS and Android builds.

### QA record disposition

One clearly named QA record remains in the production database with its synthetic bill so the owner can inspect the result. It has no marketing or installer consent, no queued follow-ups, no saved notes, and status `New`. The uploaded synthetic file contains no real utility/customer data. Its report-email failure is recorded accurately; it must not be mistaken for a delivered message.

## Follow-up verification and local fixes

- Rechecked the QA row after opening/downloading the PDF. It is marked `pdf_generated=true` and `pdf_downloaded=true`; email remains failed with no sent timestamp.
- Corrected the report API and both confirmation screens to distinguish email sent, delivery rejected, and delivery unavailable/not attempted. A rejected or skipped email no longer appears as merely “delayed”; the user is directed to the saved PDF link. Legacy `delayed` session data is treated as unavailable rather than as proof of a send.
- Corrected solar-readiness scoring to use the selected system's modeled panel count and offset, sunlight, and usable roof percentage. Roof-model confidence remains a separate value; legacy snapshots recalculate readiness instead of reusing the old conflated value. This also corrects the PDF and advisor views for future reports.
- Replaced the full-page thank-you navigation with the App Router after the report save. The saved report remains in memory if browser storage is blocked.
- Added unit/API regression coverage for delivery outcomes and readiness-score recalculation. Added a browser test for a rejected email; the full Chromium report-form suite also verifies the failure copy, secure PDF link, input validation, navigation, bill-upload cancellation, and error handling.
- Verification: `npm test` passed (209/209); `npm run typecheck` passed; `npm run build` passed; targeted ESLint passed without warnings; Chromium production-build report-flow tests passed (8/8).
- Poppler emitted local “no display font” warnings for Symbol/ArialUnicode while rendering, but all page text and glyphs appeared legible in the resulting images. A separate font-inspection executable was unavailable, so cross-renderer font embedding is not independently proven.
- The initial build reported an Edge Runtime deprecation; the Corrections pass below removes it. The missing local `NEXT_PUBLIC_GA_MEASUREMENT_ID` warning remains because analytics is not configured.
- The local source-code changes are still only in the working tree. Vercel's `FROM_EMAIL` setting was updated, then the existing production source commit `506ab89` was redeployed to apply current project settings. This did not include the local URL resolver, readiness-score correction, or sender fallback.

## Corrections pass

- Added a server-side public URL resolver. Production report viewer/PDF links now use `https://solartelligence.com` even if `NEXT_PUBLIC_SITE_URL` is incorrectly set to a Vercel alias; preview links use the unique Vercel preview host, and development links retain a configured local origin. This fixes future generated links after a deployment; already-sent or saved links are not rewritten.
- Removed the deprecated `runtime = "edge"` export from the generated Open Graph image route. The installed Next.js 16.2 documentation marks Edge Runtime deprecated and specifies Node.js as the default.
- Added regression tests for canonical production links, preview links, local origins, and invalid local configuration.
- Latest verification: `npm test` passed (216/216); `npm run typecheck`, focused ESLint, and `npm run build` passed. Chromium production-build report-flow tests passed (8/8) before the latest sender-fallback-only change. The Edge Runtime warning is gone. The build still truthfully logs that analytics is disabled without a configured measurement ID. `git diff --check` found no whitespace errors; Git emitted only existing line-ending conversion notices.
- A follow-up browser check confirmed the Vercel project is `solar-leads`, with `NEXT_PUBLIC_SITE_URL` scoped to Production and Preview. Its value was not exposed or changed through the browser; the code fallback now forces the canonical production origin after a future deployment. The GA measurement variable remains absent.
- Resend domain details confirm `solartelligence.com` DKIM and SPF are verified and sending is enabled; the only failure is inbound MX, with a warning about possible conflicts. No DNS record was changed. The local notification helper now falls back to `reports@solartelligence.com` when the configured sender is Gmail or unset, with regression tests. Vercel confirmed the `FROM_EMAIL` update for Production and Preview. The existing Production commit `506ab89` was redeployed as `7rtX2uHnwKWc7gH3gv8AZgvDkotf`; Vercel reports Ready and assigns `solartelligence.com`. The live homepage loaded successfully. No new email was sent.
- Google Analytics is signed in but currently selected to the unrelated Firebase property `socialape-7ee89`, which has no data stream; no stream was created and no tracking was enabled on that property. The site privacy notice currently does not disclose Google Analytics, and the existing component loads it immediately if an ID is supplied. Recommendation: keep tracking disabled until the disclosure and consent behavior are reviewed, then use a dedicated Solartelligence GA4 property/stream rather than the Firebase property.
- Android device verification could not proceed because ADB is not installed/on PATH. No native device was connected through the available computer-control surface.
- The sender variable is active in the new deployment, but email delivery was not retested; no further email was sent. Analytics remains intentionally disabled until the privacy notice and consent behavior are reviewed; afterward, create a dedicated property/stream and configure its measurement ID. Nurture scheduling remains intentionally unconfigured pending explicit decision and safe consent-scoped scheduling. Native-device behavior and alternate-renderer PDF font embedding remain unverified.
- Only the existing live commit was redeployed to apply the changed sender setting; no local workspace files were bundled or pushed. The source-code corrections above remain local candidates for a separate reviewed release. The checkout still contains many unrelated modified and untracked files, and the Vercel CLI is unavailable.
