export type FollowUpChannel = "email" | "manual";
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
  annualSavings?: number | null;
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
  annualSavings,
  createdAt = new Date(),
}: FollowUpInput): FollowUpStep[] {
  const baseDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const savingsCopy =
    Number.isFinite(Number(annualSavings)) && Number(annualSavings) > 0
      ? `${formatMoney(Number(annualSavings))} annual savings estimate`
      : "Solar API savings estimate";

  return [
    {
      stepOrder: 1,
      channel: "email",
      title: "Report ready email",
      message: `Send the AI solar report to ${name} with the modeled savings summary for ${address}.`,
      scheduledFor: addHours(baseDate, 0).toISOString(),
      status: "queued",
    },
    {
      stepOrder: 2,
      channel: "manual",
      title: "24-hour follow-up",
      message: `Call or email the homeowner with a short reminder about the ${savingsCopy}.`,
      scheduledFor: addDays(baseDate, 1).toISOString(),
      status: "queued",
    },
    {
      stepOrder: 3,
      channel: "email",
      title: "3-day savings reminder",
      message: "Remind the homeowner of the modeled savings and answer any questions about the estimate.",
      scheduledFor: addDays(baseDate, 3).toISOString(),
      status: "queued",
    },
    {
      stepOrder: 4,
      channel: "email",
      title: "7-day quote CTA",
      message: "Invite the homeowner to request a finalized quote and installer-confirmed design.",
      scheduledFor: addDays(baseDate, 7).toISOString(),
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
