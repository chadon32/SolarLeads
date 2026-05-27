import { buildSolarReport } from "@/lib/solar-report";

export type FollowUpChannel = "email" | "sms";
export type FollowUpStatus = "queued" | "sent" | "scheduled" | "failed" | "skipped";

export type FollowUpStep = {
  stepOrder: number;
  channel: FollowUpChannel;
  title: string;
  message: string;
  scheduledFor: string;
  status: FollowUpStatus;
  attempts?: number;
  processedAt?: string | null;
  deliveryMessage?: string | null;
};

type FollowUpInput = {
  name: string;
  address: string;
  monthlyBill: number;
  createdAt?: string | Date;
};

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function createFollowUpSequence({
  name,
  address,
  monthlyBill,
  createdAt = new Date(),
}: FollowUpInput): FollowUpStep[] {
  const baseDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const report = buildSolarReport(monthlyBill);

  return [
    {
      stepOrder: 1,
      channel: "email",
      title: "Instant report email",
      message: `Send the AI solar report to ${name} with the modeled savings summary for ${address}.`,
      scheduledFor: addHours(baseDate, 0).toISOString(),
      status: "queued",
    },
    {
      stepOrder: 2,
      channel: "sms",
      title: "One-day SMS follow-up",
      message: `Check in with a short reminder about the ${formatMoney(report.annualSavings)} annual savings estimate.`,
      scheduledFor: addDays(baseDate, 1).toISOString(),
      status: "queued",
    },
    {
      stepOrder: 3,
      channel: "email",
      title: "Three-day homeowner follow-up",
      message: "Share a cleaner consultation CTA and keep the homeowner moving toward a call.",
      scheduledFor: addDays(baseDate, 3).toISOString(),
      status: "queued",
    },
  ];
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
