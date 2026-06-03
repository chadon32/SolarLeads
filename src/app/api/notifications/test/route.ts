import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { getNotificationEnvStatus } from "@/lib/notification-env";
import { sendTestNotificationEmail } from "@/lib/notifications";

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
