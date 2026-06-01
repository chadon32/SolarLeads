import type { Metadata } from "next";
import Script from "next/script";
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
    default: "Arizona Solar Savings Estimate",
    template: "%s | Arizona Solar AI",
  },
  description:
    "Enter your Arizona address to see satellite roof imagery, panel placement, and a personalized solar savings estimate.",
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
    title: "Arizona Solar AI - Free roof solar estimate",
    description:
      "Enter your Arizona address to preview roof placement and modeled solar savings in under a minute.",
    siteName: "Arizona Solar AI",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Arizona Solar AI - Free roof solar estimate",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Arizona Solar AI - Free roof solar estimate",
    description:
      "Enter your Arizona address to preview roof placement and modeled solar savings in under a minute.",
    images: ["/opengraph-image"],
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
        <Script
          src="https://assets.calendly.com/assets/external/widget.js"
          strategy="lazyOnload"
        />
        {children}
      </body>
    </html>
  );
}
