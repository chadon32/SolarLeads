import { NextResponse } from "next/server";
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
import { deliverFollowUp } from "@/lib/follow-up-processing";
import { z } from "zod";

type SendNowBody = {
  followUpId?: string;
};
const sendNowSchema = z.object({ followUpId: z.string().uuid() });

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
    const result = await deliverFollowUp(supabase, body.followUpId, "manual");
    if (!result) {
      return NextResponse.json({ message: "This follow-up is completed, in progress, or requires delivery review. It was not sent again." }, { status: 409 });
    }
    return NextResponse.json({ followUp: {
      attempts: result.attempts,
      deliveryMessage: result.message,
      processedAt: result.processedAt,
      status: result.status,
    } });
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
