import { NextResponse } from "next/server";
import {
  HOUR_MS,
  isRequestTooLarge,
  payloadTooLargeResponse,
  readJsonWithLimit,
  readTextWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSessionCookieValue,
  getDashboardSessionCookieOptions,
  verifyDashboardToken,
} from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dashboardSessionSchema = z.object({
  nextPath: z.enum(["/dashboard", "/dashboard/installer"]).default("/dashboard"),
  token: z.string().trim().min(1).max(1024),
});

export async function POST(request: Request) {
  if (isRequestTooLarge(request, 16 * 1024)) {
    return payloadTooLargeResponse("Dashboard session payload is too large.");
  }

  const limit = await enforceRateLimit({
    request,
    route: "api:dashboard-session",
    limit: 10,
    windowMs: HOUR_MS,
  });

  if (!limit.allowed) {
    return rateLimitResponse(
      "Too many dashboard access attempts. Please wait and try again.",
      limit.retryAfterSeconds
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  const acceptsJson = request.headers
    .get("accept")
    ?.toLowerCase()
    .includes("application/json");
  const parsed = dashboardSessionSchema.safeParse(
    await readSessionRequest(request, contentType)
  );
  const nextPath = parsed.success ? parsed.data.nextPath : "/dashboard";
  const auth = verifyDashboardToken(parsed.success ? parsed.data.token : "");

  if (!auth.ok) {
    const message =
      auth.reason === "not_configured"
        ? "Dashboard access is not configured."
        : "Invalid dashboard token.";

    if (acceptsJson) {
      return NextResponse.json({ message }, { status: 403 });
    }

    return NextResponse.redirect(
      new URL(`${safeNextPath(nextPath)}?access=denied`, request.url),
      303
    );
  }

  const response = acceptsJson
    ? NextResponse.json({ success: true })
    : NextResponse.redirect(new URL(safeNextPath(nextPath), request.url), 303);
  const sessionValue = createDashboardSessionCookieValue();

  if (!sessionValue) {
    return NextResponse.json(
      { message: "Dashboard access is not configured." },
      { status: 500 }
    );
  }

  response.cookies.set(
    DASHBOARD_SESSION_COOKIE,
    sessionValue,
    getDashboardSessionCookieOptions()
  );

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });

  response.cookies.set(DASHBOARD_SESSION_COOKIE, "", {
    ...getDashboardSessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}

async function readSessionRequest(request: Request, contentType: string) {
  if (contentType.includes("application/json")) {
    const result = await readJsonWithLimit(request, 16 * 1024);
    const body = (result.ok ? result.data : {}) as {
      next?: string;
      token?: string;
    };

    return {
      nextPath: body.next ?? "/dashboard",
      token: body.token,
    };
  }

  const result = await readTextWithLimit(request, 16 * 1024);
  const formData = new URLSearchParams(result.ok ? result.data : "");

  return {
    nextPath: formData.get("next") ?? "/dashboard",
    token: formData.get("token") ?? "",
  };
}

function safeNextPath(nextPath?: string | null) {
  if (nextPath === "/dashboard" || nextPath === "/dashboard/installer") {
    return nextPath;
  }

  return "/dashboard";
}
