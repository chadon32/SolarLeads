import assert from "node:assert/strict";
import test from "node:test";

test("utility bill provider errors stay out of responses and server logs", async (t) => {
  const environment = {
    CRON_SECRET: "",
    DASHBOARD_ACCESS_TOKEN: "utility-error-test-token",
    NODE_ENV: "development",
    SUPABASE_SERVICE_ROLE_KEY: "utility-error-test-service-key",
    SUPABASE_URL: "http://127.0.0.1:9",
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

  const hostileProviderMessage =
    "provider-secret=HOSTILE_ERROR_MUST_NOT_ESCAPE";
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logs.push(args);
  });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ message: hostileProviderMessage }, { status: 500 })
  );

  const [{ GET: download }, { POST: cleanup }] = await Promise.all([
    import("../src/app/api/utility-bills/download/route"),
    import("../src/app/api/utility-bills/cleanup/route"),
  ]);
  const auth = { authorization: "Bearer utility-error-test-token" };

  const downloadResponse = await download(
    new Request(
      "https://dashboard.example/api/utility-bills/download?leadId=11111111-1111-4111-8111-111111111111",
      { headers: auth }
    )
  );
  const cleanupResponse = await cleanup(
    new Request("https://dashboard.example/api/utility-bills/cleanup", {
      method: "POST",
      headers: auth,
    })
  );

  assert.equal(downloadResponse.status, 503);
  assert.equal(cleanupResponse.status, 503);
  const responseText = `${await downloadResponse.text()} ${await cleanupResponse.text()}`;
  const logText = JSON.stringify(logs);
  assert.equal(responseText.includes(hostileProviderMessage), false);
  assert.equal(logText.includes(hostileProviderMessage), false);
  assert.match(logText, /providerErrorType/);
  assert.doesNotMatch(logText, /"providerError":/);
});
