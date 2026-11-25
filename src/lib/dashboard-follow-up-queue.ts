export const QUEUE_LABELS = {
  all: "All follow-ups",
  attention: "Needs attention",
  due: "Due now",
  upcoming: "Upcoming",
  unscheduled: "Missing schedule",
  sent: "Sent",
} as const;

export type QueueFilter = keyof typeof QUEUE_LABELS;
type QueueItem = { status: string; scheduledFor: string };

/** Input is already scoped by submission period and the test-lead toggle. */
export function groupFollowUpQueue<T extends QueueItem>(items: T[], asOf: string) {
  const groups: Record<QueueFilter, T[]> = { all: items, attention: [], due: [], upcoming: [], unscheduled: [], sent: [] };
  const now = Date.parse(asOf);
  for (const item of items) {
    if (item.status === "failed" || item.status === "needs_review") groups.attention.push(item);
    else if (item.status === "sent") groups.sent.push(item);
    else if (item.status === "scheduled" || item.status === "queued") {
      const at = Date.parse(item.scheduledFor);
      if (!Number.isFinite(at)) groups.unscheduled.push(item);
      else if (Number.isFinite(now)) groups[at <= now ? "due" : "upcoming"].push(item);
    }
  }
  const earliest = (a: T, b: T) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor);
  groups.due.sort(earliest);
  groups.upcoming.sort(earliest);
  return groups;
}

type ExportItem = QueueItem & { id: string; leadId: string; channel: string };
export function followUpExportRows(items: ExportItem[]) {
  return [
    ["follow_up_id", "lead_id", "channel", "status", "scheduled_at_utc"],
    ...items.map(item => {
      const at = Date.parse(item.scheduledFor);
      return [item.id, item.leadId, item.channel, item.status, Number.isFinite(at) ? new Date(at).toISOString() : ""];
    }),
  ];
}
