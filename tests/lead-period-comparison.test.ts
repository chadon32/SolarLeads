import assert from "node:assert/strict";
import test from "node:test";
import { compareLeadPeriods, comparisonCsv } from "../src/lib/lead-period-comparison";
import type { ContactRequest } from "../src/lib/dashboard-contact";

const asOf = "2028-03-03T06:59:59Z"; // March 2, 23:59 in Phoenix.
const lead = (createdAt: string, request: ContactRequest = "requested", qa = false) =>
  ({ createdAt, contact: { request }, status: qa ? "test-lead" as const : "new" as const });
function compare(leads: ReturnType<typeof lead>[], includeTests = false, limited = false) {
  const result = compareLeadPeriods(leads, "7", asOf, includeTests, limited);
  assert.equal(result.mode, "comparison");
  return result;
}

test("adjacent completed Phoenix days handle leap day, exact midnight, today and future submissions", () => {
  const data = compare([
    lead("2028-02-17T06:59:59Z"), lead("2028-02-17T07:00:00Z", "report"),
    lead("2028-02-24T06:59:59Z"), lead("2028-02-24T07:00:00Z", "unknown"),
    lead("2028-02-29T19:00:00Z"), lead("2028-03-02T06:59:59Z", "report"),
    lead("2028-03-02T07:00:00Z"), lead("2029-01-01T09:00:00Z"),
  ]);
  assert.deepEqual(data.recent, { start: "2028-02-24", end: "2028-03-01" });
  assert.deepEqual(data.previous, { start: "2028-02-17", end: "2028-02-23" });
  assert.deepEqual(data.rows.map(r => [r.recent, r.previous, r.change]), [[3, 2, 1], [1, 1, 0], [1, 1, 0], [1, 0, 1]]);
});

test("zero history is zero rather than a fabricated rate; unavailable preferences do not imply consent", () => {
  assert.ok(compare([]).rows.every(row => row.recent === 0 && row.previous === 0 && row.change === 0));
  const items = [lead("2028-03-01T15:00:00Z", "unknown"), lead("2028-02-22T15:00:00Z", "requested", true)];
  assert.equal(compare(items).rows[1].change, 0);
  assert.equal(compare(items, true).rows[1].change, -1);
  assert.equal(compare(items).rows[3].recent, 1);
});

test("a clipped history withholds incomplete counts even when all the oldest records are excluded test leads", () => {
  const items = [lead("2028-03-01T12:00:00Z"), lead("2028-02-17T08:00:00Z", "report", true)];
  const clipped = compare(items, false, true);
  assert.deepEqual(clipped.rows[0], { label: "Lead submissions", recent: 1, previous: null, change: null });
  const complete = compare([...items, lead("2028-02-16T19:00:00Z", "unknown", true)], false, true);
  assert.equal(complete.rows[0].previous, 0);
  assert.equal(complete.rows[0].change, 1);
  assert.ok(compare([], false, true).rows.every(row => row.recent === null && row.previous === null));
});

test("unassignable included records prevent false comparisons; all-history and invalid snapshots provide no invented window", () => {
  assert.equal(compare([lead("invalid")]).unplaceable, true);
  assert.equal(compare([lead("invalid")]).rows[0].recent, null);
  assert.equal(compare([lead("invalid", "unknown", true)]).rows[0].recent, 0);
  assert.equal(compareLeadPeriods([], "all", asOf, true, false).mode, "all");
  assert.equal(compareLeadPeriods([], "30", "", false, false).mode, "undated");
});

test("longer windows span year boundaries and aggregate CSV records exact dates, nulls and test scope", () => {
  for (const [period, start] of [["30", "2028-01-02"], ["90", "2027-11-03"]] as const) {
    const result = compareLeadPeriods([], period, "2028-02-01T09:00:00Z", false, false);
    assert.equal(result.mode, "comparison");
    assert.equal(result.recent.start, start);
    assert.equal(result.recent.end, "2028-01-31");
  }
  const csv = comparisonCsv(compare([lead("2028-02-21T12:00:00Z")], true, true));
  assert.ok(csv.includes("Lead submissions,2028-02-24,2028-03-01,0,2028-02-17,2028-02-23,Unavailable,Unavailable,true\r\n"));
  assert.equal(csv.trimEnd().split("\r\n").length, 5);
  assert.doesNotMatch(csv, /email|name|address|phone/i);
});
