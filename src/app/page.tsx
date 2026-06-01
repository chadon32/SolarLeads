import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";

export const metadata: Metadata = {
  title: "Arizona Solar Savings Estimate",
  description:
    "Enter your Arizona address to see satellite roof imagery, panel placement, and a personalized solar savings estimate.",
};

export default function Page() {
  return <HomeClient />;
}
