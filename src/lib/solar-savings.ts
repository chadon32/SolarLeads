import {
  ARIZONA_AVG_RATE_PER_KWH,
  ARIZONA_EXPORT_CREDIT_PER_KWH,
  ARIZONA_FIXED_MONTHLY_CHARGE,
  SOLAR_SELF_CONSUMPTION_SHARE,
} from "@/lib/solar-assumptions";

/**
 * First-year bill savings from solar under Arizona net billing. Power used at
 * home as it is produced saves the retail rate; the rest is exported for the
 * utility's export credit. Credits only offset the energy part of the bill,
 * so the fixed monthly charge always remains.
 */
export function estimateAnnualSolarSavings({
  annualKwh,
  monthlyBill,
}: {
  annualKwh: number | null | undefined;
  monthlyBill?: number | null;
}) {
  const production = Number(annualKwh);
  if (!Number.isFinite(production) || production <= 0) return 0;

  const bill = Number(monthlyBill);
  const selfUsedShare = production * SOLAR_SELF_CONSUMPTION_SHARE;

  if (!Number.isFinite(bill) || bill <= 0) {
    return Math.round(
      selfUsedShare * ARIZONA_AVG_RATE_PER_KWH +
        (production - selfUsedShare) * ARIZONA_EXPORT_CREDIT_PER_KWH
    );
  }

  const offsettableAnnual = Math.max(0, (bill - ARIZONA_FIXED_MONTHLY_CHARGE) * 12);
  const usageKwh = offsettableAnnual / ARIZONA_AVG_RATE_PER_KWH;
  const selfUsed = Math.min(selfUsedShare, usageKwh);
  const selfUsedValue = selfUsed * ARIZONA_AVG_RATE_PER_KWH;
  const exportCredit = Math.min(
    (production - selfUsed) * ARIZONA_EXPORT_CREDIT_PER_KWH,
    offsettableAnnual - selfUsedValue
  );

  return Math.round(selfUsedValue + Math.max(0, exportCredit));
}
