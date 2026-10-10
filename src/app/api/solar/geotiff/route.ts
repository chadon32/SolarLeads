import { NextResponse } from "next/server";
import {
  DAY_MS,
  disabledFeatureResponse,
  isKillSwitchEnabled,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSolarImageryLimits } from "@/lib/solar-imagery-limits";

const GOOGLE_SOLAR_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY;

export async function GET(request: Request) {
  try {
    const limits = getSolarImageryLimits(request);
    const rateLimit = await enforceRateLimit({
      request,
      key: limits.key,
      route: "api:solar-geotiff",
      limit: limits.hourly,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many Solar GeoTIFF requests. Please try again shortly.",
        rateLimit.retryAfterSeconds
      );
    }

    const dailyLimit = await enforceRateLimit({
      request,
      key: limits.key,
      route: "api:solar-geotiff:day",
      limit: limits.daily,
      windowMs: DAY_MS,
    });

    if (!dailyLimit.allowed) {
      return rateLimitResponse(
        "Daily roof imagery request limit reached. Please try again tomorrow.",
        dailyLimit.retryAfterSeconds
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
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: "Could not load Solar GeoTIFF data." },
        { status: 502 }
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
    console.warn("[solar-geotiff:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Could not load Solar GeoTIFF data." },
      { status: 502 }
    );
  }
}
