import assert from "node:assert/strict";
import test from "node:test";
import { sendHomeownerReportEmail } from "../src/lib/notifications";

test("homeowner delivery requires affirmative provider acceptance", async (t) => {
  const env = {
    RESEND_API_KEY: "re_isolated_test_key",
    FROM_EMAIL: "reports@example.test",
    DISABLE_EMAIL_SENDING: "false",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let body: Record<string, unknown> = {};
  let loseResponse = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://api.resend.com");
    if (loseResponse) throw new TypeError("Synthetic connection lost after send");
    return Response.json(body);
  });
  const input = {
    leadId: "00000000-0000-4000-8000-000000000001",
    name: "Synthetic Homeowner",
    email: "homeowner@example.test",
    phone: "",
    address: "1 Synthetic Way, Mesa, AZ 85201",
    annualSavings: null,
    reportUrl: "https://reports.example.test/report/fixture",
    adminReportUrl: "https://reports.example.test/report/fixture",
  };
  for (body of [{}, { id: null }, { id: "" }]) {
    const result = await sendHomeownerReportEmail(input);
    assert.equal(result.ok, false, "An empty provider response must not say the email was sent");
    assert.equal(result.sentAt, undefined);
    assert.equal(result.reason, "acceptance_unconfirmed");
  }
  body = { id: "synthetic-provider-message" };
  const result = await sendHomeownerReportEmail(input);
  assert.equal(result.ok, true);
  assert.equal(result.messageId, "synthetic-provider-message");
  assert.ok(result.sentAt);
  loseResponse = true;
  const uncertain = await sendHomeownerReportEmail(input);
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.reason, "acceptance_unconfirmed");
});
