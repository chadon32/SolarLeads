import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSessionCookieValue,
} from "../src/lib/dashboard-auth";
import { getSolarImageryLimits } from "../src/lib/solar-imagery-limits";

test("solar imagery limits require real dashboard authentication", (t) => {
  const environment = {
    DASHBOARD_ACCESS_TOKEN: "solar-imagery-dashboard-test-secret",
    NODE_ENV: "development",
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

  const publicLimits = { hourly: 60, daily: 300, key: undefined };
  const dashboardLimits = {
    hourly: 300,
    daily: 1500,
    key: "dashboard-imagery-testing",
  };

  assert.deepEqual(
    getSolarImageryLimits(
      new Request("https://dashboard.example/api/solar/geotiff")
    ),
    publicLimits
  );

  let forgedCookie = "";
  process.env.DASHBOARD_ACCESS_TOKEN = "attacker-controlled-secret";
  try {
    forgedCookie = createDashboardSessionCookieValue();
  } finally {
    process.env.DASHBOARD_ACCESS_TOKEN = environment.DASHBOARD_ACCESS_TOKEN;
  }
  assert.ok(forgedCookie);
  assert.deepEqual(
    getSolarImageryLimits(
      new Request("https://dashboard.example/api/solar/geotiff", {
        headers: {
          cookie: `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(forgedCookie)}`,
        },
      })
    ),
    publicLimits
  );

  assert.deepEqual(
    getSolarImageryLimits(
      new Request("https://dashboard.example/api/solar/geotiff", {
        headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=%` },
      })
    ),
    publicLimits
  );

  assert.deepEqual(
    getSolarImageryLimits(
      new Request("https://dashboard.example/api/solar/geotiff", {
        headers: { authorization: "Bearer attacker-controlled-token" },
      })
    ),
    publicLimits
  );

  assert.deepEqual(
    getSolarImageryLimits(
      new Request(
        "https://dashboard.example/api/solar/geotiff?admin=true&isAdmin=true"
      )
    ),
    publicLimits
  );

  const signedCookie = createDashboardSessionCookieValue();
  assert.ok(signedCookie);
  assert.deepEqual(
    getSolarImageryLimits(
      new Request("https://dashboard.example/api/solar/geotiff", {
        headers: {
          cookie: `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(signedCookie)}`,
        },
      })
    ),
    dashboardLimits
  );

  const now = Date.now();
  const expiredIssuedAt = now - 13 * 60 * 60 * 1000;
  const dateNowMock = t.mock.method(Date, "now", () => expiredIssuedAt);
  let expiredCookie = "";
  try {
    expiredCookie = createDashboardSessionCookieValue();
  } finally {
    dateNowMock.mock.restore();
  }
  assert.ok(expiredCookie);
  assert.deepEqual(
    getSolarImageryLimits(
      new Request("https://dashboard.example/api/solar/geotiff", {
        headers: {
          cookie: `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(expiredCookie)}`,
        },
      })
    ),
    publicLimits
  );
});
