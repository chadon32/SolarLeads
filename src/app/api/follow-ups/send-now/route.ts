import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  disabledFeatureResponse,
  isKillSwitchEnabled,
  isRequestTooLarge,
  logAbuseSignal,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SendNowBody = {
  followUpId?: string;
};

type FollowUpRow = {
  id: string;
  lead_id: string;
  channel: string;
  title: string;
  body: string;
  attempts?: number | null;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
};

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const resendFromEmail =
  process.env.FROM_EMAIL?.trim() ||
  process.env.RESEND_FROM_EMAIL?.trim() ||
  "reports@solartelligence.com";

export async function POST(request: Request) {
  try {
    const authError = requireDashboardAuth(request);

    if (authError) {
      return authError;
    }

    if (isRequestTooLarge(request, 16 * 1024)) {
      logAbuseSignal(request, "follow-up-send-now-payload-too-large", {
        route: "api:follow-ups:send-now",
      });
      return payloadTooLargeResponse("The follow-up request is too large.");
    }

    if (isKillSwitchEnabled("DISABLE_EMAIL_SENDING")) {
      return disabledFeatureResponse(
        "Email sending is temporarily disabled."
      );
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:follow-ups:send-now",
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many follow-up sends. Please try again shortly.",
        rateLimit.retryAfterSeconds
      );
    }

    const body = (await request.json().catch(() => ({}))) as SendNowBody;

    if (!body.followUpId) {
      return NextResponse.json({ message: "Missing followUpId." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data: followUp, error: followUpError } = (await supabase
      .from("lead_followups")
      .select("id, lead_id, channel, title, body, attempts")
      .eq("id", body.followUpId)
      .single()) as { data: FollowUpRow | null; error: { message: string } | null };

    if (followUpError || !followUp) {
      return NextResponse.json(
        { message: followUpError?.message || "Follow-up not found." },
        { status: 404 }
      );
    }

    const { data: lead } = (await supabase
      .from("leads")
      .select("id, name, email")
      .eq("id", followUp.lead_id)
      .single()) as { data: LeadRow | null; error: { message: string } | null };

    const deliveryMessage = await sendFollowUpIfConfigured(followUp, lead);
    const processedAt = new Date().toISOString();
    const attempts = (followUp.attempts ?? 0) + 1;

    const { data: updatedFollowUp, error: updateError } = await supabase
      .from("lead_followups")
      .update({
        attempts,
        delivery_message: deliveryMessage,
        processed_at: processedAt,
        status: "sent",
      })
      .eq("id", followUp.id)
      .select("attempts, delivery_message, processed_at, status")
      .single();

    if (updateError) {
      return NextResponse.json(
        { message: updateError.message || "Unable to update follow-up." },
        { status: 500 }
      );
    }

    await supabase
      .from("leads")
      .update({
        follow_up_status: "Contacted",
        last_contacted_at: processedAt,
      })
      .eq("id", followUp.lead_id);

    return NextResponse.json({
      followUp: {
        attempts: updatedFollowUp?.attempts ?? attempts,
        deliveryMessage: updatedFollowUp?.delivery_message ?? deliveryMessage,
        processedAt: updatedFollowUp?.processed_at ?? processedAt,
        status: updatedFollowUp?.status ?? "sent",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unexpected follow-up send error.",
      },
      { status: 500 }
    );
  }
}

async function sendFollowUpIfConfigured(followUp: FollowUpRow, lead: LeadRow | null) {
  if (followUp.channel !== "email") {
    return "Marked sent manually. Automated text messaging is disabled.";
  }

  if (!resendApiKey || !lead?.email) {
    return "Marked sent manually. Email automation is not connected yet.";
  }

  try {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: lead.email,
      subject: followUp.title,
      text: [`Hi ${lead.name || "there"},`, "", followUp.body].join("\n"),
    });

    return error
      ? `Marked sent manually. Resend error: ${error.message}`
      : "Follow-up email sent with Resend.";
  } catch (error) {
    return `Marked sent manually. Email send failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
  }
}
