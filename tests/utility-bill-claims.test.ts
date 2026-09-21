import assert from "node:assert/strict";
import test from "node:test";
import {
  createUtilityBillUploadClaim,
  isUtilityBillUploadSecretConfigured,
  verifyUtilityBillUploadClaim,
} from "../src/lib/utility-bill-claims";

test("utility bill claims require the dedicated production secret and support explicit legacy verification during migration", (t) => {
  const environment = {
    DASHBOARD_ACCESS_TOKEN: "broader-dashboard-secret",
    NODE_ENV: "production",
    REPORT_SIGNING_SECRET: "broader-report-secret",
    SUPABASE_SERVICE_ROLE_KEY: "broader-service-secret",
    UTILITY_BILL_UPLOAD_LEGACY_SECRET: "",
    UTILITY_BILL_UPLOAD_SECRET: "",
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  assert.equal(isUtilityBillUploadSecretConfigured(), false);
  assert.equal(createUtilityBillUploadClaim("pending/2026-09-20/upload.pdf"), "");
  assert.deepEqual(verifyUtilityBillUploadClaim("v1.invalid.claim"), {
    ok: false,
    reason: "not_configured",
  });

  Object.assign(process.env, { UTILITY_BILL_UPLOAD_SECRET: "too-short" });
  assert.equal(isUtilityBillUploadSecretConfigured(), false);

  Object.assign(process.env, {
    UTILITY_BILL_UPLOAD_SECRET:
      "dedicated-upload-secret-with-at-least-32-characters",
  });
  assert.equal(isUtilityBillUploadSecretConfigured(), true);
  const claim = createUtilityBillUploadClaim("pending/2026-09-20/upload.pdf");
  assert.ok(claim);
  assert.deepEqual(verifyUtilityBillUploadClaim(claim), {
    ok: true,
    path: "pending/2026-09-20/upload.pdf",
  });

  // A previous deployment can set this explicit value while one-hour claims
  // drain. It never enables creation while the dedicated secret is absent.
  Object.assign(process.env, {
    NODE_ENV: "development",
    UTILITY_BILL_UPLOAD_SECRET: "legacy-upload-secret-for-migration",
  });
  const legacyClaim = createUtilityBillUploadClaim(
    "pending/2026-09-20/legacy.pdf"
  );
  assert.ok(legacyClaim);
  Object.assign(process.env, {
    NODE_ENV: "production",
    UTILITY_BILL_UPLOAD_LEGACY_SECRET: "legacy-upload-secret-for-migration",
    UTILITY_BILL_UPLOAD_SECRET: "",
  });
  assert.equal(isUtilityBillUploadSecretConfigured(), false);
  assert.deepEqual(verifyUtilityBillUploadClaim(legacyClaim), {
    ok: true,
    path: "pending/2026-09-20/legacy.pdf",
  });
  assert.equal(createUtilityBillUploadClaim("pending/2026-09-20/new.pdf"), "");
});
