import "server-only";
import { APP_CANONICAL_URL } from "@/lib/brand";

export function getPublicSiteUrl() {
  const deploymentEnvironment = process.env.VERCEL_ENV;

  if (
    deploymentEnvironment === "production" ||
    (!deploymentEnvironment && process.env.NODE_ENV === "production")
  ) {
    return APP_CANONICAL_URL;
  }

  if (deploymentEnvironment === "preview" && process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}`;
  }

  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredUrl) {
    try {
      const parsedUrl = new URL(configuredUrl);
      if (parsedUrl.protocol === "https:" || parsedUrl.hostname === "localhost") {
        return parsedUrl.origin;
      }
    } catch {
      // Invalid local configuration falls back to the local app URL.
    }
  }

  return "http://localhost:3000";
}
