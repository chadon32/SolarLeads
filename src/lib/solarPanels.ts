import { calculateFederalResidentialSolarCredit } from "@/lib/financial-model";
import { getUsableAreaM2, type RoofAnalysis } from "@/lib/roof-analysis";
import {
  ARIZONA_AVG_RATE_PER_KWH,
  INSTALLED_COST_PER_WATT,
} from "@/lib/solar-assumptions";
import { getMaxPanelCount } from "@/lib/solar-metrics";

export type SolarPanelTier = "premium" | "mid" | "value";

export type SolarPanel = {
  id: string;
  brand: string;
  model: string;
  watts: number;
  efficiency: number;
  installedCostPerWatt: number;
  warranty_years: number;
  warranty_power: string;
  type: string;
  dimensions: string;
  weight_kg: number;
  tempCoefficient: number;
  tier: SolarPanelTier;
  bestFor: string;
  specSourceUrl: string;
};

export type InverterType = "string" | "microinverters" | "optimizers";

export type InverterOption = {
  id: InverterType;
  label: string;
  brands: string;
  costAdderPerWatt: number;
  bestFor: string;
};

export type PanelFit = {
  maxPanelsFit: number;
  systemKw: number;
  annualKwh: number;
  annualSavings: number;
  systemCost: number;
  taxCredit: number;
  netCost: number;
  paybackYears: number;
  azHeatLoss: string;
  adjustedEfficiency: string;
  recommended: boolean;
  fits: boolean;
};

export const SOLAR_PANELS: SolarPanel[] = [
  {
    id: "rec-alpha-pure-rx",
    brand: "REC",
    model: "Alpha Pure-R",
    watts: 430,
    efficiency: 22.3,
    installedCostPerWatt: INSTALLED_COST_PER_WATT,
    warranty_years: 20,
    warranty_power: "92% at 25 years",
    type: "Heterojunction (HJT)",
    dimensions: "1730 x 1118 mm",
    weight_kg: 21.5,
    tempCoefficient: -0.24,
    tier: "premium",
    bestFor: "small roofs needing max output",
    specSourceUrl: "https://www.recgroup.com/en-us/rec-alpha-pure-r",
  },
  {
    id: "qcells-q-peak-duo",
    brand: "Hanwha Qcells",
    model: "Q.PEAK DUO BLK ML-G10+",
    watts: 400,
    efficiency: 20.4,
    installedCostPerWatt: INSTALLED_COST_PER_WATT,
    warranty_years: 25,
    warranty_power: "86% at 25 years",
    type: "Monocrystalline PERC",
    dimensions: "1879 x 1045 mm",
    weight_kg: 22,
    tempCoefficient: -0.34,
    tier: "mid",
    bestFor: "balanced residential performance",
    specSourceUrl: "https://us.qcells.com/q-peak-duo-blk-ml-g10/",
  },
  {
    id: "canadian-solar-hiku6",
    brand: "Canadian Solar",
    model: "HiKu6 CS6R-410MS",
    watts: 410,
    efficiency: 21,
    installedCostPerWatt: INSTALLED_COST_PER_WATT,
    warranty_years: 25,
    warranty_power: "84.8% at 25 years",
    type: "Monocrystalline PERC",
    dimensions: "1722 x 1134 mm",
    weight_kg: 21.3,
    tempCoefficient: -0.34,
    tier: "mid",
    bestFor: "compact residential roof layouts",
    specSourceUrl:
      "https://investors.canadiansolar.com/news-releases/news-release-details/canadian-solar-starts-mass-production-new-rooftop-module-power",
  },
  {
    id: "sunpower-maxeon-6",
    brand: "Maxeon",
    model: "Maxeon 6 DC 420",
    watts: 420,
    efficiency: 21.7,
    installedCostPerWatt: INSTALLED_COST_PER_WATT,
    warranty_years: 25,
    warranty_power: "Up to 40-year coverage through a Maxeon partner",
    type: "Maxeon back-contact",
    dimensions: "1872 x 1032 mm",
    weight_kg: 20.9,
    tempCoefficient: -0.29,
    tier: "premium",
    bestFor: "high efficiency and long warranty options",
    specSourceUrl:
      "https://maxeon.com/us/sites/default/files/2024-12/sp_max6_66c_res_420_410_dc_ds_en_ltr_552330.pdf",
  },
  {
    id: "jinko-tiger-neo",
    brand: "Jinko Solar",
    model: "Tiger Neo N-type 54HL4",
    watts: 415,
    efficiency: 21.25,
    installedCostPerWatt: INSTALLED_COST_PER_WATT,
    warranty_years: 12,
    warranty_power: "87.4% at 30 years",
    type: "N-type TOPCon",
    dimensions: "1722 x 1134 mm",
    weight_kg: 22,
    tempCoefficient: -0.3,
    tier: "value",
    bestFor: "N-type TOPCon performance",
    specSourceUrl:
      "https://www.jinkosolar.com/uploads/61970f6e/JKM410-430N-54HL4-%28V%29-F1-EN.pdf",
  },
  {
    id: "panasonic-evervolt",
    brand: "Panasonic",
    model: "EverVolt HK Black Series",
    watts: 410,
    efficiency: 22.2,
    installedCostPerWatt: INSTALLED_COST_PER_WATT,
    warranty_years: 25,
    warranty_power: "92% at 25 years",
    type: "HIT heterojunction",
    dimensions: "1821 x 1016 mm",
    weight_kg: 20.5,
    tempCoefficient: -0.26,
    tier: "premium",
    bestFor: "high output in hot climates",
    specSourceUrl: "https://ftp.panasonic.com/solar/datasheet/400_410_hk_series.pdf",
  },
];

