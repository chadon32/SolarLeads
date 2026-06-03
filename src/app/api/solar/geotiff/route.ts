import { NextResponse } from "next/server";
import {
  disabledFeatureResponse,
  isKillSwitchEnabled,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";

const GOOGLE_SOLAR_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY;

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:solar-geotiff",
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many Solar GeoTIFF requests. Please try again shortly.",
        rateLimit.retryAfterSeconds
      );
    }

    if (isKillSwitchEnabled("DISABLE_SOLAR_API_CALLS")) {
      return disabledFeatureResponse(
        "Solar data layers are temporarily unavailable."
      );
    }

    if (!GOOGLE_SOLAR_KEY) {
      return NextResponse.json(
        { message: "Google Solar API key is not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return NextResponse.json(
        { message: "A Solar GeoTIFF URL is required." },
        { status: 400 }
      );
    }

    const upstreamUrl = new URL(targetUrl);

    if (
      upstreamUrl.hostname !== "solar.googleapis.com" ||
      !upstreamUrl.pathname.startsWith("/v1/geoTiff:get")
    ) {
      return NextResponse.json(
        { message: "Only Google Solar GeoTIFF URLs are allowed." },
        { status: 400 }
      );
    }

    upstreamUrl.searchParams.set("key", GOOGLE_SOLAR_KEY);

    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Accept: "image/tiff,application/octet-stream",
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        {
          message: detail || "Could not load Solar GeoTIFF data.",
        },
        { status: response.status }
      );
    }

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/tiff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unexpected Solar GeoTIFF failure.";

    return NextResponse.json({ message: detail }, { status: 502 });
  }
}
