import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";

export const metadata: Metadata = {
  title: {
    absolute: "Shared Solar Estimate | Arizona Solar AI",
  },
  description: "Review a shared Arizona Solar AI roof and savings estimate.",
};

type EstimatePageProps = {
  searchParams?: Promise<{
    address?: string;
  }>;
};

export default async function EstimatePage({ searchParams }: EstimatePageProps) {
  const params = await searchParams;
  const initialAddress = params?.address?.trim() ?? "";

  return <HomeClient initialAddress={initialAddress} />;
}
