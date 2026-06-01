import { createHmac, timingSafeEqual } from "node:crypto";

const UPLOAD_CLAIM_TTL_SECONDS = 60 * 60;

type UtilityBillClaimResult =
  | { ok: true; path: string }
  | { ok: false; reason: "expired" | "invalid" | "missing" | "not_configured" };

export function createUtilityBillUploadClaim(path: string) {
  const secret = getUtilityBillClaimSecret();

  if (!secret) {
    return "";
  }

  const expiresAt = String(Date.now() + UPLOAD_CLAIM_TTL_SECONDS * 1000);
  const encodedPath = base64UrlEncode(path);
  const signature = signClaim(encodedPath, expiresAt, secret);

  return ["v1", encodedPath, expiresAt, signature].join(".");
}

export function verifyUtilityBillUploadClaim(
  claim?: string | null
): UtilityBillClaimResult {
  const secret = getUtilityBillClaimSecret();
  const rawClaim = claim?.trim() ?? "";

  if (!secret) {
    return { ok: false, reason: "not_configured" };
  }

  if (!rawClaim) {
    return { ok: false, reason: "missing" };
  }

  const [version, encodedPath, expiresAt, signature] = rawClaim.split(".");
  const expiry = Number(expiresAt);

  if (
    version !== "v1" ||
    !encodedPath ||
    !expiresAt ||
    !signature ||
    !Number.isFinite(expiry)
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (Date.now() > expiry) {
    return { ok: false, reason: "expired" };
  }

  const expected = signClaim(encodedPath, expiresAt, secret);

  if (!constantTimeEquals(expected, signature)) {
    return { ok: false, reason: "invalid" };
  }

  const path = base64UrlDecode(encodedPath);

  if (!path.startsWith("pending/") || path.includes("..")) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, path };
}

function getUtilityBillClaimSecret() {
  return (
    process.env.UTILITY_BILL_UPLOAD_SECRET?.trim() ||
    process.env.REPORT_SIGNING_SECRET?.trim() ||
    process.env.DASHBOARD_ACCESS_TOKEN?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

function signClaim(encodedPath: string, expiresAt: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`utility-bill-upload:${encodedPath}:${expiresAt}`)
    .digest("hex");
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length || !leftBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8"
  );
}
