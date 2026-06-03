import { normalizePhoneNumber } from "@/lib/phone";
import { fmtAddr } from "@/lib/utils";

export function normalizeEmail(input?: string | null) {
  const value = String(input ?? "").trim().toLowerCase();
  return value || null;
}

export function normalizePhone(input?: string | null) {
  const value = normalizePhoneNumber(input);
  return value || null;
}

export function normalizeAddress(input?: string | null) {
  const formatted = fmtAddr(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return formatted || null;
}
