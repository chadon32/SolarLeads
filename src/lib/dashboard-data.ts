export type DashboardRecordDataQuality = "complete" | "partial" | "legacy";

export type DashboardSnapshotSummary = {
  version: number;
  createdAt: string;
  carbonOffsetFactorKgPerMwh: number | null;
  monthlyBill: number | null;
  metrics: {
    annualKwh: number | null;
    annualSavings: number | null;
    coveragePct: number | null;
    monthlySavings: number | null;
    panelCount: number | null;
    paybackYears: number | null;
    systemKw: number | null;
  };
};

export function readDashboardSnapshot(value: unknown): DashboardSnapshotSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = positiveIntegerOrNull(value.version);
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const metrics = isRecord(value.metrics) ? value.metrics : null;
  const roofAnalysis = isRecord(value.roofAnalysis) ? value.roofAnalysis : null;

  if (
    version === null ||
    !createdAt ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !metrics
  ) {
    return null;
  }

  return {
    version,
    createdAt,
    carbonOffsetFactorKgPerMwh: positiveNumberOrNull(
      roofAnalysis?.carbonOffsetFactorKgPerMwh
    ),
    monthlyBill: positiveNumberOrNull(value.monthlyBill),
    metrics: {
      annualKwh: nonNegativeNumberOrNull(metrics.annualKwh),
      annualSavings: nonNegativeNumberOrNull(metrics.annualSavings),
      coveragePct: boundedNumberOrNull(metrics.coveragePct, 0, 100),
      monthlySavings: nonNegativeNumberOrNull(metrics.monthlySavings),
      panelCount: positiveIntegerOrNull(metrics.panelCount),
      paybackYears: positiveNumberOrNull(metrics.paybackYears),
      systemKw: positiveNumberOrNull(metrics.systemKw),
    },
  };
}

export function getDashboardDataQuality({
  hasSnapshot,
  modelValues,
}: {
  hasSnapshot: boolean;
  modelValues: Array<number | null | undefined>;
}): DashboardRecordDataQuality {
  const capturedValues = modelValues.filter(
    (value): value is number => value !== null && value !== undefined && Number.isFinite(value)
  );

  if (hasSnapshot && capturedValues.length === modelValues.length) {
    return "complete";
  }

  return capturedValues.length ? "partial" : "legacy";
}

export function selectVisibleLead<T extends { id: string }>(
  filteredLeads: T[],
  selectedLeadId: string
) {
  return filteredLeads.find((lead) => lead.id === selectedLeadId) ?? filteredLeads[0] ?? null;
}

export function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc"
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "desc" ? right - left : left - right;
}

export function averageKnown(values: Array<number | null | undefined>) {
  const knownValues = values.filter(
    (value): value is number => value !== null && value !== undefined && Number.isFinite(value)
  );

  if (!knownValues.length) {
    return null;
  }

  return knownValues.reduce((sum, value) => sum + value, 0) / knownValues.length;
}

export function sumKnown(values: Array<number | null | undefined>) {
  const knownValues = values.filter(
    (value): value is number => value !== null && value !== undefined && Number.isFinite(value)
  );

  if (!knownValues.length) {
    return null;
  }

  return knownValues.reduce((sum, value) => sum + value, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function positiveNumberOrNull(value: unknown) {
  if (isMissingNumber(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function positiveIntegerOrNull(value: unknown) {
  const parsed = positiveNumberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function finiteNumberOrNull(value: unknown) {
  if (isMissingNumber(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nonNegativeNumberOrNull(value: unknown) {
  const parsed = finiteNumberOrNull(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function boundedNumberOrNull(value: unknown, min: number, max: number) {
  const parsed = finiteNumberOrNull(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null;
}

function isMissingNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") {
    return true;
  }

  return typeof value === "string" && value.trim() === "";
}
