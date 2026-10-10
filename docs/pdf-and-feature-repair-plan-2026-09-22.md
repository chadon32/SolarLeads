# PDF redesign and feature repair plan

Date: 2026-09-22. Status: bounded local implementation and verification complete; not deployed.

Execution results: `docs/pdf-and-feature-audit-results-2026-09-22.md`. Browser evidence and persona journeys: `docs/feature-audit-2026-09-22.md`.

## Objective and boundaries

Replace the crowded, legacy PDF presentation with a readable, credible solar report and audit the connected customer workflows. Preserve the existing dark navy/cyan brand, current Sunlight/3D tabs, saved reports, authentication, and unrelated uncommitted work. No deployment, production database writes, real leads, email deliveries, paid scans, or new paid services are authorized by this pass.

Confirmed from the generator: the PDF uses fixed-coordinate text and satellite panel overlays, not the interactive 3D renderer. The date block can wrap into the readiness block. Ten PDF pages are produced. The report already uses a saved analysis snapshot; regenerating a different roof during download would break that contract.

## Ownership and execution

1. Lead: PDF route integration, layout redesign, baseline/sample PDF generation, visual inspection, combined tests and final findings. Owns `src/app/api/report/pdf/route.ts`, PDF integration tests/scripts and this document.
2. Luna Max worker A: new pure roof illustration module and its unit tests only. Produce a perspective roof illustration using saved geographic roof outlines, pitch and selected panel geometry. No fabricated architectural detail, no remote imagery, no route edits. Return unavailable for unsuitable geometry. Label reconstructed heights as approximate, not an elevation scan.
3. Luna Max worker B: end-to-end audit evidence and bounded new browser regression tests. Owns a new feature audit document and a new test file. Exercise local application with synthetic API fixtures on desktop and 393 x 852 mobile. Record real failures separately from mock/tool limitations. No production application edits until agreed with lead.
4. Luna Max worker C: saved report snapshot consistency. Owns `src/lib/report-snapshot.ts` and its unit tests. Validate selected count/equipment, missing versus zero values, and normalization invariants. Preserve existing valid snapshots; fix reproducible inconsistencies only.

Workers are not alone in this checkout. No resets, reverts, commits, nested agents, or changes outside their write boundaries. Lead reviews all patches and performs integrated verification.

Execution adjustment: worker B reproduced a server-success/browser-storage-failure bug. Lead explicitly expanded that worker's ownership to the lead form for the bounded repair and its browser regression. Lead additionally repaired the report viewer's missing-value handling after finding the same data-integrity problem there. All three Luna workers completed their assignments and were closed; lead reviewed and integrated the work.

## Phase 1: Evidence and baseline

- Trace browser selections -> signed analysis -> lead validation -> saved snapshot -> PDF -> viewer/download.
- Generate a representative synthetic PDF without live Supabase, Maps, mail or customer data.
- Include realistic date, long name/address, selected modules, missing geometry and missing metrics cases.
- Capture the pre-change artifact. Record page count, bytes, generation time and visual defects; do not mistake these local fixture numbers for production performance.
- Inventory public navigation, address search, bill entry/upload, roof views, module/panel selection, savings/financing, report form/download, dashboard access and mobile bridge.

## Phase 2: PDF visual and data repair

### Cover and shared layout

- Give name, address, report identity/date and readiness separate bounded areas.
- Establish a consistent typographic hierarchy, margins, spacing and restrained source labels.
- Prevent long labels and unbroken strings from overflowing their containers.
- Keep source/caveat text readable; remove repeated badges over roof imagery.
- Check page headings, footers, cards, tables and page numbering on all pages, not just the cover.

### Roof visual

- Prefer a crisp vector perspective illustration derived from the immutable saved roof analysis and selected panels for the cover and layout page.
- Use the same geographic panel-selection/dimension helpers as the app where possible.
- Fit the full model in its frame, preserve aspect ratio, depth-order surfaces and distinguish roof from modules.
- State that inferred elevation/roof-plane illustration is approximate and not the interactive DSM scan or construction design.
- If saved outlines/placements are insufficient, show a clean satellite context image or explicit unavailable state. Never draw invented panels on an unrelated generic house.
- Preserve imagery attribution and separate sunlight/roof context from panel layout.

### Reliability

- PDF generation must not require WebGL or a browser session.
- Image failures/timeouts must not prevent the numeric report from downloading.
- Preserve signed links and no-store/noindex protections.
- Mark generated/downloaded only after successful generation, not before asset/render failure.
- Check zero, missing and stale values and selected-module consistency.

## Phase 3: Feature audit matrix

| Workflow | Required checks | Evidence / acceptance |
| --- | --- | --- |
| Landing/navigation | Desktop/mobile, navigation, guide/privacy/terms, CTA, back/refresh | No dead ends or horizontal overflow; expected route/content |
| Address | Blank, partial, valid fixture, invalid/outside area, rapid edit, loading/failure | Helpful validation; no stale selection or duplicate scans |
| Electric bill | Empty, zero, negative, upper limit, text, keyboard hints | Invalid amounts blocked; valid selected amount preserved |
| Bill upload | Allowed PDF/image, unsupported type, too large, retry/failure | Actionable error and recoverable state; no real upload |
| Roof analysis | Loading, unavailable, retry, sunlight and 3D, layer controls | Clear fallback; no crash; successful fixture render |
| Panel/equipment | Min/max count, module changes, dimensions/count/system size | All views and snapshot agree; technical caveats visible |
| Savings/financing | Bill/equipment edits, assumptions, optional battery, missing data | Active estimate reflected consistently; no guaranteed savings claims |
| Report form | Empty submit, highlighted fields, focus, phone optional, consent, duplicate click | Required fields discoverable; no unsolicited lead; safe mocked success/error |
| PDF/viewer | Valid/invalid/expired signed links, missing snapshot, long content | PDF response remains protected and readable; appropriate HTTP errors |
| Dashboard | Unauthenticated access, existing unit coverage of filters/stats | Protected; synthetic only; live owner workflow recorded as unverified if unavailable |
| Native app | Inspect website bridge and run available checks | Explicitly distinguish shared web behavior from untested installed iOS build |
| Accessibility | Keyboard, labels, touch controls, focus, existing axe tests | Record blockers and residual gaps without claiming full WCAG certification |

## Phase 4: Verification gates

- Run targeted geometry/snapshot/PDF tests then full unit suite.
- Run type check, lint, production build and mobile type check where supported.
- Execute actual browser journeys with safe mocked APIs; capture screenshots and reproduction steps for confirmed failures.
- Render PDFs to images and inspect every page. Generate a long-content and missing-data variant to catch regressions.
- Verify PDF text extraction, page bounds, numeric agreement, metadata, download response and privacy headers.
- Review combined diff; no production deploy. Report exact passes/failures and untested external integrations.

## Prioritization and completion criteria

- P0: security/data corruption, lost submission, misleading saved values, crashes. Fix reproducible in-scope causes first.
- P1: unreadable PDF, inaccurate visual implications, blocked form/upload/retry, mobile overflow. Fix and add regression tests.
- P2: consistency, accessibility and performance defects with evidence. Address bounded fixes; document larger design work.
- P3: polish or new features. Keep separate from blockers and avoid arbitrary scope expansion.

Complete this pass only with a rendered improved sample, meaningful feature test results, reviewed worker patches, a detailed findings/status report, and a clear list of external checks or approvals still needed. Passing mocks does not prove live provider availability, email delivery, roof accuracy or native App Store behavior.
