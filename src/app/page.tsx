import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";

export const metadata: Metadata = {
  title: "See your home with solar",
  description:
    "See your roof with solar before you commit. Arizona homeowners can enter an address and get panel placement plus a fast savings estimate.",
};

export default function Page() {
  return <HomeClient />;
}
