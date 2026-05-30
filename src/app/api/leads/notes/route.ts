import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export async function PATCH(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:leads:notes",
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many note updates. Please try again shortly." },
        { status: 429 }
      );
    }

    const body = (await request.json()) as {
      leadId?: string;
      notes?: string;
    };
    const leadId = body.leadId?.trim();
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : "";

    if (!leadId) {
      return NextResponse.json(
        { message: "leadId is required." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ notes })
      .eq("id", leadId)
      .select("id, notes")
      .single();

    if (error) {
      return NextResponse.json(
        { message: error.message || "Unable to update lead notes." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lead: {
        id: data.id,
        notes: data.notes ?? "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unexpected note save error.",
      },
      { status: 500 }
    );
  }
}
