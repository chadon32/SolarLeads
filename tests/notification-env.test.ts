import assert from "node:assert/strict";
import test from "node:test";
import { getNotificationEnvStatus } from "../src/lib/notification-env";

const envKeys = [
  "RESEND_API_KEY",
  "FROM_EMAIL",
  "RESEND_FROM_EMAIL",
  "ADMIN_EMAIL",
  "OWNER_EMAIL",
] as const;

test("notification status treats admin email as optional", () => {
  const original = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]])
  );

  try {
    process.env.RESEND_API_KEY = "test-key";
    process.env.FROM_EMAIL = "reports@example.com";
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.ADMIN_EMAIL;
    delete process.env.OWNER_EMAIL;

    const status = getNotificationEnvStatus();

    assert.equal(status.configured, true);
    assert.equal(status.email.configured, true);
    assert.equal(status.adminEmail.configured, false);
    assert.deepEqual(status.missing, []);
    assert.deepEqual(status.optionalMissing, ["ADMIN_EMAIL or OWNER_EMAIL"]);
  } finally {
    for (const key of envKeys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});

