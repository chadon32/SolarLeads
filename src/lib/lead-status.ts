export const LEAD_STATUS_OPTIONS = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "quoted", label: "Quote Requested" },
  { id: "closed-won", label: "Closed Won" },
  { id: "closed-lost", label: "Closed Lost" },
  { id: "test-lead", label: "Test Lead" },
] as const;

export type LeadStatus = (typeof LEAD_STATUS_OPTIONS)[number]["id"];

export function normalizeLeadStatus(value: unknown): LeadStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  const canonical = normalized === "quote-requested" ? "quoted" : normalized;

  return LEAD_STATUS_OPTIONS.some((status) => status.id === canonical)
    ? (canonical as LeadStatus)
    : null;
}
