import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
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
    default: "Address-to-Roof Solar Preview",
    template: "%s | Address-to-Roof Solar Preview",
  },
  description:
    "Premium AI solar preview for Arizona homeowners with address autocomplete, roof analysis, install visuals, and a fast lead-to-report flow.",
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
    title: "Address-to-Roof Solar Preview",
    description:
      "Premium AI solar preview for Arizona homeowners with address autocomplete, roof analysis, and install visuals.",
    siteName: "Address-to-Roof Solar Preview",
  },
  twitter: {
    card: "summary_large_image",
    title: "Address-to-Roof Solar Preview",
    description:
      "Premium AI solar preview for Arizona homeowners with address autocomplete, roof analysis, and install visuals.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
