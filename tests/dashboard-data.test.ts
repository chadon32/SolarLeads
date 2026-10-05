import assert from "node:assert/strict";
import test from "node:test";
import {
  averageKnown,
  boundedNumberOrNull,
  compareNullableNumbers,
  DASHBOARD_SNAPSHOT_SELECT,
  escapeDashboardCsvCell,
  finiteNumberOrNull,
  inferLegacyLeadStatus,
  nonNegativeNumberOrNull,
  positiveIntegerOrNull,
  readDashboardSnapshot,
  selectVisibleLead,
  sumKnown,
} from "../src/lib/dashboard-data";

test("dashboard numeric helpers keep missing values unknown while preserving zero", () => {
  assert.equal(finiteNumberOrNull(null), null);
  assert.equal(finiteNumberOrNull(undefined), null);
  assert.equal(finiteNumberOrNull(""), null);
  assert.equal(finiteNumberOrNull("   "), null);
  assert.equal(finiteNumberOrNull(0), 0);
  assert.equal(finiteNumberOrNull("0"), 0);
  assert.equal(finiteNumberOrNull(false), null);
  assert.equal(positiveIntegerOrNull(0.5), null);
  assert.equal(positiveIntegerOrNull(3), 3);

  assert.equal(nonNegativeNumberOrNull(null), null);
  assert.equal(nonNegativeNumberOrNull(""), null);
  assert.equal(nonNegativeNumberOrNull(0), 0);
  assert.equal(boundedNumberOrNull(null, 0, 100), null);
  assert.equal(boundedNumberOrNull("", 0, 100), null);
  assert.equal(boundedNumberOrNull(0, 0, 100), 0);

  assert.equal(averageKnown([null, undefined]), null);
  assert.equal(averageKnown([null, 0, 20]), 10);
  assert.equal(sumKnown([null, 0]), 0);
  assert.equal(sumKnown([null, undefined]), null);
});

test("queued legacy outreach is not evidence that a lead was contacted", () => {
  assert.equal(
    inferLegacyLeadStatus([{ status: "queued" }, { status: "scheduled" }]),
    "new",
  );
  assert.equal(inferLegacyLeadStatus([{ status: "failed" }]), "new");
  assert.equal(inferLegacyLeadStatus([{ status: "sent" }]), "contacted");
});

test("dashboard exports quote CSV characters and neutralize spreadsheet formulas", () => {
  assert.equal(escapeDashboardCsvCell('Mesa, "AZ"'), '"Mesa, ""AZ"""');
  assert.equal(escapeDashboardCsvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(escapeDashboardCsvCell("  +123"), "'  +123");
  assert.equal(escapeDashboardCsvCell("\rmalicious"), '"\'\rmalicious"');
  assert.equal(escapeDashboardCsvCell(null), "");
  assert.equal(escapeDashboardCsvCell(200), "200");
  assert.ok(
    DASHBOARD_SNAPSHOT_SELECT.includes(
      "snapshot_metrics:report_snapshot->metrics",
    ),
  );
  assert.ok(!DASHBOARD_SNAPSHOT_SELECT.split(",").includes("report_snapshot"));
});

test("dashboard snapshot fallback preserves captured metrics and saved zero coverage", () => {
  const snapshot = readDashboardSnapshot({
    version: 1,
    createdAt: "2026-09-21T12:00:00.000Z",
    monthlyBill: 220,
    metrics: {
      annualKwh: 9600,
      annualSavings: 1248,
      coveragePct: 0,
      monthlySavings: 104,
      panelCount: 8,
      paybackYears: 9,
      systemKw: 3.2,
    },
    roofAnalysis: {
      carbonOffsetFactorKgPerMwh: 390,
    },
  });

  assert.ok(snapshot);
  assert.equal(snapshot.metrics.annualKwh, 9600);
  assert.equal(snapshot.metrics.panelCount, 8);
  assert.equal(snapshot.metrics.coveragePct, 0);
  assert.equal(snapshot.carbonOffsetFactorKgPerMwh, 390);

  const legacySnapshot = readDashboardSnapshot({
    version: 1,
    createdAt: "2026-09-21T12:00:00.000Z",
    monthlyBill: null,
    metrics: {
      coveragePct: null,
      annualSavings: 0,
      monthlySavings: 0,
      annualKwh: 0,
    },
  });
  assert.ok(legacySnapshot);
  assert.equal(legacySnapshot.monthlyBill, null);
  assert.equal(legacySnapshot.metrics.coveragePct, null);
  assert.equal(legacySnapshot.metrics.annualSavings, 0);
  assert.equal(legacySnapshot.metrics.monthlySavings, 0);
  assert.equal(legacySnapshot.metrics.annualKwh, 0);
});

test("filtered dashboard selection never keeps a hidden lead", () => {
  const visible = [{ id: "visible" }, { id: "second" }];

  assert.equal(selectVisibleLead(visible, "hidden")?.id, "visible");
  assert.equal(selectVisibleLead(visible, "second")?.id, "second");
  assert.equal(selectVisibleLead([], "hidden"), null);
});

test("dashboard savings sorting keeps unknown values last in both directions", () => {
  const values = [null, 100, 0, 40];

  assert.deepEqual(
    [...values].sort((left, right) =>
      compareNullableNumbers(left, right, "asc"),
    ),
    [0, 40, 100, null],
  );
  assert.deepEqual(
    [...values].sort((left, right) =>
      compareNullableNumbers(left, right, "desc"),
    ),
    [100, 40, 0, null],
  );
});
