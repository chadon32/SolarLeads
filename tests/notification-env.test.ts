import assert from "node:assert/strict";
import test from "node:test";
import {
  getNotificationEnvStatus,
  getResendFromEmail,
} from "../src/lib/notification-env";

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

test("Gmail sender configuration falls back to the verified branded sender", () => {
  const originalFrom = process.env.FROM_EMAIL;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;

  try {
    process.env.FROM_EMAIL = "chadon322@gmail.com";
    delete process.env.RESEND_FROM_EMAIL;

    assert.equal(getResendFromEmail(), "reports@solartelligence.com");
  } finally {
    if (originalFrom === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = originalFrom;
    if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalResendFrom;
  }
});

test("verified configured sender takes precedence over an unverified Gmail sender", () => {
  const originalFrom = process.env.FROM_EMAIL;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;

  try {
    process.env.FROM_EMAIL = "Chadon <chadon322@gmail.com>";
    process.env.RESEND_FROM_EMAIL = "reports@solartelligence.com";

    assert.equal(getResendFromEmail(), "reports@solartelligence.com");
  } finally {
    if (originalFrom === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = originalFrom;
    if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalResendFrom;
  }
});

test("non-Gmail custom senders remain configurable", () => {
  const originalFrom = process.env.FROM_EMAIL;

  try {
    process.env.FROM_EMAIL = "reports@mail.example.com";
    delete process.env.RESEND_FROM_EMAIL;

    assert.equal(getResendFromEmail(), "reports@mail.example.com");
  } finally {
    if (originalFrom === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = originalFrom;
  }
});
