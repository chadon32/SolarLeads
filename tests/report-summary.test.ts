import assert from "node:assert/strict";
import test from "node:test";
import { buildSavedReportSummary, formatSavedReportValue } from "../src/lib/report-summary";
import { makePdfLead } from "./helpers/pdf-fixture";

test("report preview keeps absent measurements unknown", () => {
  const summary = buildSavedReportSummary({}, null);
  assert.deepEqual(summary, {
    annualSavings: null, systemSizeKw: null, panelCount: null, roiYears: null, energyOffset: null,
  });
  assert.equal(formatSavedReportValue(summary.energyOffset, "percent"), "Unavailable");
  assert.equal(formatSavedReportValue(summary.systemSizeKw, "kw"), "Unavailable");
});

test("report preview preserves saved zero instead of a positive fallback", () => {
  const lead = makePdfLead();
  lead.report_snapshot!.metrics.annualSavings = 0;
  lead.report_snapshot!.metrics.coveragePct = 0;
  const summary = buildSavedReportSummary(lead, lead.report_snapshot!);
  assert.equal(summary.annualSavings, 0);
  assert.equal(summary.energyOffset, 0);
  assert.equal(formatSavedReportValue(summary.annualSavings, "money"), "$0");
  assert.equal(formatSavedReportValue(summary.energyOffset, "percent"), "0%");
  assert.equal(formatSavedReportValue(0, "panels"), "0");
});

test("legacy preview uses recorded savings without inventing system size or payback", () => {
  const summary = buildSavedReportSummary({ estimated_savings: 1500, panel_count: 20 }, null);
  assert.equal(summary.annualSavings, 1500);
  assert.equal(summary.panelCount, 20);
  assert.equal(summary.systemSizeKw, null);
  assert.equal(summary.roiYears, null);
  assert.equal(formatSavedReportValue(0, "years"), "Unavailable");
  assert.equal(formatSavedReportValue(8.2, "kw"), "8.2 kW");
});
