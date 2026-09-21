import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFollowUpIdempotencyKey,
  FOLLOW_UP_CLAIM_TIMEOUT_MS,
  getStaleFollowUpClaimCutoff,
  isClaimableFollowUpStatus,
} from "../src/lib/follow-up-state";

test("only unfinished follow-up states can be claimed for manual delivery", () => {
  for (const status of ["queued", "scheduled"]) {
    assert.equal(isClaimableFollowUpStatus(status), true);
  }

  for (const status of ["failed", "needs_review", "processing", "sent", "skipped", "cancelled"]) {
    assert.equal(isClaimableFollowUpStatus(status), false);
  }
});

test("follow-up provider idempotency keys are stable and row-specific", () => {
  assert.equal(
    buildFollowUpIdempotencyKey("follow-up-123"),
    "solartelligence-follow-up-follow-up-123"
  );
  assert.notEqual(
    buildFollowUpIdempotencyKey("follow-up-123"),
    buildFollowUpIdempotencyKey("follow-up-456")
  );
});

test("stale claim cutoff uses the configured recovery window", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");

  assert.equal(
    getStaleFollowUpClaimCutoff(now),
    new Date(now.getTime() - FOLLOW_UP_CLAIM_TIMEOUT_MS).toISOString()
  );
});
