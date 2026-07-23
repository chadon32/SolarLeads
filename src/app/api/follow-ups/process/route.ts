import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  HOUR_MS,
  isRequestTooLarge,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { processDueFollowUps } from "@/lib/follow-up-processing";
import { enforceRateLimit } from "@/lib/rate-limit";

function isAuthorized(request: Request) {
  const configuredSecret = process.env.FOLLOW_UP_PROCESS_SECRET?.trim();

  if (!configuredSecret) {
    return false;
  }

  const headerSecret = request.headers.get("x-process-secret")?.trim();
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  return (
    safeSecretEquals(headerSecret, configuredSecret) ||
    safeSecretEquals(bearer, configuredSecret)
  );
}

function safeSecretEquals(provided: string | null | undefined, expected: string) {
  const value = provided?.trim() ?? "";

  if (!value) {
    return false;
  }

  const providedBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

async function processRequest(request: Request) {
  const maintenance = maintenanceModeResponse();
  if (maintenance) return maintenance;

  if (request.method === "POST" && isRequestTooLarge(request, 8 * 1024)) {
    return payloadTooLargeResponse("Follow-up process payload is too large.");
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const limit = await enforceRateLimit({
    request,
    route: "api:follow-ups-process",
    limit: 10,
    windowMs: HOUR_MS,
  });

  if (!limit.allowed) {
    return rateLimitResponse(
      "Follow-up processing is temporarily limited. Please wait and try again.",
      limit.retryAfterSeconds
    );
  }

  const result = await processDueFollowUps();

  return NextResponse.json({
    processed: result.processed,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    details: result.details,
  });
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
