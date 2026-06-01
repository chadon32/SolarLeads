import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type SmsBody = {
  address?: string;
  annualSavings?: number;
  firstName?: string;
  leadId?: string;
  phone?: string;
  reportUrl?: string;
};

export async function POST(req: NextRequest) {
  const {
    address = "your Arizona home",
    annualSavings = 0,
    firstName = "there",
    leadId,
    phone,
    reportUrl,
  } = (await req.json().catch(() => ({}))) as SmsBody;

  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    return NextResponse.json({ skipped: true });
  }

  const cleanPhone = phone?.replace(/\D/g, "");

  if (!cleanPhone || cleanPhone.length < 10) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }

  const formattedPhone = `+1${cleanPhone.slice(-10)}`;
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const smsSentAt = new Date().toISOString();
  const safeReportUrl = reportUrl || process.env.NEXT_PUBLIC_SITE_URL || "";

  try {
    await client.messages.create({
      body:
        `Hi ${firstName}! Your Arizona Solar AI report is ready. ` +
        `Your roof at ${address} could save about $${Math.round(
          Number(annualSavings) || 0
        )}/yr with solar. View your report: ${safeReportUrl} - Reply STOP to opt out.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone,
    });

    if (process.env.OWNER_PHONE_NUMBER) {
      await client.messages.create({
        body:
          `New solar lead: ${firstName} | ${address} | ` +
          `$${Math.round(Number(annualSavings) || 0)}/yr savings | ${phone}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.OWNER_PHONE_NUMBER,
      });
    }

    if (leadId) {
      await markLeadSmsSent(leadId, smsSentAt);
    }

    return NextResponse.json({ smsSentAt, success: true });
  } catch (error) {
    console.error("Twilio error:", error);
    return NextResponse.json({ error: "SMS failed" }, { status: 500 });
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
