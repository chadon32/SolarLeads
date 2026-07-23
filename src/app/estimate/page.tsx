import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";
import { APP_NAME } from "@/lib/brand";

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
    app?: string;
  }>;
};

export default async function EstimatePage({ searchParams }: EstimatePageProps) {
  const params = await searchParams;
  const initialAddress = params?.address?.trim() ?? "";
  const nativeApp = params?.app === "ios";

  return <HomeClient initialAddress={initialAddress} nativeApp={nativeApp} />;
}
