import { Resend } from "resend";
import { isKillSwitchEnabled } from "@/lib/abuse-protection";
import { getResendFromEmail } from "@/lib/notification-env";
import { buildSolarReportFromSolarValues } from "@/lib/solar-report";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type FollowUpRow = {
  id: string;
  lead_id: string;
  step_order: number;
  channel: "email" | "manual";
  title: string;
  body: string;
  scheduled_for: string;
  status: string;
  attempts?: number | null;
};

type LeadRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  monthly_bill: number;
  estimated_savings?: number | null;
  annual_savings?: number | null;
  annual_energy_kwh?: number | null;
  panel_count?: number | null;
  system_size_kw?: number | null;
};

type ProcessResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  details: Array<{
    followUpId: string;
    status: "sent" | "skipped" | "failed";
    message: string;
  }>;
};

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const resendFromEmail = getResendFromEmail();
export async function markInitialFollowUpDelivered(leadId: string) {
  try {
    const supabase = getSupabaseAdminClient();

    await supabase
      .from("lead_followups")
      .update({
        status: "sent",
        processed_at: new Date().toISOString(),
        delivery_message: "Delivered with the initial report email.",
      })
      .eq("lead_id", leadId)
      .eq("step_order", 1);
  } catch {
    // Intentionally ignore. The UI already handled the immediate report email.
  }
}

export async function processDueFollowUps(limit = 25): Promise<ProcessResult> {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: dueSteps, error } = await supabase
    .from("lead_followups")
    .select("id, lead_id, step_order, channel, title, body, scheduled_for, status, attempts")
    .in("status", ["queued", "scheduled"])
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error || !dueSteps?.length) {
    return {
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const details: ProcessResult["details"] = [];

  for (const step of dueSteps as FollowUpRow[]) {
    const result = await processSingleFollowUp(supabase, step);
    details.push(result);

    if (result.status === "sent") sent += 1;
    if (result.status === "skipped") skipped += 1;
    if (result.status === "failed") failed += 1;
  }

  return {
    processed: dueSteps.length,
    sent,
    skipped,
    failed,
    details,
  };
}

async function processSingleFollowUp(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  step: FollowUpRow
) {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, name, email, phone, address, monthly_bill, estimated_savings, annual_savings, annual_energy_kwh, panel_count, system_size_kw")
    .eq("id", step.lead_id)
    .single<LeadRow>();

  if (leadError || !lead) {
    await updateFollowUpStatus(
      supabase,
      step.id,
      "failed",
      "Lead record not found.",
      (step.attempts ?? 0) + 1
    );
    return {
      followUpId: step.id,
      status: "failed" as const,
      message: "Lead record not found.",
    };
  }

  if (step.step_order === 1) {
    const message = "Initial report email was already delivered by the report flow.";
    await updateFollowUpStatus(
      supabase,
      step.id,
      "sent",
      message,
      (step.attempts ?? 0) + 1
    );
    return {
      followUpId: step.id,
      status: "sent" as const,
      message,
    };
  }

  if (step.channel === "email") {
    const outcome = await sendFollowUpEmail(lead, step);
    await updateFollowUpStatus(
      supabase,
      step.id,
      outcome.status,
      outcome.message,
      (step.attempts ?? 0) + 1
    );
    return {
      followUpId: step.id,
      status: outcome.status,
      message: outcome.message,
    };
  }

  const outcome = skipSmsFollowUp();
  await updateFollowUpStatus(
    supabase,
    step.id,
    outcome.status,
    outcome.message,
    (step.attempts ?? 0) + 1
  );
  return {
    followUpId: step.id,
    status: outcome.status,
    message: outcome.message,
  };
}

async function sendFollowUpEmail(
  lead: LeadRow,
  step: FollowUpRow
): Promise<{ status: "sent" | "skipped" | "failed"; message: string }> {
  if (isKillSwitchEnabled("DISABLE_EMAIL_SENDING")) {
    return {
      status: "skipped",
      message: "Email sending is disabled by DISABLE_EMAIL_SENDING.",
    };
  }

  if (!resendApiKey || !resendFromEmail) {
    return {
      status: "skipped",
      message: "Email provider is not configured.",
    };
  }

  try {
    const resend = new Resend(resendApiKey);
    const report = buildSolarReportFromSolarValues({
      annualSavings: Number(lead.annual_savings ?? lead.estimated_savings ?? 0),
      annualKwh: Number(lead.annual_energy_kwh ?? 0),
      panelCount: Number(lead.panel_count ?? 0),
      systemKw: Number(lead.system_size_kw ?? 0),
      monthlyBill: lead.monthly_bill,
    });
    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: lead.email,
      subject: step.title,
      text: [
        `Hi ${lead.name},`,
        "",
        step.body,
        "",
        `Estimated annual savings: ${money(report.annualSavings)}`,
        `Estimated ROI: ${report.estimatedRoiYears} years`,
      ].join("\n"),
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#e5eefb;background:#05070b;padding:32px;">
          <div style="max-width:640px;margin:0 auto;background:linear-gradient(135deg,rgba(17,24,39,0.95),rgba(10,15,24,0.95));border:1px solid rgba(148,163,184,0.18);border-radius:24px;padding:28px;">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.3em;text-transform:uppercase;color:#67e8f9;">Follow-up</p>
            <h1 style="margin:0;font-size:26px;line-height:1.15;">${escapeHtml(step.title)}</h1>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#cbd5e1;">${escapeHtml(step.body)}</p>
          </div>
        </div>
      `,
    });

    if (error) {
      return {
        status: "failed",
        message: error.message || "Unable to send follow-up email.",
      };
    }

    return {
      status: "sent",
      message: "Follow-up email sent.",
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error ? error.message : "Unexpected email follow-up error.",
    };
  }
}

function skipSmsFollowUp(): { status: "skipped"; message: string } {
  return {
    status: "skipped",
    message: "Automated text messaging is disabled. Use phone or email follow-up manually.",
  };
}

async function updateFollowUpStatus(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  followUpId: string,
  status: "sent" | "skipped" | "failed",
  message: string,
  attempts = 1
) {
  await supabase
    .from("lead_followups")
    .update({
      status,
      processed_at: new Date().toISOString(),
      delivery_message: message,
      attempts,
    })
    .eq("id", followUpId);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
