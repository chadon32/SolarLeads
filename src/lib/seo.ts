import type { Metadata } from "next";
import { APP_CANONICAL_URL, APP_NAME } from "@/lib/brand";

export function publicPageMetadata({ title, description, path }: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = new URL(path, APP_CANONICAL_URL).toString();
  const brandedTitle = `${title} | ${APP_NAME}`;
  return {
    title: { absolute: brandedTitle },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title: brandedTitle,
      description,
      url,
      siteName: APP_NAME,
      locale: "en_US",
      images: [{ url: `${APP_CANONICAL_URL}/opengraph-image`, width: 1200, height: 630, alt: `${APP_NAME} solar roof analysis` }],
    },
    twitter: {
      card: "summary_large_image",
      title: brandedTitle,
      description,
      images: [`${APP_CANONICAL_URL}/opengraph-image`],
    },
  };
}

// A deployment previously set NEXT_PUBLIC_SITE_URL to a Vercel dashboard URL.
// Keep public SEO URLs independent of environment-specific application links.
export const INDEXABLE_PATHS = ["/", "/solar-guide", "/privacy", "/terms"] as const;

export function isPreviewDeployment() {
  return Boolean(process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production");
}
