import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${APP_NAME} | Solar Readiness Reports & Roof Analysis`,
  description: APP_TAGLINE,
};

export default function Page() {
  return <HomeClient />;
}
