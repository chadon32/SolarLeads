import { NextResponse } from "next/server";
import {
  buildRoofAnalysis,
  buildRoofAnalysisFromSolarInsights,
  type SolarBuildingInsights,
} from "@/lib/roof-analysis";
import { enforceRateLimit } from "@/lib/rate-limit";

const SOLAR_API_KEY = process.env.GOOGLE_SOLAR_API_KEY;

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:solar",
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many solar lookups. Please try again in a minute." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    if (!SOLAR_API_KEY) {
      return NextResponse.json(
        { message: "Google Solar API key is not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const address = searchParams.get("address")?.trim() ?? "Arizona property";
    const zoom = Number(searchParams.get("zoom") ?? "21");

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { message: "lat and lng are required." },
        { status: 400 }
      );
    }

    const fallback = buildRoofAnalysis({
      address,
      lat,
      lng,
    });

    const solarUrl = new URL(
      "https://solar.googleapis.com/v1/buildingInsights:findClosest"
    );
    solarUrl.searchParams.set("location.latitude", lat.toString());
    solarUrl.searchParams.set("location.longitude", lng.toString());
    solarUrl.searchParams.set("requiredQuality", "HIGH");
    solarUrl.searchParams.set("key", SOLAR_API_KEY);

    const response = await fetch(solarUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as
      | SolarBuildingInsights
      | {
          error?: {
            message?: string;
          };
        };

    if (!response.ok) {
      return NextResponse.json(
        {
          message:
            payload && "error" in payload && payload.error?.message
              ? payload.error.message
              : "Solar data not available for this address.",
          fallback,
        },
        { status: response.status }
      );
    }

    const analysis = buildRoofAnalysisFromSolarInsights({
      insights: payload as SolarBuildingInsights,
      fallback,
      zoom: Number.isFinite(zoom) ? Math.round(zoom) : fallback.zoom,
    });

    if (!analysis) {
      return NextResponse.json(
        {
          message: "Detailed roof data isn't available for this address yet.",
          fallback,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      analysis,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch solar data.",
      },
      { status: 500 }
    );
  }
}
