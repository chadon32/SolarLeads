import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const UPLOAD_CLAIM_TTL_SECONDS = 60 * 60;
const MIN_PRODUCTION_SECRET_LENGTH = 32;

type UtilityBillClaimResult =
  | { ok: true; path: string }
  | { ok: false; reason: "expired" | "invalid" | "missing" | "not_configured" };

export function createUtilityBillUploadClaim(path: string) {
  const secret = getDedicatedUtilityBillClaimSecret();

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
  const secrets = getUtilityBillClaimSecrets();
  const rawClaim = claim?.trim() ?? "";

  if (!secrets.length) {
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

  const valid = secrets.some((secret) =>
    constantTimeEquals(signClaim(encodedPath, expiresAt, secret), signature)
  );

  if (!valid) {
    return { ok: false, reason: "invalid" };
  }

  const path = base64UrlDecode(encodedPath);

  if (!path.startsWith("pending/") || path.includes("..")) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, path };
}

export function isUtilityBillUploadSecretConfigured() {
  return Boolean(getDedicatedUtilityBillClaimSecret());
}

function getDedicatedUtilityBillClaimSecret() {
  const secret = process.env.UTILITY_BILL_UPLOAD_SECRET?.trim() ?? "";

  if (
    process.env.NODE_ENV === "production" &&
    secret.length < MIN_PRODUCTION_SECRET_LENGTH
  ) {
    return "";
  }

  return secret;
}

function getUtilityBillClaimSecrets() {
  const dedicated = getDedicatedUtilityBillClaimSecret();

  if (dedicated) {
    return [dedicated, getLegacyUtilityBillClaimSecret()].filter(Boolean);
  }

  // This explicit migration value is verification-only. It allows claims
  // issued before the dedicated secret was introduced to expire naturally;
  // new claims remain disabled until the dedicated secret is configured.
  return [getLegacyUtilityBillClaimSecret()].filter(Boolean);
}

function getLegacyUtilityBillClaimSecret() {
  return process.env.UTILITY_BILL_UPLOAD_LEGACY_SECRET?.trim() ?? "";
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
