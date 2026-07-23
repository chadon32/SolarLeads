import "server-only";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/rate-limit";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

type TurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; message: string };

export function getRequestAbuseMeta(request: Request) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  return {
    ipHash: privacyHash(ip),
    userAgentHash: privacyHash(userAgent),
  };
}

export function logAbuseSignal(
  request: Request,
  event: string,
  details: Record<string, unknown> = {}
) {
  const meta = getRequestAbuseMeta(request);

  console.info("[abuse-protection]", {
    event,
    ipHash: meta.ipHash,
    userAgentHash: meta.userAgentHash,
    ...sanitizeLogDetails(details),
  });
}

function privacyHash(value: string) {
  const secret = process.env.RATE_LIMIT_SECRET?.trim();

  if (!secret && process.env.NODE_ENV === "production") {
    return "unavailable";
  }

  return createHmac("sha256", secret || "local-abuse-log-key")
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

function sanitizeLogDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (/address|email|phone|name|token|secret|url|lead.?id/i.test(key)) {
        return [`${key}Hash`, privacyHash(String(value ?? ""))];
      }

      return [key, value];
    })
  );
}

export function rateLimitResponse(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { message },
    {
      status: 429,
      headers: {
        "Retry-After": retryAfterSeconds.toString(),
      },
    }
  );
}

export function isRequestTooLarge(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export type LimitedJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: "invalid" | "too_large" };

export type LimitedTextResult =
  | { ok: true; data: string }
  | { ok: false; reason: "invalid" | "too_large" };

export async function readJsonWithLimit(
  request: Request,
  maxBytes: number
): Promise<LimitedJsonResult> {
  const body = await readTextWithLimit(request, maxBytes);

  if (!body.ok) {
    return body;
  }

  try {
    return { ok: true, data: JSON.parse(body.data) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function readTextWithLimit(
  request: Request,
  maxBytes: number
): Promise<LimitedTextResult> {
  if (isRequestTooLarge(request, maxBytes)) {
    return { ok: false, reason: "too_large" };
  }

  if (!request.body) {
    return { ok: false, reason: "invalid" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }

      body += decoder.decode(value, { stream: true });
    }

    body += decoder.decode();
    return { ok: true, data: body };
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

export function payloadTooLargeResponse(message = "The submitted payload is too large.") {
  return NextResponse.json({ message }, { status: 413 });
}

export function isKillSwitchEnabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export function maintenanceModeResponse() {
  if (!isKillSwitchEnabled("MAINTENANCE_MODE")) {
    return null;
  }

  return NextResponse.json(
    {
      message:
        "Solartelligence is temporarily in maintenance mode. Please try again shortly.",
    },
    { status: 503 }
  );
}

export function disabledFeatureResponse(message: string) {
  return NextResponse.json({ message }, { status: 503 });
}

export function isLikelyBotAddress(address?: string | null) {
  const normalized = String(address ?? "").trim().toLowerCase();

  if (!normalized) return true;
  if (normalized.length < 8 || normalized.length > 220) return true;
  if (!/\d/.test(normalized) || !/[a-z]/.test(normalized)) return true;
  if (/\b(asdf|qwerty|test address|fake address|unknown|n\/a)\b/.test(normalized)) {
    return true;
  }
  if (/\bpo box\b/.test(normalized)) return true;

  return false;
}

export function isHoneypotFilled(...values: Array<unknown>) {
  return values.some((value) => String(value ?? "").trim().length > 0);
}

export function isTooFastSubmission(startedAt?: string | number | null, minimumMs = 5000) {
  const started = Number(startedAt);

  if (!Number.isFinite(started) || started <= 0) {
    return true;
  }

  return Date.now() - started < minimumMs;
}

export async function verifyTurnstileToken({
  request,
  token,
}: {
  request: Request;
  token?: string | null;
}): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

  if (!secret) {
    return { ok: true, skipped: true };
  }

  if (!token?.trim()) {
    return {
      ok: false,
      message: "Please complete the verification challenge before submitting.",
    };
  }

  const formData = new FormData();
  formData.set("secret", secret);
  formData.set("response", token.trim());
  formData.set("remoteip", getClientIp(request));

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: formData,
        method: "POST",
      }
    );
    const result = (await response.json().catch(() => ({}))) as {
      success?: boolean;
    };

    if (response.ok && result.success) {
      return { ok: true, skipped: false };
    }
  } catch {
    // Fall through to a safe failure below.
  }

  return {
    ok: false,
    message: "Verification failed. Please refresh and try again.",
  };
}
