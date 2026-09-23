import type { RoofShape, ShadingRisk } from "@/lib/roof-analysis";
import { APP_CANONICAL_URL } from "@/lib/brand";

export const SCENARIO_SHARE_ASSUMPTION_DATE = "September 23, 2026";

export const SCENARIO_LABEL_OPTIONS = [
  "Planning baseline",
  "Higher summer usage",
  "Smaller roof footprint",
  "Future battery plan",
] as const;

export const ROOF_CATEGORY_OPTIONS = [
  "Mixed roof planes",
  "Mostly gable roof",
  "Mostly hip roof",
  "Mostly flat or low-slope roof",
] as const;

export const SUN_CATEGORY_OPTIONS = [
  "Higher sun exposure",
  "Mixed sun exposure",
  "Lower sun exposure",
] as const;

export const SYSTEM_RANGE_OPTIONS = [
  "3–4 kW",
  "5–6 kW",
  "7–8 kW",
  "9–10 kW",
] as const;

export type ScenarioLabel = (typeof SCENARIO_LABEL_OPTIONS)[number];
export type RoofCategory = (typeof ROOF_CATEGORY_OPTIONS)[number];
export type SunCategory = (typeof SUN_CATEGORY_OPTIONS)[number];
export type SystemRange = (typeof SYSTEM_RANGE_OPTIONS)[number];

export function getBroadRoofCategory(roofShape: RoofShape): RoofCategory {
  switch (roofShape) {
    case "gable":
      return "Mostly gable roof";
    case "hip":
      return "Mostly hip roof";
    case "flat":
    case "shed":
      return "Mostly flat or low-slope roof";
    case "complex":
    default:
      return "Mixed roof planes";
  }
}

export function getBroadSunCategory(shadingRisk: ShadingRisk): SunCategory {
  switch (shadingRisk) {
    case "low":
      return "Higher sun exposure";
    case "high":
      return "Lower sun exposure";
    case "medium":
    default:
      return "Mixed sun exposure";
  }
}

export function getSystemRange(systemKw: number): SystemRange {
  if (!Number.isFinite(systemKw) || systemKw <= 4) {
    return "3–4 kW";
  }
  if (systemKw <= 6) {
    return "5–6 kW";
  }
  if (systemKw <= 8) {
    return "7–8 kW";
  }
  return "9–10 kW";
}

function oneOf<T extends readonly string[]>(value: string, options: T): T[number] {
  return options.includes(value) ? (value as T[number]) : options[0];
}

/**
 * Build the only text that the public scenario card is allowed to export.
 * The inputs are all constrained to local option lists, so no address, bill,
 * contact field, coordinate, report id, or arbitrary user text can enter it.
 */
export function buildRedactedScenarioText({
  label,
  roof,
  sun,
  system,
}: {
  label: string;
  roof: string;
  sun: string;
  system: string;
}) {
  const safeLabel = oneOf(label, SCENARIO_LABEL_OPTIONS);
  const safeRoof = oneOf(roof, ROOF_CATEGORY_OPTIONS);
  const safeSun = oneOf(sun, SUN_CATEGORY_OPTIONS);
  const safeSystem = oneOf(system, SYSTEM_RANGE_OPTIONS);

  return [
    `Solartelligence preliminary scenario: ${safeLabel}`,
    `Roof profile: ${safeRoof}`,
    `Sun exposure: ${safeSun}`,
    `System size range: ${safeSystem}`,
    `Assumptions reviewed: ${SCENARIO_SHARE_ASSUMPTION_DATE}`,
    "Illustrative planning result. Verify roof condition, utility plan, pricing, and final design with a qualified installer.",
    `Explore the calculator: ${APP_CANONICAL_URL}/`,
  ].join("\n");
}
