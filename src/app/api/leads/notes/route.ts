import { NextResponse } from "next/server";
import { payloadTooLargeResponse, readJsonWithLimit } from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { z } from "zod";

const notesUpdateSchema = z.object({
  leadId: z.string().uuid(),
  notes: z.string().max(4000).default(""),
});

export async function PATCH(request: Request) {
  try {
    const authError = requireDashboardAuth(request);

    if (authError) {
      return authError;
    }

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

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The notes update is too large.");
    }

    const parsed = notesUpdateSchema.safeParse(jsonBody.ok ? jsonBody.data : null);
    const leadId = parsed.success ? parsed.data.leadId : "";
    const notes = parsed.success ? parsed.data.notes : "";

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
        { message: "Unable to update lead notes." },
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
    console.error("[lead-notes:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to update lead notes." },
      { status: 500 }
    );
  }
}
