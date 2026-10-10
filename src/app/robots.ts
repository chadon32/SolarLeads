import type { MetadataRoute } from "next";
import { APP_CANONICAL_URL } from "@/lib/brand";
import { isPreviewDeployment } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Auth protects private data; crawling must be allowed to see page noindex.
      disallow: ["/api/", "/marketing/"],
    },
    ...(isPreviewDeployment() ? {} : { sitemap: `${APP_CANONICAL_URL}/sitemap.xml` }),
  };
}
