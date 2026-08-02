import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";
import { APP_NAME } from "@/lib/brand";
import { getBatteryById } from "@/lib/batteries";
import {
  getPanelById,
  type InverterType,
} from "@/lib/solarPanels";

export const metadata: Metadata = {
  title: {
    absolute: `Shared Solar Estimate | ${APP_NAME}`,
  },
  description: `Review a shared ${APP_NAME} roof and savings estimate.`,
  robots: { index: false, follow: false },
};

type EstimatePageProps = {
  searchParams?: Promise<{
    address?: string;
    addBattery?: string;
    app?: string;
    battery?: string;
    bill?: string;
    inverter?: string;
    lat?: string;
    lng?: string;
    panel?: string;
    panels?: string;
  }>;
};

export default async function EstimatePage({ searchParams }: EstimatePageProps) {
  const params = await searchParams;
  const initialAddress = params?.address?.trim() ?? "";
  const nativeApp = params?.app === "ios";
  const initialMonthlyBill = parseBoundedInteger(params?.bill, 1, 5_000) ?? 200;
  const initialPanelCount = parseBoundedInteger(params?.panels, 0, 500) ?? 0;
  const initialLatitude = parseCoordinate(params?.lat, -90, 90);
  const initialLongitude = parseCoordinate(params?.lng, -180, 180);
  const initialInverterType = isInverterType(params?.inverter)
    ? params.inverter
    : undefined;

  return (
    <HomeClient
      initialAddress={initialAddress}
      initialAddBattery={params?.addBattery === "1"}
      initialBatteryOption={getBatteryById(params?.battery)?.id}
      initialInverterType={initialInverterType}
      initialLatitude={initialLatitude}
      initialLongitude={initialLongitude}
      initialMonthlyBill={initialMonthlyBill}
      initialPanelCount={initialPanelCount}
      initialPanelId={getPanelById(params?.panel).id}
      nativeApp={nativeApp}
    />
  );
}

function parseBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number
) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }

  return parsed;
}

function parseCoordinate(value: string | undefined, minimum: number, maximum: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return undefined;
  }

  return parsed;
}

function isInverterType(value: string | undefined): value is InverterType {
  return value === "string" || value === "microinverters" || value === "optimizers";
}
