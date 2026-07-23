import type { MetadataRoute } from "next";
import { APP_CANONICAL_URL } from "@/lib/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_CANONICAL_URL,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${APP_CANONICAL_URL}/privacy`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${APP_CANONICAL_URL}/terms`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
