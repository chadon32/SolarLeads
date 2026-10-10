# Dashboard workspace redesign

Date: October 5, 2026
Status: implemented and tested; production release authorized on October 5, 2026.

## Reference and scope

The AZPestShield project at `C:/Users/chado/Documents/PestControl` was inspected
as the reference for a clearer operations workspace. Its admin overview, leads,
analytics, navigation, and staff theme informed the structure. This was code
inspection, not a review of its authenticated live dashboard.

SolarTelligence keeps its navy/cyan branding and existing dashboard authentication.
The redesigned `/dashboard` has four deep-linked views:

- Overview: lead KPIs, daily submissions, current stages, and attention items.
- Lead pipeline: searchable, paginated list and stage board, with lead details.
- Analytics: equipment mix, report completeness, modeled values, and outcomes.
- Follow-ups: the saved delivery queue and its current statuses.

Existing status changes, report and bill links, test lead classification, deletion,
and follow-up operations remain available. Test lead outreach is disabled.
No database migration, new paid service, or environment variable is required.

## Metric definitions and boundaries

- Test leads are excluded by default and can be included explicitly.
- Date filters use Phoenix calendar days and the lead creation date.
- Open leads are new, contacted, or quoted leads.
- Open modeled value sums known system-cost estimates for open leads. It is not
  revenue, a binding quote, or guaranteed sales value.
- Closed-lead win rate is won / (won + lost). It is not website conversion rate.
- Stage counts are current states, not a historical progression funnel.
- Missing numeric data is excluded, rather than displayed as zero.
- An untouched lead is an open lead without a saved update for at least seven
  Phoenix calendar days. This is not a record of actual calls or messages.
- The server loads at most the latest 500 leads and 500 follow-ups. Exact totals
  support a coverage warning when the loaded dataset is incomplete.
- The all-loaded cohort can cover more than 30 days, while its chart intentionally
  displays the most recent 30 days.
- Lead queries select report summary fields rather than downloading full model
  geometry and imagery for every lead. PDF/model endpoints remain unchanged.

No visitor analytics or Search Console data was available for this work. The local
build also reported a missing GA measurement ID. Visitor-to-lead conversion,
campaign attribution, and long-term trends are not claimed by this dashboard.

## Files

- `src/app/dashboard/page.tsx`: authenticated loading, bounds, summary projection.
- `src/components/dashboard-crm.tsx`: view state, filters, actions, and navigation.
- `src/components/dashboard-workspace.tsx`: workspace views and presentation.
- `src/components/dashboard-workspace.css`: scoped desktop/mobile styling.
- `src/lib/dashboard-analytics.ts`: cohort filtering and metric aggregation.
- `src/lib/dashboard-data.ts`: legacy status handling and CSV escaping.
- `scripts/preview-dashboard-workspace.ts`: isolated synthetic preview.
- Dashboard test files and the CRM rendering helper: regression coverage.

## Verification

- `npm run typecheck`: passed.
- `npm run build`: passed with Next.js 16.3.5.
- `npm test`: 316 passed, zero failed or skipped, including empty-cohort coverage.
- `npm run lint`: zero errors; one existing warning in
  `mobile/.eas-inspect/src/components/lead-capture-form.tsx`.
- `git diff --check`: passed.

Browser verification used an isolated preview containing 64 synthetic leads and
12 synthetic follow-ups, with no production database access. Checked desktop at
1440 pixels wide and mobile at 393 x 852:

- Four workspace views, period filters, and include-test counts.
- List/board switching, pagination, search, and long-text empty states.
- All-stale-lead drill-down and selected-lead detail focus/scroll.
- Keyboard expansion of the chart's daily-count table.
- Status update through the local API and persistence after refresh.
- View restoration through browser Back and refresh.
- Secure sign-out and return to the access gate.
- No whole-page horizontal overflow at either tested width.
- No captured browser console errors or warnings in the final pass.

The CSV export button was exercised, but the in-app browser download wait timed
out. File delivery is therefore unverified. CSV escaping and formula
neutralization are covered by automated tests. Real report/bill downloads,
production email delivery, and destructive deletion were not performed during
this redesign. Existing automated endpoint tests still pass.

## Reproduce the safe preview

Run `npm run preview:dashboard`, then open
`http://localhost:3101/dashboard`. The local fixture uses port 3201. Check both
ports before starting another instance. Use the synthetic access token
`dashboard-workspace-local-qa`; it is not a production credential.

The launcher uses the guarded `npm run dev` script and replaces the database
connection with an in-memory fixture. Restarting resets the synthetic records.
Stop the parent preview process to terminate its child server.

## Release and follow-up

At release preparation, the configured Supabase database returned an exact count
of zero leads. The then-live dashboard was independently authenticated and
returned a successful empty lead history, without a database error or synthetic
fixture records. No lead deletion or analytics-data reset was necessary.

The synthetic preview is a separate launcher and does not supply data to the
production dashboard. Production uses Vercel's existing database environment
variables. Test leads are excluded by default, so future QA records can be kept
without polluting ordinary lead analytics. Empty-data regression coverage checks
zero leads and activity, with unavailable values/outcomes left unset.

Verify the exact released commit and dashboard after deployment. CSV delivery in
Chrome remains a follow-up check. Do not send messages or delete real records as
part of a visual review.

Next useful additions are full-history server aggregation if the account exceeds
500 records, genuine stage-event history for funnel reporting, and verified
visitor attribution if conversion analytics is desired. These require additional
data work rather than relabeling the current stage counts.

The changes are scoped to the dashboard and its helpers. Rollback should restore
only those task-specific files, preserving unrelated repository work.
