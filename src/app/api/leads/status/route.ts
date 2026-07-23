import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { payloadTooLargeResponse, readJsonWithLimit } from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const statusLabels = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quote Requested",
  "closed-won": "Closed Won",
  "closed-lost": "Closed Lost",
} as const;

type LeadStatus = keyof typeof statusLabels;
const statusUpdateSchema = z.object({
  leadId: z.string().uuid(),
  status: z.string().trim().min(1).max(32),
});

export async function PATCH(request: Request) {
  try {
    const authError = requireDashboardAuth(request);

    if (authError) {
      return authError;
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:leads:status",
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many status updates. Please try again shortly." },
        { status: 429 }
      );
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { message: "Lead storage is not configured." },
        { status: 500 }
      );
    }

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The status update is too large.");
    }

    const parsed = statusUpdateSchema.safeParse(jsonBody.ok ? jsonBody.data : null);
    const leadId = parsed.success ? parsed.data.leadId : "";
    const status = parsed.success ? normalizeStatus(parsed.data.status) : null;

    if (!leadId || !status) {
      return NextResponse.json(
        { message: "leadId and a valid status are required." },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase
      .from("leads")
      .update({ status: statusLabels[status] })
      .eq("id", leadId)
      .select("id, status")
      .single();

    if (error) {
      return NextResponse.json(
        { message: "Unable to update lead status." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lead: {
        id: data.id,
        status: normalizeStatus(data.status) ?? status,
      },
    });
  } catch (error) {
    console.error("[lead-status:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to update lead status." },
      { status: 500 }
    );
  }
}

function normalizeStatus(value: unknown): LeadStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");

  return normalized in statusLabels ? (normalized as LeadStatus) : null;
}
