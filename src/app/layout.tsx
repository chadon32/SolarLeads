import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { GoogleAnalytics } from "@/components/google-analytics";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: {
    default: "See your home with solar",
    template: "%s | Arizona Solar AI",
  },
  description:
    "See your home with solar before you commit. Arizona homeowners can enter an address and get a roof analysis, panel placement, and a savings estimate.",
  alternates: {
    canonical: "https://solar-leads-psi.vercel.app/",
  },
  keywords: [
    "Arizona solar",
    "solar estimate",
    "home solar savings",
    "address autocomplete",
    "AI solar report",
  ],
  authors: [{ name: "Arizona Solar AI" }],
  creator: "Arizona Solar AI",
  publisher: "Arizona Solar AI",
  openGraph: {
    type: "website",
    title: "See your home with solar",
    description:
      "See your home with solar before you commit. Arizona homeowners can preview roof placement and modeled savings in under a minute.",
    siteName: "Arizona Solar AI",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Arizona Solar AI roof preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "See your home with solar",
    description:
      "See your home with solar before you commit. Arizona homeowners can preview roof placement and modeled savings in under a minute.",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon.svg",
  },
  other: {
    "geo.region": "US-AZ",
    "geo.placename": "Arizona",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full antialiased">
        <GoogleAnalytics />
        {children}
      </body>
    </html>
  );
}
