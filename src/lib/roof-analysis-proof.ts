import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import { normalizeAddress } from "@/lib/lead-normalization";

const SIGNING_SECRET = process.env.REPORT_SIGNING_SECRET?.trim();
const REQUIRE_PROOF = process.env.NODE_ENV === "production";
const ROOF_ANALYSIS_PROOF_TTL_SECONDS = 60 * 60 * 24;

export type RoofAnalysisProof = {
  exp: number;
  token: string;
};

export type RoofAnalysisProofResult =
  | { ok: true; skipped: boolean }
  | {
      expired: boolean;
      missingSecret: boolean;
      ok: false;
      reason: "expired" | "invalid" | "missing-proof" | "missing-secret";
    };

export function buildRoofAnalysisProof({
  address,
  analysis,
  expiresInSeconds = ROOF_ANALYSIS_PROOF_TTL_SECONDS,
}: {
  address: string;
  analysis: RoofAnalysis;
  expiresInSeconds?: number;
}): RoofAnalysisProof | null {
  if (!SIGNING_SECRET) {
    return null;
  }

  const exp = Date.now() + expiresInSeconds * 1000;

  return {
    exp,
    token: signRoofAnalysis(address, analysis, exp),
  };
}

export function verifyRoofAnalysisProof({
  address,
  analysis,
  proof,
}: {
  address?: string | null;
  analysis?: RoofAnalysis | null;
  proof?: RoofAnalysisProof | null;
}): RoofAnalysisProofResult {
  if (!SIGNING_SECRET) {
    if (!REQUIRE_PROOF) {
      return { ok: true, skipped: true };
    }

    return {
      expired: false,
      missingSecret: true,
      ok: false,
      reason: "missing-secret",
    };
  }

  if (!address || !analysis || !proof?.exp || !proof.token) {
    return {
      expired: false,
      missingSecret: false,
      ok: false,
      reason: "missing-proof",
    };
  }

  const exp = Number(proof.exp);

  if (!Number.isFinite(exp) || Date.now() > exp) {
    return {
      expired: true,
      missingSecret: false,
      ok: false,
      reason: "expired",
    };
  }

  const expected = signRoofAnalysis(address, analysis, exp);

  return constantTimeEquals(expected, proof.token)
    ? { ok: true, skipped: false }
    : {
        expired: false,
        missingSecret: false,
        ok: false,
        reason: "invalid",
      };
}

function signRoofAnalysis(address: string, analysis: RoofAnalysis, exp: number) {
  const normalizedAddress = normalizeAddress(address) ?? "";

  return createHmac("sha256", SIGNING_SECRET ?? "")
    .update(`v1:${normalizedAddress}:${Math.floor(exp)}:${stableJson(analysis)}`)
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

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
