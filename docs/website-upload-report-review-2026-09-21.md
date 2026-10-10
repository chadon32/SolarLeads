# Website upload and report review

## Confirmed findings

- High: ordinary visitors without a referral code send `referredBy: null`; the deployed schema rejected it with HTTP 400. A harmless production diagnostic confirmed null returns 400 while omission reaches the separate roof-verification check (403). Neither diagnostic created a report.
- High: changing report tabs unmounted the form, discarding entered details and the uploaded bill claim. The form now mounts on first opening and remains mounted while hidden in other sections.
- High: the former 10 MB upload allowance exceeded the hosting request limit. Client and server now consistently enforce 4 MB, leaving room for multipart metadata.
- Medium: failed uploads could be mislabeled as storage outages, retrying the same file did not trigger another selection event, and requests had no timeout. Error classification, retry reset, cancellation, and a 30-second timeout address these cases.
- Medium: browsers can omit MIME information, which multipart encoding turns into `application/octet-stream`. Supported extensions now resolve the type while server-side signature validation remains required.
- Medium: report payloads contain both signed roof data and a report snapshot; the old 1 MB request cap could reject larger analyses. The bounded cap is now 4 MB.

Vercel documents a 4.5 MB function request limit: https://vercel.com/docs/errors/function_payload_too_large

## Live checks

- Chrome desktop and a 393 x 852 viewport: address autocomplete and analysis for the user-provided Crape Road property succeeded.
- Sunlight and 3D views, maximum panel count, savings, financing/lease controls, form validation, privacy navigation, browser Back, and refresh were exercised.
- The selected 60-panel count survived refresh.
- A synthetic PDF successfully uploaded through both the API and the mobile-width browser file picker. The browser visibly confirmed success. No homeowner document was used.
- No console errors were captured in the inspected live tab.
- Production logs showed six earlier HTTP 400 report submissions; no response bodies were retained in those logs. The null-referral defect is confirmed, but those historical requests cannot be individually attributed to it.

## Verification

- `npm test`: 170 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Desktop browser suite: 63 passed, 4 opt-in benchmark/audit tests skipped.
- Mobile and small-mobile browser suites: 15 passed.
- Targeted report/upload browser checks: 9 passed, covering oversize rejection, same-file retry, explicit pending-upload removal, form/bill persistence across tabs, required-field validation, and report confirmation.
- Targeted ESLint: no errors; existing internal `window.location.assign` navigation warning remains.
- `git diff --check`: passed.

The first dev-browser run used 127.0.0.1 and hit Next.js development-origin restrictions, leaving inert server-rendered controls. Re-running against localhost resolved this test-environment issue. One cold keyboard-navigation test timed out; the complete subsequent desktop run passed it.

## Scope and remaining checks

The application changes are local and have not been pushed or deployed. Existing unrelated video edits and untracked project files were preserved.

Successful report persistence was tested with the actual route handler against mocked external storage and disabled email delivery. Browser confirmation tests use mocked lead responses. Real production email delivery, a newly saved production report/PDF, private dashboard workflows, and a physical iPhone/TestFlight session were not tested. No real sales lead was created and no email was sent.

Two Luna workers were launched explicitly with `gpt-5.6-luna` and `max`; the lead reviewed their changes and ran integrated checks. The spawn calls accepted those settings; no separate billing or runtime telemetry was available.

Rollback: reverse only this task's application/test changes using a reviewed patch. Do not reset the entire working tree, which contains unrelated user work.
