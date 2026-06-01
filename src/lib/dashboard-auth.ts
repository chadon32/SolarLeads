import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export type DashboardAuthResult =
  | { ok: true; token: string }
  | { ok: false; reason: "missing" | "not_configured" | "invalid" };

export const DASHBOARD_SESSION_COOKIE = "azsa_dashboard_session";
const DASHBOARD_SESSION_TTL_SECONDS = 60 * 60 * 12;

export function getDashboardAccessToken() {
  return process.env.DASHBOARD_ACCESS_TOKEN?.trim() ?? "";
}

export function getDashboardTokenFromRequest(request: Request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization")?.trim();
  const dashboardHeader = request.headers.get("x-dashboard-token")?.trim();

  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  if (dashboardHeader) {
    return dashboardHeader;
  }

  return url.searchParams.get("token")?.trim() ?? "";
}

export function getDashboardSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: DASHBOARD_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function verifyDashboardToken(token?: string | null): DashboardAuthResult {
  const expected = getDashboardAccessToken();
  const provided = token?.trim() ?? "";

  if (!expected) {
    return { ok: false, reason: "not_configured" };
  }

  if (!provided) {
    return { ok: false, reason: "missing" };
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, token: provided };
}

export function createDashboardSessionCookieValue() {
  const secret = getDashboardAccessToken();

  if (!secret) {
    return "";
  }

  const expiresAt = Date.now() + DASHBOARD_SESSION_TTL_SECONDS * 1000;
  const nonce = randomBytes(16).toString("hex");
  const signature = signDashboardSession(String(expiresAt), nonce, secret);

  return ["v1", expiresAt, nonce, signature].join(".");
}

export function getDashboardSessionCookieFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";

  return parseCookieValue(cookieHeader, DASHBOARD_SESSION_COOKIE);
}

export function verifyDashboardSessionCookie(
  value?: string | null
): DashboardAuthResult {
  const secret = getDashboardAccessToken();
  const session = value?.trim() ?? "";

  if (!secret) {
    return { ok: false, reason: "not_configured" };
  }

  if (!session) {
    return { ok: false, reason: "missing" };
  }

  const [version, expiresAt, nonce, signature] = session.split(".");
  const expiry = Number(expiresAt);

  if (
    version !== "v1" ||
    !expiresAt ||
    !nonce ||
    !signature ||
    !Number.isFinite(expiry) ||
    Date.now() > expiry
  ) {
    return { ok: false, reason: "invalid" };
  }

  const expected = signDashboardSession(expiresAt, nonce, secret);

  if (!constantTimeEquals(expected, signature)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, token: "dashboard-session" };
}

export function verifyDashboardRequest(request: Request) {
  const tokenAuth = verifyDashboardToken(getDashboardTokenFromRequest(request));

  if (tokenAuth.ok) {
    return tokenAuth;
  }

  return verifyDashboardSessionCookie(
    getDashboardSessionCookieFromRequest(request)
  );
}

export function requireDashboardAuth(request: Request) {
  const auth = verifyDashboardRequest(request);

  if (auth.ok) {
    return null;
  }

  return NextResponse.json(
    {
      message:
        auth.reason === "not_configured"
          ? "Dashboard access is not configured."
          : "Dashboard access is required.",
    },
    { status: 403 }
  );
}

function signDashboardSession(expiresAt: string, nonce: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`dashboard-session:${expiresAt}:${nonce}`)
    .digest("hex");
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length || !leftBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookieValue(cookieHeader: string, name: string) {
  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");

    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return "";
}
