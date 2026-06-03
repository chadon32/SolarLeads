import { Resend } from "resend";
import { formatDisplayAddress } from "@/lib/address-format";
import { APP_EMAIL_SENDER_NAME, APP_NAME } from "@/lib/brand";
import {
  getAdminEmail,
  getNotificationEnvStatus,
  getResendFromEmail,
  isValidSenderEmail,
} from "@/lib/notification-env";

export type NotificationResult = {
  error?: string;
  messageId?: string;
  ok: boolean;
  reason?: string;
  sentAt?: string;
  skipped?: boolean;
};

export type LeadNotificationInput = {
  address: string;
  adminReportUrl: string;
  annualSavings: number | null;
  electricBillRange?: string | null;
  email: string;
  leadId: string;
  leadScoreLabel?: string | null;
  leadScoreValue?: number | null;
  monthlyBill?: number | null;
  name: string;
  panelCount?: number | null;
  phone: string;
  preferredContactMethod?: string | null;
  reportUrl: string;
  solarTimeline?: string | null;
  systemSizeKw?: number | null;
};

export type LeadNotificationSummary = {
  adminEmail: NotificationResult;
  homeownerEmail: NotificationResult;
};

export async function sendLeadNotifications(
  input: LeadNotificationInput
): Promise<LeadNotificationSummary> {
  console.info("[lead-notifications:start]", {
    email: Boolean(input.email),
    env: getNotificationEnvStatus(),
    leadId: input.leadId,
  });

  const [homeownerEmail, adminEmailResult] =
    await Promise.all([
      sendHomeownerReportEmail(input),
      sendAdminLeadEmail(input),
    ]);
  const summary = {
    adminEmail: adminEmailResult,
    homeownerEmail,
  };

  console.info("[lead-notifications:complete]", {
    adminEmail: logResult(adminEmailResult),
    homeownerEmail: logResult(homeownerEmail),
    leadId: input.leadId,
  });

  return summary;
}

export async function sendTestNotificationEmail({
  testEmail,
}: {
  testEmail: string;
}): Promise<NotificationResult> {
  return sendEmail({
    html:
      `<p>This is a test email from ${APP_NAME}. If you received this, Resend is configured correctly.</p>`,
    kind: "test_email",
    subject: `${APP_NAME} test email`,
    text:
      `This is a test email from ${APP_NAME}. If you received this, Resend is configured correctly.`,
    to: testEmail,
  });
}

async function sendHomeownerReportEmail(
  input: LeadNotificationInput
): Promise<NotificationResult> {
  if (!input.email) {
    return { ok: false, reason: "missing_homeowner_email", skipped: true };
  }

  const subject = `Your ${APP_NAME} Report Is Ready`;
  const text = [
    `Hi ${firstName(input.name)},`,
    "",
    `Your ${APP_NAME} report request was received.`,
    "",
    `Property: ${formatDisplayAddress(input.address)}`,
    `Estimated annual savings: ${formatCurrency(input.annualSavings)}`,
    `Estimated system size: ${formatKw(input.systemSizeKw)}`,
    `Panel count: ${formatCount(input.panelCount)}`,
    "",
    `View your report: ${input.reportUrl}`,
    "",
    "What happens next:",
    "1. Review your preliminary roof and savings estimate.",
    "2. A solar specialist can verify final design, pricing, incentives, and utility details.",
    "3. You decide when, or if, you want to move forward.",
    "",
    "This is a preliminary estimate. Final design, pricing, incentives, and savings require installer confirmation.",
  ].join("\n");

  return sendEmail({
    html: homeownerEmailHtml(input),
    kind: "homeowner_report",
    subject,
    text,
    to: input.email,
  });
}

async function sendAdminLeadEmail(
  input: LeadNotificationInput
): Promise<NotificationResult> {
  const adminEmail = getAdminEmail();

  if (!adminEmail) {
    return { ok: false, reason: "admin_email_not_configured", skipped: true };
  }

  const city = input.address.split(",").map((part) => part.trim())[1] || "Arizona";
  const subject = `New solar lead - ${input.name} in ${city}`;
  const text = [
    `Name: ${input.name}`,
    `Phone: ${input.phone}`,
    `Email: ${input.email}`,
    `Address: ${formatDisplayAddress(input.address)}`,
    `Monthly electric bill range: ${input.electricBillRange ?? "Unavailable"}`,
    `Monthly bill amount: ${input.monthlyBill ? `$${Math.round(input.monthlyBill)}` : "Unavailable"}`,
    `Timeline: ${input.solarTimeline ?? "Unavailable"}`,
    `Preferred contact: ${input.preferredContactMethod ?? "Unavailable"}`,
    `Panel count: ${formatCount(input.panelCount)}`,
    `System size: ${formatKw(input.systemSizeKw)}`,
    `Annual savings: ${formatCurrency(input.annualSavings)}`,
    `Lead score: ${
      typeof input.leadScoreValue === "number"
        ? `${input.leadScoreValue}/100 - ${input.leadScoreLabel ?? "Unlabeled"}`
        : "Unavailable"
    }`,
    `Report: ${input.adminReportUrl}`,
    `Submitted: ${new Date().toISOString()}`,
  ].join("\n");

  return sendEmail({
    kind: "admin_lead",
    subject,
    text,
    to: adminEmail,
  });
}

