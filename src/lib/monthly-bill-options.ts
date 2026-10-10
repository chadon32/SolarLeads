/** Preset monthly bills offered in the estimate's bill picker. */
export const MONTHLY_BILL_OPTIONS = [100, 150, 200, 250, 300, 350, 400, 450, 500];

/** The presets plus the visitor's own bill, so a typed value is never lost. */
export function billOptionsIncluding(currentBill: number) {
  return MONTHLY_BILL_OPTIONS.includes(currentBill)
    ? MONTHLY_BILL_OPTIONS
    : [...MONTHLY_BILL_OPTIONS, currentBill].sort((a, b) => a - b);
}
