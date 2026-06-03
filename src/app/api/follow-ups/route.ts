import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  DAY_MS,
  isRequestTooLarge,
  logAbuseSignal,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { createFollowUpSequence } from "@/lib/follow-ups";
import { enforceRateLimit } from "@/lib/rate-limit";
import { markInitialFollowUpDelivered } from "@/lib/follow-up-processing";

type FollowUpBody = {
  leadId?: string;
};

export async function POST(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    if (isRequestTooLarge(request, 16 * 1024)) {
      logAbuseSignal(request, "follow-ups-payload-too-large", {
        route: "api:follow-ups",
      });
      return payloadTooLargeResponse("The follow-up request is too large.");
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:follow-ups",
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many follow-up requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    const body = (await request.json().catch(() => ({}))) as FollowUpBody;

    if (!body.leadId) {
      return NextResponse.json(
        { message: "Missing leadId." },
        { status: 400 }
      );
    }

    const leadLimit = await enforceRateLimit({
      key: `lead:${body.leadId}`,
      request,
      route: "api:follow-ups:lead",
      limit: 2,
      windowMs: DAY_MS,
    });

    if (!leadLimit.allowed) {
      logAbuseSignal(request, "follow-ups-lead-rate-limited", {
        leadId: body.leadId,
        route: "api:follow-ups",
      });
      return rateLimitResponse(
        "Follow-ups have already been scheduled for this report.",
        leadLimit.retryAfterSeconds
      );
    }

    const supabase = getSupabaseAdminClient();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, name, address, monthly_bill, annual_savings, estimated_savings, created_at")
      .eq("id", body.leadId)
      .single();

    if (leadError || !lead) {
      return NextResponse.json(
        { message: leadError?.message || "Lead not found." },
        { status: 404 }
      );
    }

    const steps = createFollowUpSequence({
      name: lead.name,
      address: lead.address,
      monthlyBill: lead.monthly_bill,
      annualSavings: lead.annual_savings ?? lead.estimated_savings,
      createdAt: lead.created_at,
    });

    const { data, error } = await supabase
      .from("lead_followups")
      .upsert(
        steps.map((step) => ({
          lead_id: lead.id,
          step_order: step.stepOrder,
          channel: step.channel,
          title: step.title,
          body: step.message,
          scheduled_for: step.scheduledFor,
          status: step.status,
        })),
        { onConflict: "lead_id,step_order" }
      )
      .select(
        "id, lead_id, step_order, channel, title, body, scheduled_for, status, attempts, processed_at, delivery_message"
      );

    if (error) {
      return NextResponse.json(
        { message: error.message || "Unable to schedule follow-ups." },
        { status: 500 }
      );
    }

    const deliveredAt = new Date().toISOString();
    await markInitialFollowUpDelivered(lead.id);

    await supabase
      .from("leads")
      .update({
        follow_up_status: "Report sent",
        last_contacted_at: deliveredAt,
        next_follow_up_at:
          steps.find((step) => step.stepOrder === 2)?.scheduledFor ?? null,
      })
      .eq("id", lead.id);

    return NextResponse.json({
      steps: (data ?? []).map((item) => ({
        stepOrder: item.step_order,
        channel: item.channel,
        title: item.title,
        message: item.body,
        scheduledFor: item.scheduled_for,
        status:
          item.step_order === 1 ? "sent" : (item.status as typeof item.status),
        attempts: item.step_order === 1 ? (item.attempts ?? 1) : item.attempts ?? 0,
        processedAt:
          item.step_order === 1
            ? deliveredAt
            : item.processed_at ?? null,
        deliveryMessage:
          item.step_order === 1
            ? "Delivered with the initial report email."
            : item.delivery_message ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unexpected follow-up scheduling error.",
      },
      { status: 500 }
    );
  }
}
