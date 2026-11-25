import { CONTACT_METHOD_OPTIONS } from "./lead-form-values";

export const CONTACT_REQUEST_LABELS = {
  requested: "Installer contact requested",
  report: "Report only",
  unknown: "Preference unavailable",
} as const;
export type ContactRequest = keyof typeof CONTACT_REQUEST_LABELS;

export function readDashboardContact(consent: unknown, method: unknown) {
  const request: ContactRequest = consent === true ? "requested" : consent === false ? "report" : "unknown";
  const preferredMethod = request === "requested" && typeof method === "string"
    ? CONTACT_METHOD_OPTIONS.find(option => option.toLowerCase() === method.trim().toLowerCase()) ?? null
    : null;
  return { request, preferredMethod };
}

// Keep available consent fields even if a database is missing other optional columns.
// Remember only explicit missing-column errors, and only for this page request.
export function withDashboardContactColumns<T extends { error: { code?: string; message: string } | null }>(
  query: (columns: string) => Promise<T>,
) {
  let optional = ["installer_contact_consent", "preferred_contact_method"];
  return async (columns: string): Promise<T> => {
    for (;;) {
      const result = await query([columns, ...optional].join(", "));
      const error = result.error;
      if (!error || !["42703", "PGRST204"].includes(error.code ?? "")) return result;
      const missing = optional.find(name => new RegExp(`\\b${name}\\b`, "i").test(error.message));
      if (!missing) return result;
      optional = optional.filter(name => name !== missing);
    }
  };
}
