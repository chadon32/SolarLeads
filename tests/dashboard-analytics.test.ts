import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardAnalytics,
  dashboardDay,
  normalizeDashboardView,
  scopeDashboardLeads,
} from "../src/lib/dashboard-analytics";
import type { LeadStatus } from "../src/lib/lead-status";

const now = "2026-10-05T19:00:00.000Z";
const lead = (id: string, status: LeadStatus = "new", overrides = {}) => ({
  id,
  status,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: null,
  annualSavings: 2000,
  systemCostBeforeIncentives: 25000,
  leadScore: 75,
  pdfStatus: "ready" as const,
  utilityBillUploaded: false,
  selectedPanelBrand: "Qcells",
  referredBy: null,
  dataQuality: "complete" as const,
  ...overrides,
});

test("an empty production cohort has no invented leads, activity, or outcomes", () => {
  const summary = buildDashboardAnalytics([], now, "30");
  assert.equal(summary.total, 0);
  assert.equal(summary.open, 0);
  assert.equal(summary.today, 0);
  assert.equal(summary.won, 0);
  assert.equal(summary.lost, 0);
  assert.equal(summary.winRate, null);
  assert.equal(summary.openValue, null);
  assert.equal(summary.averageSavings, null);
  assert.equal(summary.averageScore, null);
  assert.deepEqual(summary.brands, []);
  assert.deepEqual(summary.newLeads, []);
  assert.deepEqual(summary.stale, []);
  assert.ok(summary.stages.every((stage) => stage.count === 0));
  assert.ok(summary.trend.every((day) => day.count === 0));
});

test("dashboard cohorts exclude test leads and respect Phoenix midnight", () => {
  const rows = [
    lead("qa", "test-lead"),
    lead("cutoff", "new", { createdAt: "2026-09-29T07:00:00Z" }),
    lead("before", "new", { createdAt: "2026-09-29T06:59:59Z" }),
    lead("future", "new", { createdAt: "2026-10-07T12:00:00Z" }),
    lead("invalid", "new", { createdAt: "bad date" }),
  ];
  assert.deepEqual(
    scopeDashboardLeads(rows, "7", false, now).map((row) => row.id),
    ["cutoff"],
  );
  assert.deepEqual(
    scopeDashboardLeads(rows, "7", true, now).map((row) => row.id),
    ["qa", "cutoff"],
  );
  assert.equal(dashboardDay("2026-10-05T06:59:59Z"), "2026-10-04");
});

test("open modeled value excludes won/lost costs and preserves missing data", () => {
  const summary = buildDashboardAnalytics(
    [
      lead("open"),
      lead("unknown", "contacted", { systemCostBeforeIncentives: null }),
      lead("won", "closed-won"),
      lead("lost", "closed-lost"),
    ],
    now,
    "30",
  );
  assert.equal(summary.open, 2);
  assert.equal(summary.openValue, 25000);
  assert.equal(summary.openValueKnown, 1);
  assert.equal(summary.winRate, 50);
  assert.equal(summary.total, 4);
  assert.equal(
    summary.stages.reduce((sum, item) => sum + item.count, 0),
    4,
  );
});

test("no recorded value or closed outcomes is not invented as zero", () => {
  const summary = buildDashboardAnalytics(
    [
      lead("unknown", "new", {
        annualSavings: null,
        leadScore: null,
        systemCostBeforeIncentives: null,
        selectedPanelBrand: null,
      }),
    ],
    now,
    "7",
  );
  assert.equal(summary.openValue, null);
  assert.equal(summary.winRate, null);
  assert.equal(summary.averageSavings, null);
  assert.deepEqual(summary.brands, [{ label: "Not captured", count: 1 }]);
});

test("daily trend and today's total use the same timezone and do not count old records", () => {
  const summary = buildDashboardAnalytics(
    [
      lead("today", "new", { createdAt: now }),
      lead("yesterday", "new", { createdAt: "2026-10-05T06:59:59Z" }),
      lead("old", "new", { createdAt: "2025-01-01T12:00:00Z" }),
    ],
    now,
    "7",
  );
  assert.equal(summary.today, 1);
  assert.equal(summary.trend.length, 7);
  assert.deepEqual(summary.trend.at(-1), { day: "2026-10-05", count: 1 });
  assert.equal(
    summary.trend.reduce((sum, item) => sum + item.count, 0),
    2,
  );
});

test("all-record view retains records but charts a clearly defined latest 30 days", () => {
  const summary = buildDashboardAnalytics(
    [lead("old", "new", { createdAt: "2025-01-01T12:00:00Z" })],
    now,
    "all",
  );
  assert.equal(summary.total, 1);
  assert.equal(summary.trendDays, 30);
  assert.equal(
    summary.trend.reduce((sum, item) => sum + item.count, 0),
    0,
  );
});

test("stale priorities use the latest saved update and only include open leads", () => {
  const summary = buildDashboardAnalytics(
    [
      lead("stale", "new", { createdAt: "2026-09-20T12:00:00Z" }),
      lead("fresh", "new", {
        createdAt: "2026-09-20T12:00:00Z",
        updatedAt: now,
      }),
      lead("won", "closed-won", { createdAt: "2026-09-20T12:00:00Z" }),
    ],
    now,
    "30",
  );
  assert.deepEqual(
    summary.stale.map((row) => row.id),
    ["stale"],
  );
});

test("zero savings is a captured value and dashboard view parameters are allowlisted", () => {
  const summary = buildDashboardAnalytics(
    [lead("zero", "new", { annualSavings: 0 })],
    now,
    "30",
  );
  assert.equal(summary.averageSavings, 0);
  assert.equal(normalizeDashboardView("analytics"), "analytics");
  assert.equal(normalizeDashboardView(["pipeline"]), "overview");
  assert.equal(normalizeDashboardView("https://bad.test"), "overview");
});
