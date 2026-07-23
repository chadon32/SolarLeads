export type TwentyYearSolarCostInput = {
  annualSavings: number;
  monthlyBill: number;
  totalSolarPayments: number;
  utilityEscalationRate?: number;
};

export const FEDERAL_RESIDENTIAL_SOLAR_CREDIT_END_YEAR = 2025;

export function getFederalResidentialSolarCreditRate(
  installationYear = new Date().getFullYear()
) {
  const year = Math.trunc(Number(installationYear));

  return year >= 2022 && year <= FEDERAL_RESIDENTIAL_SOLAR_CREDIT_END_YEAR
    ? 0.3
    : 0;
}

export function calculateFederalResidentialSolarCredit(
  systemCost: number,
  installationYear = new Date().getFullYear()
) {
  const cost = Number(systemCost);

  if (!Number.isFinite(cost) || cost <= 0) {
    return 0;
  }

  return Math.round(
    cost * getFederalResidentialSolarCreditRate(installationYear)
  );
}

export type TwentyYearSolarCosts = {
  remainingUtilityCost: number;
  totalCostWithSolar: number;
  totalCostWithoutSolar: number;
  totalSavings: number;
};

export function calculateArizonaStateSolarCredit(systemCost: number) {
  const cost = Number(systemCost);

  if (!Number.isFinite(cost) || cost <= 0) {
    return 0;
  }

  return Math.min(1000, Math.round(cost * 0.25));
}

export function calculateTwentyYearSolarCosts({
  annualSavings,
  monthlyBill,
  totalSolarPayments,
  utilityEscalationRate = 0.03,
}: TwentyYearSolarCostInput): TwentyYearSolarCosts {
  const safeMonthlyBill = Math.max(0, finiteNumber(monthlyBill));
  const safeAnnualSavings = Math.max(0, finiteNumber(annualSavings));
  const safeTotalSolarPayments = Math.max(0, finiteNumber(totalSolarPayments));
  const safeEscalationRate = Math.max(0, finiteNumber(utilityEscalationRate));
  const totalCostWithoutSolar = calculateTwentyYearUtilityCost(
    safeMonthlyBill,
    safeEscalationRate
  );
  const twentyYearSavings = Math.round(safeAnnualSavings * 20);
  const remainingUtilityCost = Math.max(totalCostWithoutSolar - twentyYearSavings, 0);
  const totalCostWithSolar = Math.round(
    remainingUtilityCost + safeTotalSolarPayments
  );
  const totalSavings = Math.max(totalCostWithoutSolar - totalCostWithSolar, 0);

  return {
    remainingUtilityCost,
    totalCostWithSolar,
    totalCostWithoutSolar,
    totalSavings,
  };
}

export function calculateTwentyYearUtilityCost(
  monthlyBill: number,
  utilityEscalationRate = 0.03
) {
  const safeMonthlyBill = Math.max(0, finiteNumber(monthlyBill));
  const safeEscalationRate = Math.max(0, finiteNumber(utilityEscalationRate));

  return Math.round(
    Array.from({ length: 20 }).reduce<number>(
      (sum, _, year) =>
        sum + safeMonthlyBill * 12 * (1 + safeEscalationRate) ** year,
      0
    )
  );
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
