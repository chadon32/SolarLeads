import type { Metadata } from "next";
import { ThankYouClient } from "@/components/thank-you-client";

export const metadata: Metadata = {
  title: {
    absolute: "Your Solar Report Is Ready | Arizona Solar AI",
  },
  description:
    "Review the next steps after generating your Arizona Solar AI homeowner report.",
};

export default function ThankYouPage() {
  return <ThankYouClient />;
}