export const DEFAULT_SOLAR_PANEL_ID = "qcells-q-peak-duo";

export const INVERTER_OPTIONS: InverterOption[] = [
  {
    id: "string",
    label: "String inverter",
    brands: "SolarEdge SE7600H, Fronius Primo 6.0",
    costAdderPerWatt: 0,
    bestFor: "simple roofs with no shade",
  },
  {
    id: "microinverters",
    label: "Microinverters",
    brands: "Enphase IQ8A",
    costAdderPerWatt: 0.4,
    bestFor: "roofs with trees/chimneys casting shade",
  },
  {
    id: "optimizers",
    label: "Power optimizers",
    brands: "SolarEdge with optimizers",
    costAdderPerWatt: 0.25,
    bestFor: "complex roofs with multiple orientations",
  },
];

export function getPanelById(panelId?: string | null) {
  return (
    SOLAR_PANELS.find((panel) => panel.id === panelId) ??
    SOLAR_PANELS.find((panel) => panel.id === DEFAULT_SOLAR_PANEL_ID) ??
    SOLAR_PANELS[0]
  );
}

export function getShortPanelBrand(brand?: string | null) {
  const normalized = brand?.trim() ?? "";

  if (!normalized) {
    return "Default";
  }

  if (/qcells/i.test(normalized)) {
    return "Qcells";
  }

  if (/canadian/i.test(normalized)) {
    return "Canadian";
  }

  if (/jinko/i.test(normalized)) {
    return "Jinko";
  }

  return normalized;
}

export function getShortPanelName(panel?: Pick<SolarPanel, "brand" | "watts"> | null) {
  if (!panel) {
    return "Default";
  }

  return `${getShortPanelBrand(panel.brand)} ${panel.watts}W`;
}

export function getInverterOption(inverterType?: InverterType | string | null) {
  return (
    INVERTER_OPTIONS.find((option) => option.id === inverterType) ??
    INVERTER_OPTIONS[0]
  );
}

export function getPanelAreaM2(panel: SolarPanel) {
  const { heightMeters, widthMeters } = getPanelDimensionsMeters(panel);

  return heightMeters * widthMeters;
}

export function getPanelDimensionsMeters(
  panel: Pick<SolarPanel, "dimensions">
) {
  const dimensions = panel.dimensions.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);

  if (!dimensions) {
    return { heightMeters: 1.9, widthMeters: 1 };
  }

  const firstMm = Number(dimensions[1]);
  const secondMm = Number(dimensions[2]);

  if (!Number.isFinite(firstMm) || !Number.isFinite(secondMm)) {
    return { heightMeters: 1.9, widthMeters: 1 };
  }

  return {
    heightMeters: Math.max(firstMm, secondMm) / 1000,
    widthMeters: Math.min(firstMm, secondMm) / 1000,
  };
}

