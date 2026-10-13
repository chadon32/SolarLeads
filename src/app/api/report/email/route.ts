import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DAY_MS,
  isKillSwitchEnabled,
  isRequestTooLarge,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { normalizeLeadStatus } from "@/lib/lead-status";
import { sendHomeownerReportEmail } from "@/lib/notifications";
import { buildReportViewerUrl } from "@/lib/report-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const reportEmailSchema = z
  .object({
    leadId: z.string().uuid(),
  })
  .strict();

type ReportEmailLead = {
  address: string;
  annual_savings?: number | null;
  email: string;
  email_sent_at?: string | null;
  estimated_savings?: number | null;
  id: string;
  name: string;
  notification_status?: string | null;
  panel_count?: number | null;
  phone: string;
  preferred_contact_method?: string | null;
  quote_requested?: boolean | null;
  solar_timeline?: string | null;
  status?: string | null;
  system_size_kw?: number | null;
};

export async function POST(request: Request) {
  const authError = requireDashboardAuth(request);

  if (authError) {
    return authError;
  }

  const maintenance = maintenanceModeResponse();

  if (maintenance) {
    return maintenance;
  }

  if (isRequestTooLarge(request, 16 * 1024)) {
    return payloadTooLargeResponse("The report email request is too large.");
  }

  if (isKillSwitchEnabled("DISABLE_EMAIL_SENDING")) {
    return NextResponse.json(
      { message: "Email sending is temporarily disabled." },
      { status: 503 }
    );
  }

  const jsonBody = await readJsonWithLimit(request, 16 * 1024);

  if (!jsonBody.ok && jsonBody.reason === "too_large") {
    return payloadTooLargeResponse("The report email request is too large.");
  }

  const parsed = reportEmailSchema.safeParse(jsonBody.ok ? jsonBody.data : null);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "A valid lead ID is required." },
      { status: 400 }
    );
  }

  const rateLimit = await enforceRateLimit({
    key: `lead:${parsed.data.leadId}`,
    request,
    route: "api:report-email:lead",
    limit: 3,
    windowMs: DAY_MS,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(
      "This report email has already been retried several times today.",
      rateLimit.retryAfterSeconds
    );
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, name, email, phone, address, estimated_savings, annual_savings, panel_count, system_size_kw, preferred_contact_method, solar_timeline, quote_requested, status, email_sent_at, notification_status"
      )
      .eq("id", parsed.data.leadId)
      .maybeSingle<ReportEmailLead>();

    if (error) {
      return NextResponse.json(
        { message: "Report delivery status is unavailable. Please try again later." },
        { status: 503 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { message: "The saved lead could not be found." },
        { status: 404 }
      );
    }

    if (normalizeLeadStatus(data.status) === "test-lead") {
      return NextResponse.json(
        { message: "Report emails are disabled for test leads." },
        { status: 409 }
      );
    }

    if (data.email_sent_at) {
      return NextResponse.json({ message: "This report email has already been accepted for delivery." });
    }

    if (
      data.notification_status === "homeowner_email_sending" ||
      data.notification_status === "homeowner_email_needs_review" ||
      data.notification_status === "homeowner_email_sent"
    ) {
      return NextResponse.json(
        { message: "Delivery is in progress or needs review. Check the email provider before retrying." },
        { status: 409 }
      );
    }

    const reportUrl = buildReportViewerUrl(data.id, {
      absolute: true,
      baseUrl:
        process.env.NODE_ENV === "production"
          ? undefined
          : new URL(request.url).origin,
    });

    // Compare-and-set the persisted state before crossing the email boundary.
    // A crash leaves a claim for manual reconciliation, never an automatic resend.
    let claim = supabase
      .from("leads")
      .update({ notification_status: "homeowner_email_sending", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("email_sent_at", null);
    claim = data.notification_status == null
      ? claim.is("notification_status", null)
      : claim.eq("notification_status", data.notification_status);
    claim = data.status == null ? claim.is("status", null) : claim.eq("status", data.status);
    const claimed = await claim.select("id").maybeSingle();

    if (claimed.error || !claimed.data) {
      return NextResponse.json(
        { message: "Delivery could not be claimed. Refresh and check the saved delivery status." },
        { status: claimed.error ? 503 : 409 }
      );
    }

    const result = await sendHomeownerReportEmail({
      address: data.address,
      adminReportUrl: reportUrl,
      annualSavings: toOptionalNumber(data.annual_savings ?? data.estimated_savings),
      email: data.email,
      installerContactConsent: Boolean(data.quote_requested),
      leadId: data.id,
      name: data.name,
      panelCount: toOptionalNumber(data.panel_count),
      phone: data.phone,
      preferredContactMethod: data.preferred_contact_method,
      reportUrl,
      solarTimeline: data.solar_timeline,
      systemSizeKw: toOptionalNumber(data.system_size_kw),
    });

    const uncertain = result.reason === "acceptance_unconfirmed";
    const finalized = await supabase
      .from("leads")
      .update({
        email_error: result.ok ? null : result.error ?? result.reason ?? null,
        email_sent_at: result.sentAt ?? null,
        notification_status: result.ok
          ? "homeowner_email_sent"
          : uncertain
            ? "homeowner_email_needs_review"
            : result.skipped
            ? "homeowner_email_skipped"
            : "homeowner_email_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("notification_status", "homeowner_email_sending")
      .select("id")
      .maybeSingle();

    if (finalized.error || !finalized.data) {
      return NextResponse.json(
        { message: "Delivery may have been accepted, but its saved status could not be confirmed. Check the email provider before retrying." },
        { status: 503 }
      );
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          message: result.skipped
            ? "Email delivery is not configured."
            : uncertain
              ? "Delivery could not be confirmed. Check the email provider before retrying."
              : "The email provider rejected this delivery attempt.",
          reason: result.reason ?? "send_failed",
        },
        { status: result.skipped ? 503 : 502 }
      );
    }

    return NextResponse.json({
      message: "The saved homeowner report email was accepted for delivery.",
      messageId: result.messageId ?? null,
    });
  } catch (error) {
    console.error("[report-email-retry]", {
      message: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json(
      { message: "The report email could not be retried." },
      { status: 500 }
    );
  }
}

function toOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
