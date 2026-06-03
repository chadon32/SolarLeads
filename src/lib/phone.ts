export function normalizePhoneNumber(input?: string | null) {
  const digits = String(input ?? "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits;
}

export function formatPhoneForDisplay(input?: string | null) {
  const digits = normalizePhoneNumber(input);

  if (!digits) return "";
  if (digits.length !== 10) return digits;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatPhoneForSms(input?: string | null) {
  const digits = normalizePhoneNumber(input);

  if (digits.length !== 10) {
    return null;
  }

  return `+1${digits}`;
}

export function isValidUsPhoneNumber(input?: string | null) {
  return normalizePhoneNumber(input).length === 10;
}
