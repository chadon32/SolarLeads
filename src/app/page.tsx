import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";
import { StructuredData } from "@/components/structured-data";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Arizona Solar Calculator & 3D Roof Analysis",
  description: "Explore your Arizona home's solar potential with a free roof analysis, preliminary 3D panel layout and savings estimate. Installer contact is optional.",
  path: "/",
});

export default function Page() {
  return <><StructuredData /><HomeClient /></>;
}
