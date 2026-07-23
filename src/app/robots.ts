import type { MetadataRoute } from "next";
import { APP_CANONICAL_URL } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard/",
        "/estimate",
        "/marketing/",
        "/report/",
        "/thank-you",
      ],
    },
    sitemap: `${APP_CANONICAL_URL}/sitemap.xml`,
  };
}
