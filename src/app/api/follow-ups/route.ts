import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  DAY_MS,
  isRequestTooLarge,
  logAbuseSignal,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { createFollowUpSequence } from "@/lib/follow-ups";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { initialReportDeliveryStatus } from "@/lib/follow-up-state";
import { z } from "zod";

type FollowUpBody = {
  leadId?: string;
};
const followUpSchema = z.object({ leadId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const authError = requireDashboardAuth(request);

    if (authError) {
      return authError;
    }

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

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The follow-up request is too large.");
    }

    const parsed = followUpSchema.safeParse(jsonBody.ok ? jsonBody.data : null);
    const body: FollowUpBody = parsed.success ? parsed.data : {};

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
      .select("id, name, address, monthly_bill, annual_savings, estimated_savings, created_at, email_sent_at, installer_contact_consent, marketing_email_consent")
      .eq("id", body.leadId)
      .single();

    if (leadError || !lead) {
      return NextResponse.json(
        { message: "Lead not found." },
        { status: 404 }
      );
    }

    if (!lead.marketing_email_consent) {
      return NextResponse.json(
        {
          message:
            "Automated nurture email was not scheduled because marketing email consent is not recorded.",
        },
        { status: 409 }
      );
    }

    const steps = createFollowUpSequence({
      name: lead.name,
      address: lead.address,
      monthlyBill: lead.monthly_bill,
      annualSavings: lead.annual_savings ?? lead.estimated_savings,
      createdAt: lead.created_at,
    });

    const { error } = await supabase
      .from("lead_followups")
      .upsert(
        steps.map((step) => ({
          lead_id: lead.id,
          step_order: step.stepOrder,
          channel: step.channel,
          title: step.title,
          body: step.message,
          scheduled_for: step.scheduledFor,
          status: step.stepOrder === 1 ? initialReportDeliveryStatus(lead.email_sent_at) : step.status,
          delivery_message: step.stepOrder === 1 ? (lead.email_sent_at ? "Initial report email acceptance confirmed." : "Initial report delivery requires review.") : null,
        })),
        { onConflict: "lead_id,step_order", ignoreDuplicates: true }
      )
      .select(
        "id, lead_id, step_order, channel, title, body, scheduled_for, status, attempts, processed_at, delivery_message"
      );

    if (error) {
      return NextResponse.json(
        { message: "Unable to schedule follow-ups." },
        { status: 500 }
      );
    }

    // Scheduling again must never reset an in-flight, uncertain, or sent delivery.
    const { data, error: readError } = await supabase.from("lead_followups")
      .select("step_order, channel, title, body, scheduled_for, status, attempts, processed_at, delivery_message")
      .eq("lead_id", lead.id).order("step_order");
    if (readError) throw new Error("Unable to read scheduled follow-ups.");

    return NextResponse.json({
      steps: (data ?? []).map((item) => ({
        stepOrder: item.step_order,
        channel: item.channel,
        title: item.title,
        message: item.body,
        scheduledFor: item.scheduled_for,
        status: item.status,
        attempts: item.attempts ?? 0,
        processedAt: item.processed_at ?? null,
        deliveryMessage: item.delivery_message ?? null,
      })),
    });
  } catch (error) {
    console.error("[follow-up-schedule:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to schedule follow-ups." },
      { status: 500 }
    );
  }
}
