export type CashQuoteDraft = { price: string; size: string };

function positiveDecimal(raw: string, kind: "price" | "size"): number | null {
  const text = raw.trim();
  const format = kind === "price"
    ? /^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/
    : /^\d+(?:\.\d{1,3})?$/;
  if (!format.test(text)) return null;
  const number = Number(text.replace(/[$,]/g, ""));
  return number > 0 && number <= Number.MAX_SAFE_INTEGER / 1000 ? number : null;
}

/** Compare gross solar-only cash prices on a common DC watt basis. */
export function compareInstallerQuote(draft: CashQuoteDraft, modelDollarsPerWatt: number) {
  const price = positiveDecimal(draft.price, "price");
  const size = positiveDecimal(draft.size, "size");
  const modelCents = Math.round(modelDollarsPerWatt * 100);
  const quoteCents = price !== null && size !== null
    ? Math.round((price / (size * 1000) + Number.EPSILON) * 100)
    : null;
  return {
    invalidPrice: draft.price.trim() !== "" && price === null,
    invalidSize: draft.size.trim() !== "" && size === null,
    comparison: price !== null && size !== null && quoteCents !== null && Number.isSafeInteger(quoteCents) &&
      Number.isSafeInteger(modelCents) && modelCents > 0
      ? { price, size, quotePerWatt: quoteCents / 100, deltaPerWatt: (quoteCents - modelCents) / 100 }
      : null,
  };
}

const cash = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const kw = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** The export is intentionally built from numbers only, not a roof or lead record. */
export function buildInstallerMeetingBrief(
  quote: NonNullable<ReturnType<typeof compareInstallerQuote>["comparison"]>,
  modelRate: number,
  modeledWatts: number,
) {
  const sameSize = Math.abs(quote.size * 1000 - modeledWatts) < 0.5;
  return [
    "SolarTelligence | Installer meeting brief",
    "",
    `Quoted cash price: ${cash.format(quote.price)} before incentives`,
    `Quoted DC capacity: ${kw.format(quote.size)} kW`,
    `Quote: $${quote.quotePerWatt.toFixed(2)}/W | SolarTelligence estimate: $${modelRate.toFixed(2)}/W`,
    `At the quoted size, the modeled solar-only cost is ${cash.format(quote.size * 1000 * modelRate)}. This is a comparison, not an installer offer.`,
    "",
    "Ask the installer:",
    sameSize
      ? "1. For this system size, what first-year production (kWh) do you expect, and what shade or roof constraints did you assume?"
      : `1. Your design is ${kw.format(quote.size)} kW DC; the roof estimate is ${kw.format(modeledWatts / 1000)} kW DC. Which usable roof areas and production assumptions explain the difference?`,
    quote.deltaPerWatt > 0
      ? "2. Which equipment, labor, permits, or warranties account for the higher price per watt?"
      : "2. Which equipment, labor, permits, and warranties are included, and what would cost extra?",
    "3. Can you itemize storage, roof work, and financing fees separately so I can compare solar-only cash prices?",
  ].join("\n");
}
