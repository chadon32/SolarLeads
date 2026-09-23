import type { MetadataRoute } from "next";
import { APP_CANONICAL_URL } from "@/lib/brand";
import { INDEXABLE_PATHS, isPreviewDeployment } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (isPreviewDeployment()) return [];
  // Add lastModified only when there is a genuine editorial modification date.
  return INDEXABLE_PATHS.map((path) => ({ url: new URL(path, APP_CANONICAL_URL).toString() }));
}
