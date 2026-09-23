import assert from "node:assert/strict";
import test from "node:test";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";
import { INDEXABLE_PATHS, publicPageMetadata } from "../src/lib/seo";

test("public metadata keeps canonical and social URLs on the production origin", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.invalid/dashboard";
  try {
    for (const path of INDEXABLE_PATHS) {
      const metadata = publicPageMetadata({ title: "Example", description: "Description", path });
      assert.equal(metadata.alternates?.canonical, `https://solartelligence.com${path}`);
      assert.deepEqual(metadata.title, { absolute: "Example | Solartelligence" });
      assert.equal(metadata.openGraph?.url, `https://solartelligence.com${path}`);
      assert.ok(JSON.stringify(metadata.openGraph?.images).includes("https://solartelligence.com/opengraph-image"));
      assert.equal(JSON.stringify(metadata).includes("example.invalid"), false);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("sitemap excludes private routes and does not fabricate last-modified dates", () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    assert.deepEqual(sitemap().map((entry) => new URL(entry.url).pathname), INDEXABLE_PATHS);
    assert.ok(sitemap().every((entry) => entry.lastModified === undefined));
    const rules = robots().rules;
    assert.equal(Array.isArray(rules), false);
    if (!Array.isArray(rules)) {
      assert.deepEqual(rules.disallow, ["/api/", "/marketing/"]);
    }
    assert.equal(robots().sitemap, "https://solartelligence.com/sitemap.xml");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("preview sitemap does not advertise indexable pages", () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    assert.deepEqual(sitemap(), []);
    assert.equal(robots().sitemap, undefined);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});
