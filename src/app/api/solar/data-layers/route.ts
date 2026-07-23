import { NextResponse } from "next/server";
import {
  DAY_MS,
  disabledFeatureResponse,
  isKillSwitchEnabled,
  logAbuseSignal,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fetchSolarDataLayers } from "@/lib/google-solar";
import { isArizonaCoordinate } from "@/lib/arizona-address";

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:solar-data-layers",
      limit: 10,
      windowMs: 10 * 60_000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many irradiance requests. Please try again shortly.",
        rateLimit.retryAfterSeconds
      );
    }

    const dailyLimit = await enforceRateLimit({
      request,
      route: "api:solar-data-layers:day",
      limit: 30,
      windowMs: DAY_MS,
    });

    if (!dailyLimit.allowed) {
      return rateLimitResponse(
        "Daily irradiance request limit reached. Please try again tomorrow.",
        dailyLimit.retryAfterSeconds
      );
    }

    if (isKillSwitchEnabled("DISABLE_SOLAR_API_CALLS")) {
      logAbuseSignal(request, "solar-data-layers-disabled", {
        route: "api:solar-data-layers",
      });
      return disabledFeatureResponse(
        "Solar data layers are temporarily unavailable."
      );
    }

    const { searchParams } = new URL(request.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!isArizonaCoordinate(lat, lng)) {
      return NextResponse.json(
        { message: "Valid Arizona coordinates are required." },
        { status: 400 }
      );
    }

    const dataLayers = await fetchSolarDataLayers(lat, lng);
    const proxyUrl = (sourceUrl?: string) =>
      sourceUrl
        ? `/api/solar/geotiff?url=${encodeURIComponent(sourceUrl)}`
        : null;

    return NextResponse.json({
      annualFluxUrl: proxyUrl(dataLayers.annualFluxUrl),
      dsmUrl: proxyUrl(dataLayers.dsmUrl),
      maskUrl: proxyUrl(dataLayers.maskUrl),
      rgbUrl: proxyUrl(dataLayers.rgbUrl),
      imageryQuality: dataLayers.imageryQuality ?? null,
      imageryDate: dataLayers.imageryDate ?? null,
      imageryProcessedDate: dataLayers.imageryProcessedDate ?? null,
    });
  } catch (error) {
    console.warn("[solar-data-layers:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Solar imagery layers are temporarily unavailable." },
      { status: 502 }
    );
  }
}
