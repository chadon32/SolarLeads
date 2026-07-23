export function formatCurrency(value: number | null | undefined) {
  const amount = finiteNumber(value);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number | null | undefined) {
  const percent = finiteNumber(value);

  return `${Math.round(percent)}%`;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
