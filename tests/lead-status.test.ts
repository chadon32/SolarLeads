import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAD_STATUS_OPTIONS,
  normalizeLeadStatus,
} from "../src/lib/lead-status";

test("test lead is a supported status and normalizes persisted labels", () => {
  assert.ok(LEAD_STATUS_OPTIONS.some((status) => status.id === "test-lead"));
  assert.equal(normalizeLeadStatus("Test Lead"), "test-lead");
  assert.equal(normalizeLeadStatus("test-lead"), "test-lead");
});

test("lead status normalization keeps the quote-requested compatibility alias", () => {
  assert.equal(normalizeLeadStatus("Quote Requested"), "quoted");
  assert.equal(normalizeLeadStatus("quote-requested"), "quoted");
});

test("lead status normalization rejects unsupported or non-string values", () => {
  assert.equal(normalizeLeadStatus("constructor"), null);
  assert.equal(normalizeLeadStatus("in-progress"), null);
  assert.equal(normalizeLeadStatus(null), null);
});
