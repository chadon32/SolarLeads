import type { Metadata } from "next";
import { ThankYouClient } from "@/components/thank-you-client";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: {
    absolute: `Your Solar Report Is Ready | ${APP_NAME}`,
  },
  description: `Review the next steps after generating your ${APP_NAME} homeowner report.`,
};

export default function ThankYouPage() {
  return <ThankYouClient />;
}
