import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      message:
        "Lead storage is disabled. Report delivery now uses /api/report/email without saving to Supabase.",
    },
    { status: 410 }
  );
}
