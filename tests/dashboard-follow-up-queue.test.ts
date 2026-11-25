import assert from "node:assert/strict";
import test from "node:test";
import { followUpExportRows, groupFollowUpQueue } from "../src/lib/dashboard-follow-up-queue";

const now = "2026-01-02T00:00:00-07:00";
const item = (id: string, status: string, scheduledFor = now) => ({ id, status, scheduledFor, channel: "email", leadId: "qa" });

test("due and upcoming use exact instants, oldest first, without reordering the all view", () => {
  const items = [item("boundary", "queued"), item("next", "scheduled", "2026-01-02T07:00:00.001Z"),
    item("older", "scheduled", "2026-01-02T06:59:59.999Z")];
  const q = groupFollowUpQueue(items, now);
  assert.deepEqual(q.due.map(i => i.id), ["older", "boundary"]);
  assert.deepEqual(q.upcoming.map(i => i.id), ["next"]);
  assert.deepEqual(q.all.map(i => i.id), ["boundary", "next", "older"]);
});

test("terminal, processing and unknown status are never due; no schedule is never assumed overdue", () => {
  const items = ["sent", "skipped", "processing", "cancelled", "failed", "needs_review", "scheduled", "queued"]
    .map(s => item(s, s, "missing"));
  const q = groupFollowUpQueue(items, now);
  assert.deepEqual(q.attention.map(i => i.id), ["failed", "needs_review"]);
  assert.deepEqual(q.sent.map(i => i.id), ["sent"]);
  assert.deepEqual(q.unscheduled.map(i => i.id), ["scheduled", "queued"]);
  assert.deepEqual(q.due, []);
  assert.deepEqual(q.upcoming, []);
  assert.equal(q.all.length, items.length);
  assert.deepEqual(groupFollowUpQueue([item("1", "queued")], "unknown").due, []);
});

test("queue CSV exports only operational fields, UTC instants and a header for empty results", () => {
  const header = ["follow_up_id", "lead_id", "channel", "status", "scheduled_at_utc"];
  const testItem = { ...item("1", "failed"), message: "private", title: "private", email: "private" };
  assert.deepEqual(followUpExportRows([testItem, item("2", "queued", "")]), [header,
    ["1", "qa", "email", "failed", "2026-01-02T07:00:00.000Z"], ["2", "qa", "email", "queued", ""]]);
  assert.deepEqual(followUpExportRows([]), [header]);
});
