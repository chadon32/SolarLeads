import type { BatteryOption } from "./batteries";

export type BackupScenario = { load: string; charge: number };
export const DEFAULT_BACKUP_SCENARIO: BackupScenario = { load: "1000", charge: 100 };

export function readRunningWatts(raw: string) {
  const text = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
  const watts = Number(text.replaceAll(",", ""));
  return Number.isSafeInteger(watts) && watts > 0 ? watts : null;
}

/** Energy-only scenario for one unit, with no solar recharge or additional losses. */
export function estimateBatteryRuntime(battery: Pick<BatteryOption, "capacityKwh" | "powerKw">, scenario: BackupScenario) {
  const watts = readRunningWatts(scenario.load);
  if (watts === null || !Number.isFinite(scenario.charge) || scenario.charge < 0 || scenario.charge > 100 ||
      !Number.isFinite(battery.capacityKwh) || battery.capacityKwh <= 0 || !Number.isFinite(battery.powerKw) || battery.powerKw <= 0)
    return { kind: "invalid" } as const;
  if (watts > battery.powerKw * 1000) return { kind: "over-limit" } as const;
  const hours = battery.capacityKwh * (scenario.charge / 100) * 1000 / watts;
  return { kind: "runtime", hours, watts } as const;
}

const hourFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export function runtimeLabel(result: ReturnType<typeof estimateBatteryRuntime>) {
  if (result.kind === "invalid") return "Enter a load";
  if (result.kind === "over-limit") return "Above power rating";
  return result.hours > 0 && result.hours < 0.1 ? "Less than 0.1 hr" : `${hourFormat.format(result.hours)} hr`;
}
