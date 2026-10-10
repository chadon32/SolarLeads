import assert from "node:assert/strict";
import test from "node:test";

test("lead deletion requires dashboard authentication", async (t) => {
  const previous = process.env.DASHBOARD_ACCESS_TOKEN;
  process.env.DASHBOARD_ACCESS_TOKEN = "lead-delete-test-token";
  t.after(() => {
    if (previous === undefined) delete process.env.DASHBOARD_ACCESS_TOKEN;
    else process.env.DASHBOARD_ACCESS_TOKEN = previous;
  });

  const { DELETE } = await import("../src/app/api/leads/[leadId]/route");
  const response = await DELETE(
    new Request("https://dashboard.example/api/leads/not-a-uuid", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ leadId: "not-a-uuid" }) }
  );

  assert.equal(response.status, 403);
});

test("lead deletion rejects malformed IDs before accessing storage", async (t) => {
  const environment = {
    DASHBOARD_ACCESS_TOKEN: "lead-delete-validation-token",
    RATE_LIMIT_SECRET: "lead-delete-test-rate-limit",
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

  const { DELETE } = await import("../src/app/api/leads/[leadId]/route");
  const response = await DELETE(
    new Request("https://dashboard.example/api/leads/not-a-uuid", {
      headers: {
        authorization: "Bearer lead-delete-validation-token",
      },
      method: "DELETE",
    }),
    { params: Promise.resolve({ leadId: "not-a-uuid" }) }
  );

  assert.equal(response.status, 400);
});
