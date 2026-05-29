import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit } from "@/lib/rate-limit";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const statusLabels = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  "closed-won": "Closed Won",
  "closed-lost": "Closed Lost",
} as const;

type LeadStatus = keyof typeof statusLabels;

export async function PATCH(request: Request) {
  try {
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

    const body = (await request.json()) as {
      leadId?: string;
      status?: string;
    };
    const leadId = body.leadId?.trim();
    const status = normalizeStatus(body.status);

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
        { message: error.message || "Unable to update lead status." },
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
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unexpected lead status error.",
      },
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
