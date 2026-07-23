import { NextResponse } from "next/server";
import { payloadTooLargeResponse, readJsonWithLimit } from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { z } from "zod";

const followUpStatusLabels = {
  contacted: "Contacted",
  closed: "Closed",
  lost: "Lost",
  "not-started": "Not started",
  "quote-requested": "Quote requested",
  "report-sent": "Report sent",
  "first-follow-up-due": "First follow-up due",
} as const;

type FollowUpAction = keyof typeof followUpStatusLabels;

const leadStatusByFollowUpAction: Partial<Record<FollowUpAction, string>> = {
  contacted: "Contacted",
  closed: "Closed Won",
  lost: "Closed Lost",
  "quote-requested": "Quote Requested",
};

type FollowUpBody = {
  action?: string;
  followUpNotes?: string;
  leadId?: string;
  nextFollowUpAt?: string | null;
};
const followUpUpdateSchema = z.object({
  action: z.string().trim().min(1).max(40),
  followUpNotes: z.string().max(4000).optional(),
  leadId: z.string().uuid(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const authError = requireDashboardAuth(request);

    if (authError) {
      return authError;
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:leads:follow-up",
      limit: 40,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many follow-up updates. Please try again shortly." },
        { status: 429 }
      );
    }

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The follow-up update is too large.");
    }

    const parsed = followUpUpdateSchema.safeParse(jsonBody.ok ? jsonBody.data : null);
    const body: FollowUpBody = parsed.success ? parsed.data : {};
    const leadId = parsed.success ? parsed.data.leadId : "";
    const action = parsed.success ? normalizeFollowUpAction(parsed.data.action) : null;

    if (!leadId || !action) {
      return NextResponse.json(
        { message: "leadId and a valid follow-up action are required." },
        { status: 400 }
      );
    }

    const now = new Date();
    const nextFollowUpAt = getNextFollowUpAt(action, body.nextFollowUpAt, now);
    const updatePayload: Record<string, string | null> = {
      follow_up_status: followUpStatusLabels[action],
      next_follow_up_at: nextFollowUpAt,
    };

    if (typeof body.followUpNotes === "string") {
      updatePayload.follow_up_notes = body.followUpNotes.slice(0, 4000);
    }

    if (shouldStampContactDate(action)) {
      updatePayload.last_contacted_at = now.toISOString();
    }

    const status = leadStatusByFollowUpAction[action];
    if (status) {
      updatePayload.status = status;
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId)
      .select(
        "id, follow_up_status, follow_up_notes, last_contacted_at, next_follow_up_at, status"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { message: "Unable to update follow-up status." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lead: {
        followUpNotes: data.follow_up_notes ?? "",
        followUpStatus: data.follow_up_status ?? followUpStatusLabels[action],
        id: data.id,
        lastContactedAt: data.last_contacted_at ?? null,
        nextFollowUpAt: data.next_follow_up_at ?? null,
        status: data.status ?? null,
      },
    });
  } catch (error) {
    console.error("[lead-follow-up:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to update follow-up status." },
      { status: 500 }
    );
  }
}

function normalizeFollowUpAction(value: unknown): FollowUpAction | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return normalized in followUpStatusLabels ? (normalized as FollowUpAction) : null;
}

function getNextFollowUpAt(
  action: FollowUpAction,
  requestedValue: string | null | undefined,
  now: Date
) {
  if (action === "closed" || action === "lost" || action === "quote-requested") {
    return null;
  }

  if (requestedValue) {
    const parsed = new Date(requestedValue);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (action === "report-sent") {
    return addHours(now, 24).toISOString();
  }

  if (action === "contacted") {
    return addDays(now, 3).toISOString();
  }

  if (action === "first-follow-up-due") {
    return addHours(now, 24).toISOString();
  }

  return null;
}

function shouldStampContactDate(action: FollowUpAction) {
  return (
    action === "report-sent" ||
    action === "contacted" ||
    action === "quote-requested" ||
    action === "closed" ||
    action === "lost"
  );
}

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
