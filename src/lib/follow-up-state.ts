export const CLAIMABLE_FOLLOW_UP_STATUSES = [
  "queued",
  "scheduled",
] as const;

export const SCHEDULER_FOLLOW_UP_STATUSES = ["queued", "scheduled"] as const;

export const FOLLOW_UP_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

export function isClaimableFollowUpStatus(status: string) {
  return (CLAIMABLE_FOLLOW_UP_STATUSES as readonly string[]).includes(status);
}

export function buildFollowUpIdempotencyKey(followUpId: string) {
  return `solartelligence-follow-up-${followUpId}`;
}

export function getStaleFollowUpClaimCutoff(now = new Date()) {
  return new Date(now.getTime() - FOLLOW_UP_CLAIM_TIMEOUT_MS).toISOString();
}

export function initialReportDeliveryStatus(emailSentAt?: string | null) {
  return emailSentAt && Number.isFinite(Date.parse(emailSentAt)) ? "sent" : "needs_review";
}
