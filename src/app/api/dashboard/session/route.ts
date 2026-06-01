import { NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSessionCookieValue,
  getDashboardSessionCookieOptions,
  verifyDashboardToken,
} from "@/lib/dashboard-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const acceptsJson = request.headers
    .get("accept")
    ?.toLowerCase()
    .includes("application/json");
  const { nextPath, token } = await readSessionRequest(request, contentType);
  const auth = verifyDashboardToken(token);

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
    const body = (await request.json().catch(() => ({}))) as {
      next?: string;
      token?: string;
    };

    return {
      nextPath: body.next,
      token: body.token,
    };
  }

  const formData = await request.formData();

  return {
    nextPath: String(formData.get("next") ?? ""),
    token: String(formData.get("token") ?? ""),
  };
}

function safeNextPath(nextPath?: string | null) {
  if (nextPath === "/dashboard" || nextPath === "/dashboard/installer") {
    return nextPath;
  }

  return "/dashboard";
}
