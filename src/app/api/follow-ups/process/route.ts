import { NextResponse } from "next/server";
import { processDueFollowUps } from "@/lib/follow-up-processing";

function isAuthorized(request: Request) {
  const configuredSecret = process.env.FOLLOW_UP_PROCESS_SECRET?.trim();
  if (!configuredSecret) {
    return true;
  }

  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret");
  const headerSecret = request.headers.get("x-process-secret");
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  return (
    querySecret === configuredSecret ||
    headerSecret === configuredSecret ||
    bearer === configuredSecret
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
