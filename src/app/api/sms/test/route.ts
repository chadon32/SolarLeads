import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const configured = Boolean(
    sid &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_PHONE_NUMBER?.trim()
  );

  return NextResponse.json({
    configured,
    sid: sid ? `${sid.slice(0, 8)}...` : null,
  });
}
