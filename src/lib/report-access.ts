import { createHmac, timingSafeEqual } from "node:crypto";

const REPORT_SECRET = process.env.REPORT_SIGNING_SECRET?.trim();
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "http://localhost:3000";

function toExpiry(expiresInSeconds = 24 * 60 * 60) {
  return Date.now() + expiresInSeconds * 1000;
}

function signValue(leadId: string, expiresAt: number) {
  if (!REPORT_SECRET) {
    return "";
  }

  return createHmac("sha256", REPORT_SECRET)
    .update(`${leadId}:${expiresAt}`)
    .digest("hex");
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length || !leftBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildReportPdfPath(
  leadId: string,
  options: { expiresInSeconds?: number } = {}
) {
  if (!REPORT_SECRET) {
    return `/api/report/pdf?leadId=${encodeURIComponent(leadId)}`;
  }

  const expiresAt = toExpiry(options.expiresInSeconds);
  const token = signValue(leadId, expiresAt);

  return `/api/report/pdf?leadId=${encodeURIComponent(leadId)}&exp=${expiresAt}&token=${token}`;
}

export function buildReportAccessPath(leadId: string) {
  return `/api/report/access?leadId=${encodeURIComponent(leadId)}`;
}

export function buildReportPdfUrl(
  leadId: string,
  options: { expiresInSeconds?: number; absolute?: boolean } = {}
) {
  const path = buildReportPdfPath(leadId, {
    expiresInSeconds: options.expiresInSeconds,
  });

  if (!options.absolute) {
    return path;
  }

  return new URL(path, SITE_URL).toString();
}

export function buildReportAccessUrl(
  leadId: string,
  options: { absolute?: boolean } = {}
) {
  const path = buildReportAccessPath(leadId);

  if (!options.absolute) {
    return path;
  }

  return new URL(path, SITE_URL).toString();
}

export function verifyReportSignature(
  leadId: string,
  expiresAt: string | number | null,
  token: string | null
) {
  if (!REPORT_SECRET) {
    return { ok: true, expired: false };
  }

  if (!expiresAt || !token) {
    return { ok: false, expired: false };
  }

  const expiry = Number(expiresAt);

  if (!Number.isFinite(expiry)) {
    return { ok: false, expired: false };
  }

  if (Date.now() > expiry) {
    return { ok: false, expired: true };
  }

  const expected = signValue(leadId, expiry);

  return {
    ok: constantTimeEquals(expected, token),
    expired: false,
  };
}
