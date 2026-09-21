import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSessionCookieValue,
  getDashboardSessionCookieOptions,
  getDashboardTokenFromRequest,
  requireDashboardAuth,
  verifyDashboardRequest,
} from "../src/lib/dashboard-auth";

test("dashboard access uses headers or the HttpOnly session and rejects URL-only and cross-site cookie requests", async (t) => {
  const environment = {
    DASHBOARD_ACCESS_TOKEN: "dashboard-test-token",
    NODE_ENV: "development",
    RATE_LIMIT_SECRET: "dashboard-auth-test-rate-limit",
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

  const urlOnlyRequest = new Request(
    "https://dashboard.example/api/leads/status?token=dashboard-test-token",
    { method: "PATCH" }
  );
  assert.equal(getDashboardTokenFromRequest(urlOnlyRequest), "");
  assert.equal(verifyDashboardRequest(urlOnlyRequest).ok, false);
  assert.equal(requireDashboardAuth(urlOnlyRequest)?.status, 403);

  const headerRequest = new Request("https://dashboard.example/api/leads/status", {
    headers: { authorization: "Bearer dashboard-test-token" },
    method: "PATCH",
  });
  assert.equal(verifyDashboardRequest(headerRequest).ok, true);
  assert.equal(requireDashboardAuth(headerRequest), null);

  const sessionValue = createDashboardSessionCookieValue();
  assert.ok(sessionValue);
  const sessionRequest = new Request("https://dashboard.example/api/leads/status", {
    headers: {
      cookie: `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(sessionValue)}`,
      origin: "https://dashboard.example",
    },
    method: "PATCH",
  });
  assert.equal(verifyDashboardRequest(sessionRequest).ok, true);
  assert.equal(requireDashboardAuth(sessionRequest), null);

  const crossSiteRequest = new Request("https://dashboard.example/api/leads/status", {
    headers: {
      cookie: `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(sessionValue)}`,
      origin: "https://attacker.example",
    },
    method: "PATCH",
  });
  assert.equal(requireDashboardAuth(crossSiteRequest)?.status, 403);

  const cookieOptions = getDashboardSessionCookieOptions();
  assert.equal(cookieOptions.httpOnly, true);
  assert.equal(cookieOptions.sameSite, "lax");
});

test("dashboard session bootstrap accepts a POST token and returns a token-free HttpOnly session redirect", async (t) => {
  const environment = {
    DASHBOARD_ACCESS_TOKEN: "dashboard-session-test-token",
    NODE_ENV: "development",
    RATE_LIMIT_SECRET: "dashboard-session-test-rate-limit",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_URL: "",
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

  const { POST } = await import("../src/app/api/dashboard/session/route");
  const response = await POST(
    new Request("https://dashboard.example/api/dashboard/session", {
      body: "next=%2Fdashboard&token=dashboard-session-test-token",
      headers: {
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://dashboard.example",
      },
      method: "POST",
    })
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://dashboard.example/dashboard");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.doesNotMatch(response.headers.get("location") ?? "", /token/i);
});
