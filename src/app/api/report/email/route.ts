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
  estimated_savings?: number | null;
  id: string;
  name: string;
  panel_count?: number | null;
  phone: string;
  preferred_contact_method?: string | null;
  quote_requested?: boolean | null;
  solar_timeline?: string | null;
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
        "id, name, email, phone, address, estimated_savings, annual_savings, panel_count, system_size_kw, preferred_contact_method, solar_timeline, quote_requested"
      )
      .eq("id", parsed.data.leadId)
      .maybeSingle<ReportEmailLead>();

    if (error || !data) {
      return NextResponse.json(
        { message: "The saved lead could not be found." },
        { status: 404 }
      );
    }

    const reportUrl = buildReportViewerUrl(data.id, {
      absolute: true,
      baseUrl:
        process.env.NODE_ENV === "production"
          ? undefined
          : new URL(request.url).origin,
    });
    const result = await sendHomeownerReportEmail({
      address: data.address,
      adminReportUrl: reportUrl,
      annualSavings: Number(data.annual_savings ?? data.estimated_savings ?? 0),
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

    await supabase
      .from("leads")
      .update({
        email_error: result.ok ? null : result.error ?? result.reason ?? null,
        email_sent_at: result.sentAt ?? null,
        notification_status: result.ok
          ? "homeowner_email_sent"
          : result.skipped
            ? "homeowner_email_skipped"
            : "homeowner_email_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (!result.ok) {
      return NextResponse.json(
        {
          message: result.skipped
            ? "Email delivery is not configured."
            : "The email provider rejected this delivery attempt.",
          reason: result.reason ?? "send_failed",
        },
        { status: result.skipped ? 503 : 502 }
      );
    }

    return NextResponse.json({
      message: "The saved homeowner report email was sent.",
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
