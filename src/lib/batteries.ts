export type BatteryOption = {
  id: string;
  brand: string;
  model: string;
  capacityKwh: number;
  powerKw: number;
  cost: number;
  warranty_years: number;
  backupHours: number;
  bestFor: string;
};

export const BATTERY_OPTIONS: BatteryOption[] = [
  {
    id: "powerwall",
    brand: "Tesla",
    model: "Powerwall 3",
    capacityKwh: 13.5,
    powerKw: 11.5,
    cost: 11500,
    warranty_years: 10,
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
    warranty_years: 10,
    backupHours: 16,
    bestFor: "Longest backup time",
  },
  {
    id: "encharge10",
    brand: "Enphase",
    model: "IQ Battery 10T",
    capacityKwh: 10.5,
    powerKw: 3.84,
    cost: 8500,
    warranty_years: 15,
    backupHours: 9,
    bestFor: "Enphase microinverter systems",
  },
];

export const DEFAULT_BATTERY_OPTION_ID = "powerwall";

export function getBatteryById(batteryId?: string | null) {
  return (
    BATTERY_OPTIONS.find((battery) => battery.id === batteryId) ??
    BATTERY_OPTIONS.find((battery) => battery.id === DEFAULT_BATTERY_OPTION_ID) ??
    BATTERY_OPTIONS[0]
  );
}
