export type BatteryOption = {
  id: string;
  brand: string;
  model: string;
  capacityKwh: number;
  powerKw: number;
  cost: number;
  warrantyYears: number;
  specificationUrl: string;
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
    specificationUrl: "https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/Datasheet/en-us/Powerwall-3-Datasheet.pdf",
    bestFor: "Configurable output; confirm the installed rating",
  },
  {
    id: "pwrcell",
    brand: "Generac",
    model: "PWRcell M6",
    capacityKwh: 18,
    powerKw: 6.7,
    cost: 9800,
    warrantyYears: 10,
    specificationUrl: "https://www.generac.com/globalassets/residential/solar-power-storage/pwrcell--overview/a0000949454_pwrcell_batterycabinet_specsheet_rev-lv3_engspan_digital_.pdf",
    bestFor: "Six-module PWRcell cabinet",
  },
  {
    id: "enphase10t",
    brand: "Enphase",
    model: "IQ Battery 10T",
    capacityKwh: 10.08,
    powerKw: 3.84,
    cost: 8500,
    warrantyYears: 15,
    specificationUrl: "https://enphase.com/download/iq-battery-10t-data-sheet",
    bestFor: "U.S. model with integrated microinverters",
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
