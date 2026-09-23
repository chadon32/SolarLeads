import assert from "node:assert/strict";
import test from "node:test";
import { getPublicSiteUrl } from "../src/lib/public-site-url";

function withEnvironment<T>(environment: Record<string, string | undefined>, run: () => T) {
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production report links use the canonical domain despite a Vercel alias override", () => {
  const siteUrl = withEnvironment(
    {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://solar-leads-psi.vercel.app/dashboard",
      VERCEL_URL: "solar-leads-psi.vercel.app",
    },
    getPublicSiteUrl
  );

  assert.equal(siteUrl, "https://solartelligence.com");
});

test("preview report links use the deployment host", () => {
  const siteUrl = withEnvironment(
    {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: "https://solartelligence.com",
      VERCEL_URL: "solar-leads-git-fix-preview.vercel.app",
    },
    getPublicSiteUrl
  );

  assert.equal(siteUrl, "https://solar-leads-git-fix-preview.vercel.app");
});

test("development report links accept a configured local origin", () => {
  const siteUrl = withEnvironment(
    {
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
      NEXT_PUBLIC_SITE_URL: "http://localhost:3102/dashboard",
      VERCEL_URL: undefined,
    },
    getPublicSiteUrl
  );

  assert.equal(siteUrl, "http://localhost:3102");
});

test("development report links fall back when the configured URL is invalid", () => {
  const siteUrl = withEnvironment(
    {
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
      NEXT_PUBLIC_SITE_URL: "not a URL",
      VERCEL_URL: undefined,
    },
    getPublicSiteUrl
  );

  assert.equal(siteUrl, "http://localhost:3000");
});
