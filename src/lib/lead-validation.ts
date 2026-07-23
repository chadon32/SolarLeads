import { normalizeAddress } from "@/lib/lead-normalization";

export const MAX_REASONABLE_MONTHLY_ELECTRIC_BILL = 2500;

export function isReasonableMonthlyBill(value: unknown) {
  const bill = Number(value);

  return (
    Number.isFinite(bill) &&
    bill > 0 &&
    bill <= MAX_REASONABLE_MONTHLY_ELECTRIC_BILL
  );
}

export function addressesMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeAddress(left);
  const normalizedRight = normalizeAddress(right);

  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft === normalizedRight
  );
}
