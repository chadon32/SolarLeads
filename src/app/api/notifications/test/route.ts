import { NextRequest, NextResponse } from "next/server";
import {
  HOUR_MS,
  isRequestTooLarge,
  logAbuseSignal,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { getNotificationEnvStatus } from "@/lib/notification-env";
import { sendTestNotificationEmail } from "@/lib/notifications";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

type NotificationTestBody = {
  channel?: "email";
  testEmail?: string;
};

export async function POST(request: NextRequest) {
  const authResponse = requireDashboardAuth(request);

  if (authResponse) {
    return authResponse;
  }

  if (isRequestTooLarge(request, 16 * 1024)) {
    logAbuseSignal(request, "notification-test-payload-too-large", {
      route: "api:notifications-test",
    });
    return payloadTooLargeResponse("The notification test request is too large.");
  }

  const rateLimit = await enforceRateLimit({
    request,
    route: "api:notifications-test",
    limit: 5,
    windowMs: HOUR_MS,
  });

  if (!rateLimit.allowed) {
    logAbuseSignal(request, "notification-test-rate-limited", {
      route: "api:notifications-test",
    });
    return rateLimitResponse(
      "Too many notification tests. Please try again later.",
      rateLimit.retryAfterSeconds
    );
  }

  const body = (await request.json().catch(() => ({}))) as NotificationTestBody;
  const channel = body.channel ?? "email";
  const env = getNotificationEnvStatus();
  const wantsEmail = channel === "email";
  const email = body.testEmail?.trim() ?? "";

  const emailResult =
    wantsEmail && email
      ? await sendTestNotificationEmail({ testEmail: email })
      : null;

  return NextResponse.json({
    email: {
      attempted: Boolean(wantsEmail && email),
      messageId: emailResult?.messageId ?? null,
      reason: emailResult?.reason ?? (!email && wantsEmail ? "missing_test_email" : null),
      sanitizedError: emailResult?.error ?? null,
      success: Boolean(emailResult?.ok),
    },
    env,
  });
}
