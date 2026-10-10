import { Resend } from "resend";
import { isKillSwitchEnabled } from "@/lib/abuse-protection";
import { getResendFromEmail } from "@/lib/notification-env";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildFollowUpIdempotencyKey, getStaleFollowUpClaimCutoff,
  initialReportDeliveryStatus, SCHEDULER_FOLLOW_UP_STATUSES,
} from "@/lib/follow-up-state";

type Database = ReturnType<typeof getSupabaseAdminClient>;
type FollowUpRow = {
  id: string; lead_id: string; step_order: number; channel: string;
  title: string; body: string; attempts?: number | null;
};
type LeadRow = {
  name: string | null; email: string | null;
  email_sent_at: string | null; marketing_email_consent: boolean | null;
  status: string | null;
};
type Delivery = { status: "sent" | "skipped" | "needs_review"; message: string };
type EmailPayload = { from: string; to: string; subject: string; text: string };
type Sender = (payload: EmailPayload, key: string) => Promise<string | null>;

async function sendEmail(payload: EmailPayload, key: string) {
  const resend = new Resend(process.env.RESEND_API_KEY!.trim());
  const { data, error } = await resend.emails.send(payload, { idempotencyKey: key });
  if (error) throw new Error("Email provider did not confirm acceptance.");
  return data?.id ?? null;
}

/** Never automatically resend an uncertain delivery, even after provider dedupe expires. */
export async function recoverInterruptedFollowUps(supabase: Database) {
  const { error } = await supabase.from("lead_followups").update({
    status: "needs_review",
    delivery_message: "Interrupted send. Verify delivery with the provider before taking any further action.",
  }).eq("status", "processing").lt("processed_at", getStaleFollowUpClaimCutoff());
  if (error) throw new Error("Unable to recover interrupted follow-ups.");
}

export async function deliverFollowUp(
  supabase: Database,
  followUpId: string,
  mode: "scheduled" | "manual",
  sender: Sender = sendEmail
) {
  const claimTime = new Date().toISOString();
  const { data: step, error: claimError } = await supabase.from("lead_followups").update({
    status: "processing",
    processed_at: claimTime,
    delivery_message: "Delivery in progress.",
  }).eq("id", followUpId).in("status", [...SCHEDULER_FOLLOW_UP_STATUSES])
    .select("id, lead_id, step_order, channel, title, body, attempts").maybeSingle<FollowUpRow>();
  if (claimError) throw new Error("Unable to claim follow-up.");
  if (!step) return null;

  const { data: lead, error: leadError } = await supabase.from("leads")
    .select("name, email, email_sent_at, marketing_email_consent, status")
    .eq("id", step.lead_id).single<LeadRow>();
  let delivery: Delivery;
  if (leadError || !lead) {
    delivery = { status: "needs_review", message: "Lead could not be verified. No email attempted." };
  } else if (lead.status?.trim().toLowerCase().replace(/\s+/g, "-") === "test-lead") {
    delivery = { status: "skipped", message: "Not sent. This lead is marked as a test lead." };
  } else if (step.step_order === 1) {
    const status = initialReportDeliveryStatus(lead.email_sent_at);
    delivery = { status, message: status === "sent"
      ? "Initial report email acceptance was confirmed by the report flow."
      : "Initial report delivery is not confirmed. Review notification status before retrying." };
  } else if (step.channel !== "email") {
    delivery = mode === "manual"
      ? { status: "sent", message: "Marked complete manually; no automated message sent." }
      : { status: "skipped", message: "Manual follow-up required; no automated message sent." };
  } else if (!lead.marketing_email_consent) {
    delivery = { status: "skipped", message: "Not sent. Marketing email consent is not recorded." };
  } else if (isKillSwitchEnabled("DISABLE_EMAIL_SENDING") || !process.env.RESEND_API_KEY?.trim() || !getResendFromEmail() || !lead.email) {
    delivery = { status: "skipped", message: "Not sent. Email sending is disabled or not configured." };
  } else {
    try {
      const providerId = await sender({
        from: getResendFromEmail(),
        to: lead.email,
        subject: step.title,
        text: [`Hi ${lead.name || "there"},`, "", step.body].join("\n"),
      }, buildFollowUpIdempotencyKey(step.id));
      delivery = providerId
        ? { status: "sent", message: `Email accepted by provider. Reference: ${providerId}` }
        : { status: "needs_review", message: "Provider acceptance could not be confirmed. Do not resend without checking delivery." };
    } catch {
      delivery = { status: "needs_review", message: "Delivery outcome is uncertain. Verify with the provider before retrying." };
    }
  }

  const processedAt = new Date().toISOString();
  const attempts = (step.attempts ?? 0) + 1;
  const { data: updated, error } = await supabase.from("lead_followups").update({
    status: delivery.status, delivery_message: delivery.message,
    processed_at: processedAt, attempts,
  }).eq("id", step.id).eq("status", "processing").eq("processed_at", claimTime)
    .select("id").maybeSingle();
  if (error || !updated) {
    throw new Error("Delivery status could not be saved. Reconcile this send before retrying.");
  }
  if (delivery.status === "sent" && step.step_order !== 1) {
    const { error: leadUpdateError } = await supabase.from("leads").update({
      follow_up_status: "Contacted", last_contacted_at: processedAt,
    }).eq("id", step.lead_id);
    if (leadUpdateError) throw new Error("Email status saved, but contact status could not be updated.");
  }
  return { followUpId: step.id, ...delivery, processedAt, attempts };
}

export async function processDueFollowUps(limit = 25) {
  const supabase = getSupabaseAdminClient();
  await recoverInterruptedFollowUps(supabase);
  const { data, error } = await supabase.from("lead_followups").select("id")
    .in("status", [...SCHEDULER_FOLLOW_UP_STATUSES])
    .lte("scheduled_for", new Date().toISOString()).order("scheduled_for", { ascending: true }).limit(limit);
  if (error) throw new Error("Unable to load scheduled follow-ups.");
  const details = [];
  for (const step of data ?? []) {
    const result = await deliverFollowUp(supabase, step.id, "scheduled");
    if (result) details.push(result);
  }
  return {
    processed: details.length,
    sent: details.filter((item) => item.status === "sent").length,
    skipped: details.filter((item) => item.status === "skipped").length,
    failed: details.filter((item) => item.status === "needs_review").length,
    details,
  };
}
