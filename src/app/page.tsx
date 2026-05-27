import type { Metadata } from "next";
import { HomeClient } from "@/components/home-client";

export const metadata: Metadata = {
  title: "Address-to-Roof Solar Preview",
  description:
    "Premium AI solar preview for Arizona homeowners with address autocomplete, roof analysis, install visuals, and a fast lead-to-report flow.",
};

export default function Page() {
  return <HomeClient />;
}