async function sendEmail({
  html,
  kind,
  subject,
  text,
  to,
}: {
  html?: string;
  kind: string;
  subject: string;
  text: string;
  to: string;
}): Promise<NotificationResult> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const resendFromEmail = getResendFromEmail();

  console.info("[notification-email:attempt]", { kind, to });

  if (!resendApiKey) {
    console.info("[notification-email-dev]", { kind, subject, text, to });
    console.info("[notification-email:skipped]", {
      kind,
      reason: "resend_not_configured",
    });
    return { ok: false, reason: "resend_not_configured", skipped: true };
  }

  if (!resendFromEmail || !isValidSenderEmail(resendFromEmail)) {
    const error = "FROM_EMAIL or RESEND_FROM_EMAIL must be a valid Resend sender.";
    console.warn("[notification-email:skipped]", { error, kind });
    return {
      error,
      ok: false,
      reason: "invalid_from_email",
      skipped: true,
    };
  }

  try {
    const resend = new Resend(resendApiKey);
    const result = await resend.emails.send({
      from: formatSender(resendFromEmail),
      html,
      subject,
      text,
      to,
    });

    if (result.error) {
      const error = sanitizeProviderError(result.error);
      console.error("[notification-email:error]", { error, kind });
      return { error, ok: false, reason: "send_failed" };
    }

    console.info("[notification-email:sent]", {
      id: result.data?.id ?? null,
      kind,
    });

    return {
      messageId: result.data?.id,
      ok: true,
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = sanitizeProviderError(error);
    console.error("[notification-email:error]", { error: message, kind });
    return { error: message, ok: false, reason: "send_failed" };
  }
}

export function sanitizeProviderError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
      statusCode?: unknown;
    };

    return [
      candidate.name,
      candidate.code ? `code ${String(candidate.code)}` : "",
      candidate.statusCode ? `status ${String(candidate.statusCode)}` : "",
      candidate.message,
    ]
      .filter(Boolean)
      .join(" - ");
  }

  return String(error);
}

function logResult(result: NotificationResult) {
  return {
    error: result.error,
    id: result.messageId,
    ok: result.ok,
    reason: result.reason,
    skipped: result.skipped,
  };
}

function formatSender(email: string) {
  return `${APP_EMAIL_SENDER_NAME} <${email}>`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function formatCount(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)} panels`
    : "Unavailable";
}

function formatCurrency(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${Math.round(value).toLocaleString()}`
    : "Unavailable";
}

function formatKw(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)} kW`
    : "Unavailable";
}

function homeownerEmailHtml(input: LeadNotificationInput) {
  return `
    <div style="font-family:Arial,sans-serif;background:#07111f;color:#f8fafc;padding:28px">
      <div style="max-width:640px;margin:0 auto;background:#0f172a;border:1px solid #233047;border-radius:20px;padding:28px">
        <p style="color:#67e8f9;text-transform:uppercase;letter-spacing:3px;font-size:12px;font-weight:700;margin:0 0 16px">${APP_NAME}</p>
        <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px">Your solar report is ready, ${firstName(input.name)}.</h1>
        <p style="color:#cbd5e1;line-height:1.7;margin:0 0 20px">We received your report request and prepared a preliminary roof and savings estimate for ${formatDisplayAddress(input.address)}.</p>
        <div style="display:grid;gap:12px;margin:22px 0">
          <div style="background:#111827;border-radius:14px;padding:14px"><strong>Estimated annual savings:</strong> ${formatCurrency(input.annualSavings)}</div>
          <div style="background:#111827;border-radius:14px;padding:14px"><strong>System size:</strong> ${formatKw(input.systemSizeKw)}</div>
          <div style="background:#111827;border-radius:14px;padding:14px"><strong>Panel count:</strong> ${formatCount(input.panelCount)}</div>
        </div>
        <a href="${input.reportUrl}" style="display:inline-block;background:#67e8f9;color:#020617;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 22px">Open my solar report</a>
        <h2 style="font-size:18px;margin:28px 0 10px">What happens next</h2>
        <ol style="color:#cbd5e1;line-height:1.7;padding-left:22px">
          <li>Review your preliminary roof and savings estimate.</li>
          <li>A solar specialist can verify final design, pricing, incentives, and utility details.</li>
          <li>You decide when, or if, you want to move forward.</li>
        </ol>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin-top:24px">This is a preliminary estimate. Final design, pricing, incentives, and savings require installer confirmation.</p>
      </div>
    </div>
  `;
}
