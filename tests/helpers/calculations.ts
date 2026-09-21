export function expectedSystemKw(panelCount: number, panelWatts: number) {
  return Math.round(((panelCount * panelWatts) / 1000) * 10) / 10;
}

export function expectedAnnualSavings(params: {
  annualKwh: number;
  monthlyBill: number;
  ratePerKwh: number;
}) {
  const modeledSavings = params.annualKwh * params.ratePerKwh;
  return Math.round(Math.min(modeledSavings, params.monthlyBill * 12));
}

export function expectedMonthlyLoanPayment(params: {
  principal: number;
  annualRatePct: number;
  years: number;
}) {
  const payments = params.years * 12;
  const monthlyRate = params.annualRatePct / 100 / 12;
  if (monthlyRate <= 0) {
    return params.principal / payments;
  }
  return (
    (params.principal * monthlyRate) /
    (1 - (1 + monthlyRate) ** -payments)
  );
}
