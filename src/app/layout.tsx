import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope, Space_Grotesk } from "next/font/google";
import { GoogleAnalytics } from "@/components/google-analytics";
import { StructuredData } from "@/components/structured-data";
import { APP_CANONICAL_URL, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const editorial = Instrument_Serif({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: {
    default: `${APP_NAME} | Solar Readiness Reports & Roof Analysis`,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_TAGLINE,
  alternates: {
    canonical: APP_CANONICAL_URL,
  },
  keywords: [
    "Arizona solar",
    "solar estimate",
    "home solar savings",
    "address autocomplete",
    "AI solar report",
  ],
  authors: [{ name: APP_NAME }],
  creator: APP_NAME,
  publisher: APP_NAME,
  openGraph: {
    type: "website",
    title: `${APP_NAME} - Solar readiness reports and roof analysis`,
    description: APP_TAGLINE,
    siteName: APP_NAME,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${APP_NAME} - Solar readiness reports and roof analysis`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} - Solar readiness reports and roof analysis`,
    description: APP_TAGLINE,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  other: {
    "geo.region": "US-AZ",
    "geo.placename": "Arizona",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${display.variable} ${body.variable} ${editorial.variable} h-full`}
    >
      <body className="min-h-full antialiased">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <GoogleAnalytics />
        <StructuredData />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
