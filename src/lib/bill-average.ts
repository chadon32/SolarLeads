export const MAX_MONTHLY_BILL = 5_000;
export const BILL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

type History = { annualTotal: string } | { months: readonly string[] };

function readCents(raw: string): number | null {
  const amount = raw.trim().replace(/^\$\s*/, "");
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\.\d{1,2})$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function calculateBillAverage(history: History) {
  const annual = "annualTotal" in history;
  const entries = annual ? [history.annualTotal] : history.months;
  const invalid: number[] = [];
  let totalCents = 0;
  let count = 0;
  entries.forEach((raw, index) => {
    if (raw.trim() === "") return;
    const cents = readCents(raw);
    if (cents === null || !Number.isSafeInteger(totalCents + cents)) {
      invalid.push(index);
      return;
    }
    totalCents += cents;
    count += annual ? 12 : 1;
  });
  const rounded = count > 0 ? Math.round(totalCents / (100 * count)) : 0;
  const problem = invalid.length ? "invalid" : count < 2 ? "incomplete" :
    rounded < 1 || rounded > MAX_MONTHLY_BILL ? "range" : null;
  return { count, invalid, problem, monthlyBill: problem === null ? rounded : null };
}
