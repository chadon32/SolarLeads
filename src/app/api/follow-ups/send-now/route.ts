import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  disabledFeatureResponse,
  isKillSwitchEnabled,
  isRequestTooLarge,
  logAbuseSignal,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { sanitizeProviderError } from "@/lib/notifications";
import { z } from "zod";

type SendNowBody = {
  followUpId?: string;
};
const sendNowSchema = z.object({ followUpId: z.string().uuid() });

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
  installer_contact_consent?: boolean | null;
  marketing_email_consent?: boolean | null;
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

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The follow-up request is too large.");
    }

    const parsed = sendNowSchema.safeParse(jsonBody.ok ? jsonBody.data : null);
    const body: SendNowBody = parsed.success ? parsed.data : {};

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
        { message: "Follow-up not found." },
        { status: 404 }
      );
    }

    const { data: lead } = (await supabase
      .from("leads")
      .select("id, name, email, installer_contact_consent, marketing_email_consent")
      .eq("id", followUp.lead_id)
      .single()) as { data: LeadRow | null; error: { message: string } | null };

    const delivery = await sendFollowUpIfConfigured(followUp, lead);
    const processedAt = new Date().toISOString();
    const attempts = (followUp.attempts ?? 0) + 1;

    const { data: updatedFollowUp, error: updateError } = await supabase
      .from("lead_followups")
      .update({
        attempts,
        delivery_message: delivery.message,
        processed_at: processedAt,
        status: delivery.status,
      })
      .eq("id", followUp.id)
      .select("attempts, delivery_message, processed_at, status")
      .single();

    if (updateError) {
      return NextResponse.json(
        { message: "Unable to update follow-up." },
        { status: 500 }
      );
    }

    if (delivery.status === "sent") {
      await supabase
        .from("leads")
        .update({
          follow_up_status: "Contacted",
          last_contacted_at: processedAt,
        })
        .eq("id", followUp.lead_id);
    }

    return NextResponse.json({
      followUp: {
        attempts: updatedFollowUp?.attempts ?? attempts,
        deliveryMessage: updatedFollowUp?.delivery_message ?? delivery.message,
        processedAt: updatedFollowUp?.processed_at ?? processedAt,
        status: updatedFollowUp?.status ?? delivery.status,
      },
    });
  } catch (error) {
    console.error("[follow-up-send-now:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to send the follow-up." },
      { status: 500 }
    );
  }
}

async function sendFollowUpIfConfigured(followUp: FollowUpRow, lead: LeadRow | null) {
  if (followUp.channel !== "email") {
    return {
      message: "Marked complete manually. Automated text messaging is disabled.",
      status: "sent" as const,
    };
  }

  if (!lead?.marketing_email_consent) {
    return {
      message: "Not sent. Marketing email consent is not recorded for this homeowner.",
      status: "skipped" as const,
    };
  }

  if (!resendApiKey || !lead?.email) {
    return {
      message: "Not sent. Email automation is not configured.",
      status: "skipped" as const,
    };
  }

  try {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: lead.email,
      subject: followUp.title,
      text: [`Hi ${lead.name || "there"},`, "", followUp.body].join("\n"),
    });

    if (error) {
      console.error("[follow-up-send-now:provider]", {
        error: sanitizeProviderError(error),
      });
      return {
        message: "Follow-up email could not be delivered.",
        status: "failed" as const,
      };
    }

    return {
      message: "Follow-up email sent with Resend.",
      status: "sent" as const,
    };
  } catch (error) {
    console.error("[follow-up-send-now:provider]", {
      error: sanitizeProviderError(error),
    });
    return {
      message: "Follow-up email could not be delivered.",
      status: "failed" as const,
    };
  }
}
