import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { formatDisplayAddress } from "@/lib/address-format";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { formatName } from "@/lib/name-format";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type SmsBody = {
  dashboardResend?: boolean;
  leadId?: string;
  phone?: string;
  phoneConsent?: boolean;
};

type SmsLead = {
  address: string | null;
  annual_savings?: number | null;
  email?: string | null;
  estimated_savings?: number | null;
  id: string;
  name: string | null;
  phone: string | null;
  sms_consent?: boolean | null;
};

export async function POST(req: NextRequest) {
  const rateLimit = await enforceRateLimit({
    request: req,
    route: "api:sms",
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Too many SMS requests. Please try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": rateLimit.retryAfterSeconds.toString(),
        },
      }
    );
  }

  const body = (await req.json().catch(() => ({}))) as SmsBody;
  const leadId = body.leadId?.trim();
  const dashboardAuth = verifyDashboardRequest(req);
  const isDashboardResend = Boolean(body.dashboardResend);

  console.log("SMS API called with:", {
    dashboardResend: isDashboardResend,
    leadId,
    phone: body.phone ? "***provided***" : null,
  });
  console.log("Twilio SID exists:", Boolean(process.env.TWILIO_ACCOUNT_SID));

  if (!leadId) {
    return NextResponse.json({ message: "leadId is required." }, { status: 400 });
  }

  if (isDashboardResend && !dashboardAuth.ok) {
    return NextResponse.json(
      { message: "Dashboard access is required to resend SMS." },
      { status: 403 }
    );
  }

  const lead = await getLeadForSms(leadId);

  if (!lead) {
    return NextResponse.json({ message: "Lead not found." }, { status: 404 });
  }

  if (!dashboardAuth.ok && !lead.sms_consent) {
    return NextResponse.json({
      reason: "sms_consent_missing",
      skipped: true,
    });
  }

  const savedPhone = normalizePhone(lead.phone ?? "");
  const requestedPhone = normalizePhone(body.phone ?? "");

  if (!savedPhone || savedPhone.length < 10) {
    return NextResponse.json(
      { message: "Lead does not have a valid phone number." },
      { status: 400 }
    );
  }

  if (!dashboardAuth.ok && requestedPhone.slice(-10) !== savedPhone.slice(-10)) {
    return NextResponse.json(
      { message: "SMS phone number does not match the saved lead." },
      { status: 403 }
    );
  }

  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    console.warn("Twilio not configured - SMS skipped");
    return NextResponse.json({ skipped: true });
  }

  const formattedPhone = `+1${savedPhone.slice(-10)}`;
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const smsSentAt = new Date().toISOString();
  const firstName = formatName(lead.name).split(/\s+/)[0] || "there";
  console.log("SMS lead resolved:", { firstName, leadId });
  const address = formatDisplayAddress(lead.address ?? "your Arizona home");
  const annualSavings = Math.round(
    Number(lead.annual_savings ?? lead.estimated_savings ?? 0) || 0
  );
  const siteOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(req.url).origin;
  const reportUrl = `${siteOrigin}/estimate?address=${encodeURIComponent(address)}`;

  try {
    await client.messages.create({
      body:
        `Hi ${firstName}! Your Arizona Solar AI report is ready. ` +
        `Your roof at ${address} could save about $${annualSavings}/yr ` +
        `with solar. View your report: ${reportUrl} - Reply STOP to opt out.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone,
    });

    if (process.env.OWNER_PHONE_NUMBER) {
      await client.messages.create({
        body:
          `New solar lead: ${firstName} | ${address} | ` +
          `$${annualSavings}/yr savings | ${lead.phone ?? formattedPhone}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.OWNER_PHONE_NUMBER,
      });
    }

    await markLeadSmsSent(leadId, smsSentAt);

    return NextResponse.json({ smsSentAt, success: true });
  } catch (error) {
    console.error("Twilio error:", error);
    return NextResponse.json({ error: "SMS failed" }, { status: 500 });
  }
}

async function getLeadForSms(leadId: string) {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = (await supabase
      .from("leads")
      .select("id, name, phone, address, annual_savings, estimated_savings, sms_consent")
      .eq("id", leadId)
      .maybeSingle()) as { data: SmsLead | null; error: { message?: string } | null };

    if (error) {
      console.error("[sms_lead_lookup]", error.message);
      return null;
    }

    return data;
  } catch (error) {
    console.error("[sms_lead_lookup]", error);
    return null;
  }
}

async function markLeadSmsSent(leadId: string, smsSentAt: string) {
  try {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase
      .from("leads")
      .update({ sms_sent_at: smsSentAt })
      .eq("id", leadId);

    if (error) {
      console.error("[sms_sent_at_update]", error.message);
    }
  } catch (error) {
    console.error("[sms_sent_at_update]", error);
  }
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}
