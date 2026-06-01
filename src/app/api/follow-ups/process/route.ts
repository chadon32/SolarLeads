import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processDueFollowUps } from "@/lib/follow-up-processing";

function isAuthorized(request: Request) {
  const configuredSecret = process.env.FOLLOW_UP_PROCESS_SECRET?.trim();

  if (!configuredSecret) {
    return process.env.NODE_ENV !== "production";
  }

  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret")?.trim();
  const headerSecret = request.headers.get("x-process-secret")?.trim();
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  return (
    safeSecretEquals(querySecret, configuredSecret) ||
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
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
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