export function getPanelFit(
  panel: SolarPanel,
  input: {
    roofData?: RoofAnalysis | null;
    usableAreaM2?: number | null;
    monthlyBill?: number | null;
    selectedPanelCount?: number | null;
    maxSunshineHoursPerYear?: number | null;
    inverterCostAdderPerWatt?: number | null;
  }
): PanelFit {
  const usableArea =
    input.usableAreaM2 ??
    (input.roofData ? getUsableAreaM2(input.roofData) : 0);
  const panelAreaM2 = Math.max(getPanelAreaM2(panel), 0.1);
  const AREA_PACKING_FACTOR = 0.85;
  const physicalFit = Math.max(
    0,
    Math.floor(
      (Math.max(usableArea, 0) / panelAreaM2) * AREA_PACKING_FACTOR
    )
  );
  const preliminaryCapacity = input.roofData
    ? getMaxPanelCount(input.roofData)
    : physicalFit;
  const providerPanelAreaM2 = input.roofData
    ? Math.max(
        input.roofData.panelWidthMeters * input.roofData.panelHeightMeters,
        0.1
      )
    : panelAreaM2;
  const moduleAdjustedCapacity = Math.max(
    0,
    Math.floor(
      preliminaryCapacity * (providerPanelAreaM2 / panelAreaM2)
    )
  );
  const maxPanelsFit = Math.max(
    0,
    Math.min(preliminaryCapacity, moduleAdjustedCapacity)
  );
  const requestedCount =
    input.selectedPanelCount && input.selectedPanelCount > 0
      ? Math.max(0, Math.floor(input.selectedPanelCount))
      : maxPanelsFit;
  const selectedCount = Math.min(requestedCount, maxPanelsFit);
  const sunshineHours =
    input.maxSunshineHoursPerYear ??
    input.roofData?.annualSunlightHours ??
    input.roofData?.annualKwh ??
    1800;
  const exactSystemKw = (selectedCount * panel.watts) / 1000;
  const systemKw = roundTo(exactSystemKw, 1);
  const providerAnnualKwh = getProviderAnnualKwh(
    input.roofData,
    selectedCount
  );
  const providerPanelWatts = Math.max(
    Number(input.roofData?.panelCapacityWatts ?? 400),
    1
  );
  const annualKwh = Math.round(
    providerAnnualKwh > 0
      ? providerAnnualKwh * (panel.watts / providerPanelWatts)
      : exactSystemKw * Math.max(sunshineHours, 0) * 0.8
  );
  const annualBill =
    input.monthlyBill && input.monthlyBill > 0 ? input.monthlyBill * 12 : null;
  const annualSavings = Math.round(
    annualBill
      ? Math.min(annualKwh * ARIZONA_AVG_RATE_PER_KWH, annualBill)
      : annualKwh * ARIZONA_AVG_RATE_PER_KWH
  );
  const installedCostPerWatt =
    panel.installedCostPerWatt + (input.inverterCostAdderPerWatt ?? 0);
  const systemCost = Math.round(
    selectedCount * panel.watts * installedCostPerWatt
  );
  const taxCredit = calculateFederalResidentialSolarCredit(systemCost);
  const netCost = Math.max(systemCost - taxCredit, 0);
  const paybackYears = annualSavings > 0 ? roundTo(netCost / annualSavings, 1) : 0;
  const azHeatLoss = 4.4 * Math.abs(panel.tempCoefficient) / 100;

  return {
    annualKwh,
    annualSavings,
    adjustedEfficiency: `${roundTo((1 - azHeatLoss) * 100, 1)}%`,
    azHeatLoss: `${roundTo(azHeatLoss * 100, 1)}% loss in AZ heat`,
    fits: maxPanelsFit >= 6,
    maxPanelsFit: selectedCount,
    netCost,
    paybackYears,
    recommended: paybackYears > 0 && paybackYears < 10 && selectedCount >= 10,
    systemCost,
    systemKw,
    taxCredit,
  };
}

function getProviderAnnualKwh(
  roofData: RoofAnalysis | null | undefined,
  panelCount: number
) {
  if (!roofData || panelCount <= 0) {
    return 0;
  }

  const config =
    roofData.solarPanelConfigs.find(
      (candidate) => candidate.panelsCount === panelCount
    ) ??
    roofData.solarPanelConfigs
      .filter((candidate) => candidate.panelsCount <= panelCount)
      .at(-1);

  if (config?.yearlyEnergyDcKwh && config.yearlyEnergyDcKwh > 0) {
    return config.yearlyEnergyDcKwh;
  }

  const panelEnergy = roofData.solarPanels
    .slice(0, panelCount)
    .reduce(
      (total, candidate) =>
        total + Math.max(candidate.yearlyEnergyDcKwh, 0),
      0
    );

  if (panelEnergy > 0) {
    return panelEnergy;
  }

  return roofData.panelCount > 0
    ? (roofData.annualKwh / roofData.panelCount) * panelCount
    : 0;
}

export function getRoofShadeRiskLabel(annualSunlightHours?: number | null) {
  const hours = Number(annualSunlightHours);

  if (!Number.isFinite(hours)) {
    return "Moderate";
  }

  if (hours > 1800) {
    return "Low";
  }

  if (hours >= 1400) {
    return "Moderate";
  }

  return "High";
}

export function getTierLabel(tier: SolarPanelTier) {
  if (tier === "premium") {
    return "PREMIUM";
  }

  if (tier === "value") {
    return "BEST VALUE";
  }

  return "MID-RANGE";
}

export function detectArizonaUtility(address: string) {
  const normalized = address.toLowerCase();
  const srpCities = [
    "mesa",
    "tempe",
    "chandler",
    "gilbert",
    "scottsdale",
    "phoenix",
    "queen creek",
    "apache junction",
  ];

  if (srpCities.some((city) => normalized.includes(city))) {
    return "SRP";
  }

  if (normalized.includes("az") || normalized.includes("arizona")) {
    return "APS";
  }

  return null;
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
