import assert from "node:assert/strict";
import test from "node:test";
import {
  getReportEmailDeliveryCopy,
  getReportEmailDeliveryStatus,
  normalizeReportEmailDeliveryStatus,
} from "../src/lib/report-email-status";

test("report email status distinguishes sent, rejected, and skipped delivery", () => {
  assert.equal(getReportEmailDeliveryStatus({ ok: true }), "sent");
  assert.equal(
    getReportEmailDeliveryStatus({ ok: false, skipped: false }),
    "failed"
  );
  assert.equal(
    getReportEmailDeliveryStatus({ ok: false, skipped: true }),
    "unavailable"
  );
});

test("report email copy is truthful and gives a next step", () => {
  assert.match(getReportEmailDeliveryCopy("failed").message, /secure report link/);
  assert.match(getReportEmailDeliveryCopy("unavailable").title, /unavailable/);
  assert.equal(normalizeReportEmailDeliveryStatus("delayed"), "unavailable");
  assert.equal(normalizeReportEmailDeliveryStatus("sent"), "sent");
});
