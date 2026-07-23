import { NextRequest, NextResponse } from "next/server";
import {
  HOUR_MS,
  isRequestTooLarge,
  logAbuseSignal,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { getNotificationEnvStatus } from "@/lib/notification-env";
import { sendTestNotificationEmail } from "@/lib/notifications";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";

type NotificationTestBody = {
  channel?: "email";
  testEmail?: string;
};
const notificationTestSchema = z.object({
  channel: z.literal("email").default("email"),
  testEmail: z.string().trim().email().max(254),
});

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

  const jsonBody = await readJsonWithLimit(request, 16 * 1024);

  if (!jsonBody.ok && jsonBody.reason === "too_large") {
    return payloadTooLargeResponse("The notification test request is too large.");
  }

  const parsed = notificationTestSchema.safeParse(
    jsonBody.ok ? jsonBody.data : null
  );

  if (!parsed.success) {
    return NextResponse.json(
      { message: "A valid test email is required." },
      { status: 400 }
    );
  }

  const body: NotificationTestBody = parsed.data;
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
