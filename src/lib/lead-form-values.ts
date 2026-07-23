export const ELECTRIC_BILL_RANGE_OPTIONS = [
  "Under $100",
  "$100-$200",
  "$200-$300",
  "$300-$400",
  "$400+",
] as const;

export const ELECTRIC_BILL_RANGE_MONTHLY_VALUES: Record<string, number> = {
  "Under $100": 75,
  "$100-$200": 150,
  "$200-$300": 250,
  "$300-$400": 350,
  "$400+": 450,
};

export const HOME_OWNERSHIP_OPTIONS = ["Own", "Rent"] as const;

export const SOLAR_TIMELINE_OPTIONS = [
  "Just researching",
  "3-6 months",
  "1-3 months",
  "ASAP",
] as const;

export const CONTACT_METHOD_OPTIONS = ["Phone", "Email"] as const;

export const BEST_TIME_OPTIONS = [
  "Morning",
  "Afternoon",
  "Evening",
  "Weekend",
] as const;

export function getBillRangeByMonthlyBill(monthlyBill: number) {
  const bill = Number(monthlyBill);

  if (!Number.isFinite(bill) || bill <= 0) return "$100-$200";
  if (bill < 100) return "Under $100";
  if (bill <= 200) return "$100-$200";
  if (bill <= 300) return "$200-$300";
  if (bill <= 400) return "$300-$400";
  return "$400+";
}

export function getMonthlyBillFromRange(range: string) {
  return ELECTRIC_BILL_RANGE_MONTHLY_VALUES[range] ?? 200;
}
