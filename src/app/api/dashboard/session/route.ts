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
  getDashboardTokenFromRequest,
  isDashboardRequestOriginAllowed,
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

  if (!isDashboardRequestOriginAllowed(request)) {
    return NextResponse.json(
      { message: "Dashboard request origin is not allowed." },
      { status: 403 }
    );
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
  const headerToken = getDashboardTokenFromRequest(request);
  const sessionRequest = await readSessionRequest(request, contentType);
  const parsed = dashboardSessionSchema.safeParse(
    sessionRequest.token ? sessionRequest : { ...sessionRequest, token: headerToken }
  );
  const nextPath = parsed.success ? parsed.data.nextPath : "/dashboard";
  const auth = verifyDashboardToken(parsed.success ? parsed.data.token : "");

  if (!auth.ok) {
    const message =
      auth.reason === "not_configured"
        ? "Dashboard access is not configured."
        : "Invalid dashboard token.";

    const response = acceptsJson
      ? NextResponse.json({ message }, { status: 403 })
      : NextResponse.redirect(
          new URL(`${safeNextPath(nextPath)}?access=denied`, request.url),
          303
        );
    setNoStoreHeaders(response);
    return response;
  }

  const response = acceptsJson
    ? NextResponse.json({ success: true })
    : NextResponse.redirect(new URL(safeNextPath(nextPath), request.url), 303);
  const sessionValue = createDashboardSessionCookieValue();

  if (!sessionValue) {
    const response = NextResponse.json(
      { message: "Dashboard access is not configured." },
      { status: 500 }
    );
    setNoStoreHeaders(response);
    return response;
  }

  response.cookies.set(
    DASHBOARD_SESSION_COOKIE,
    sessionValue,
    getDashboardSessionCookieOptions()
  );
  setNoStoreHeaders(response);

  return response;
}

export async function DELETE(request: Request) {
  if (!isDashboardRequestOriginAllowed(request)) {
    return NextResponse.json(
      { message: "Dashboard request origin is not allowed." },
      { status: 403 }
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(DASHBOARD_SESSION_COOKIE, "", {
    ...getDashboardSessionCookieOptions(),
    maxAge: 0,
  });
  setNoStoreHeaders(response);

  return response;
}

function setNoStoreHeaders(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
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
