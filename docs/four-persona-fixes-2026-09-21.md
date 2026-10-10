# Four-persona audit fixes

This work addresses the confirmed defects in `live-four-persona-dashboard-qa-2026-09-21.md` and adds coverage for the previously untested mobile report upload flow.

## Changes

- Invalid monthly bills stay visible with an accessible correction message. Address selection and invalid shared estimate links cannot silently substitute $200 and start analysis.
- Out-of-state address selection receives a service-area explanation. Lookup outages retain a separate recovery message.
- Financing assumptions and the detailed table follow the active down payment, APR, and term. Comparisons using a loan longer than 20 years explain that the full loan obligation is included.
- Homeowners get clearer explanations of system power, first-year savings, long-term net savings, and payback, plus a copyable estimate summary.
- Dashboard selection is restricted to the visible results. Missing stored values are distinguished from genuine zeros, and partial records have data-quality/freshness labels.
- Lead persistence is checked for compatibility fallbacks that drop model information. Historical estimates are not invented or overwritten.

## Verification scope

Final results:

- `npm test`: 178 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run build`: passed; existing Edge Runtime deprecation and unset local analytics notices remain.
- Chromium browser regression batch: 44 passed. Includes address, bill, financing, report/upload, accessibility, persona, native-sharing, and report-tab persistence checks.
- WebKit mobile suite: 7 passed.
- `node --env-file=.env.local scripts/check-dashboard-audit.mjs`: passed against the local production build with the configured dashboard session. Confirmed empty search removes the previous detail panel and no browser runtime errors occur.
- Targeted ESLint for all implementation changes and new test/script files: passed.
- `npm run lint`: passed with 0 errors and 2 pre-existing internal-navigation warnings (the report form and its archived mobile inspection copy).
- `git diff --check`: passed.
- A read-only database schema check (`limit=0`) confirmed required lead model columns and `updated_at` are available in the configured Supabase project. It retrieved no lead records and changed no schema.

Browser commands used `PLAYWRIGHT_BASE_URL=http://localhost:3101`. The 44-test batch used `--project=chromium-desktop` with `address.spec.ts`, `electric-bill.spec.ts`, `financing.spec.ts`, `audit-report-mobile.spec.ts`, `report.spec.ts`, `bill-upload-recovery.spec.ts`, `report-tab-persistence.spec.ts`, `personas`, `accessibility.spec.ts`, and `review-fixes.spec.ts`. The mobile command was `npx playwright test tests/e2e/mobile.spec.ts --project=mobile`.

Local browser checks use synthetic addresses and intercepted API responses. The successful bill-upload test proves browser file handling, claim propagation, report submission, and success navigation; it does not prove delivery through the production storage or email providers.

Mobile checks include 393 x 852 layout, report navigation, minimum 44px report tab targets, and successful synthetic upload/submission. Separate WebKit mobile tests cover the 3D viewer, page overflow, and native readiness bridge. Physical iPhone keyboard and device behavior remain outside these desktop browser checks.

Automated tests cannot establish installation accuracy against physical roof measurements. The roof layout remains a preliminary estimate requiring installer verification.

Existing incomplete lead records and historical failed follow-ups were not rewritten or resent. The dashboard now reports missing information honestly and highlights follow-up errors. Reconstructing lost historical fields requires their original source data; refreshing the dashboard does not repair a deleted lead.

Three workers were invoked through the native agent tool as `luna_worker`, explicitly configured with `gpt-5.6-luna` and reasoning effort `max`. The lead reviewed the patches, corrected integration issues, and ran the final checks.

## Scope of the audit recommendations

The audit's proposed sensitivity charts, historical report comparisons, and broader simplified mode are feature ideas, not reproduced defects. No speculative savings bands or engineering measurements have been added.

## Release and rollback

This is a local source update. Production deployment and an App Store submission are not part of this change record. Existing unrelated working-tree changes were preserved. Roll back only the reviewed audit-fix hunks if needed; do not reset the shared working tree.
