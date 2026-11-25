export const AC_OUTPUT_FACTOR = 0.85;
export const AC_OUTPUT_SOURCE = "https://developers.google.com/maps/documentation/solar/calculate-costs-us";

export function readAnnualUsage(raw: string) {
  const text = raw.trim();
  if (!text) return { kind: "empty" } as const;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return { kind: "invalid" } as const;
  const kwh = Number(text.replaceAll(",", ""));
  return kwh >= 1 && kwh <= 1_000_000 ? { kind: "valid", kwh } as const : { kind: "invalid" } as const;
}

export function annualEnergyMatch(dcKwh: number, usageKwh: number) {
  if (!Number.isFinite(dcKwh) || dcKwh <= 0 || !Number.isSafeInteger(usageKwh) || usageKwh < 1 || usageKwh > 1_000_000) return null;
  const acKwh = Math.round(dcKwh * AC_OUTPUT_FACTOR);
  if (!Number.isSafeInteger(acKwh)) return null;
  return { acKwh, gapKwh: acKwh - usageKwh, percent: acKwh / usageKwh * 100 };
}

export function annualMatchLabel(percent: number) {
  if (percent > 0 && percent < 1) return "Under 1%";
  if (percent < 100 && Math.round(percent) === 100) return "Just under 100%";
  if (percent > 100 && Math.round(percent) === 100) return "Just over 100%";
  return Math.round(percent).toLocaleString("en-US") + "%";
}
