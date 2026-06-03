import { createHash } from "node:crypto";
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
  const userAgentHash = createHash("sha256").update(userAgent).digest("hex").slice(0, 16);

  return {
    ip,
    userAgentHash,
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
    ip: meta.ip,
    userAgentHash: meta.userAgentHash,
    ...details,
  });
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
