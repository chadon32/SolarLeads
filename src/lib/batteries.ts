export type BatteryOption = {
  id: string;
  brand: string;
  model: string;
  capacityKwh: number;
  powerKw: number;
  cost: number;
  warrantyYears: number;
  backupHours: number;
  bestFor: string;
};

export const BATTERY_OPTIONS: BatteryOption[] = [
  {
    id: "powerwall3",
    brand: "Tesla",
    model: "Powerwall 3",
    capacityKwh: 13.5,
    powerKw: 11.5,
    cost: 11500,
    warrantyYears: 10,
    backupHours: 12,
    bestFor: "Whole home backup",
  },
  {
    id: "pwrcell",
    brand: "Generac",
    model: "PWRcell M6",
    capacityKwh: 18,
    powerKw: 6.7,
    cost: 9800,
    warrantyYears: 10,
    backupHours: 16,
    bestFor: "Longest backup time",
  },
  {
    id: "enphase10t",
    brand: "Enphase",
    model: "IQ Battery 10T",
    capacityKwh: 10.5,
    powerKw: 3.84,
    cost: 8500,
    warrantyYears: 15,
    backupHours: 9,
    bestFor: "Best with Enphase microinverters",
  },
];

export const DEFAULT_BATTERY_OPTION_ID = "powerwall3";

export function getBatteryById(batteryId?: string | null) {
  return (
    BATTERY_OPTIONS.find((battery) => battery.id === batteryId) ??
    BATTERY_OPTIONS.find((battery) => battery.id === DEFAULT_BATTERY_OPTION_ID) ??
    BATTERY_OPTIONS[0]
  );
}
