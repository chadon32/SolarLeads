import { NextResponse } from "next/server";
import { buildFallbackRoofAnalysis } from "@/lib/roof-analysis";
import {
  DAY_MS,
  isLikelyBotAddress,
  isRequestTooLarge,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";

type GeocodeResponse = {
  results?: Array<{
    formatted_address: string;
    partial_match?: boolean;
    types?: string[];
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
      location_type?: string;
      viewport?: {
        northeast: {
          lat: number;
          lng: number;
        };
        southwest: {
          lat: number;
          lng: number;
        };
      };
    };
  }>;
  status?: string;
  error_message?: string;
};

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;

export async function POST(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    if (isRequestTooLarge(request, 16 * 1024)) {
      return payloadTooLargeResponse("The satellite preview request is too large.");
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:satellite-preview",
      limit: 10,
      windowMs: 10 * 60_000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many roof scans. Please try again shortly.",
        rateLimit.retryAfterSeconds
      );
    }

    const dailyLimit = await enforceRateLimit({
      request,
      route: "api:satellite-preview:day",
      limit: 30,
      windowMs: DAY_MS,
    });

    if (!dailyLimit.allowed) {
      return rateLimitResponse(
        "Daily roof scan limit reached. Please try again tomorrow.",
        dailyLimit.retryAfterSeconds
      );
    }

    if (!MAPS_KEY) {
      return NextResponse.json(
        { message: "Google Maps API key is not configured." },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { address?: string };
    const address = body.address?.trim();

    if (!address || isLikelyBotAddress(address)) {
      return NextResponse.json(
        { message: "Enter a complete residential street address." },
        { status: 400 }
      );
    }

    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geocodeUrl.searchParams.set("address", address);
    geocodeUrl.searchParams.set("key", MAPS_KEY);

    const response = await fetch(geocodeUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json()) as GeocodeResponse;

    const result = payload.results?.[0];
    const location = result?.geometry?.location;
    const viewport = result?.geometry?.viewport;
    const status = payload.status;
    const resultTypes = result?.types ?? [];
    const locationType = result?.geometry?.location_type;

    if (!response.ok || !result || !location || status !== "OK") {
      if (status === "ZERO_RESULTS") {
        return NextResponse.json(
          { message: "We couldn't find that address." },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          message:
            payload.error_message ||
            "Google Geocoding is unavailable for this project.",
        },
        { status: 502 }
      );
    }

    const disallowedResultTypes = new Set([
      "route",
      "intersection",
      "parking",
      "plus_code",
      "point_of_interest",
      "airport",
      "park",
      "natural_feature",
    ]);

    if (result.partial_match) {
      return NextResponse.json(
        { message: "Please choose a full street address with a visible rooftop." },
        { status: 422 }
      );
    }

    if (
      resultTypes.some((type) => disallowedResultTypes.has(type)) ||
      locationType === "APPROXIMATE"
    ) {
      return NextResponse.json(
        {
          message:
            "This address does not appear to be a precise residential rooftop. Please choose a house address.",
        },
        { status: 422 }
      );
    }

    const analysis = buildFallbackRoofAnalysis({
      address: result.formatted_address,
      lat: location.lat,
      lng: location.lng,
      viewport,
    });

    const imageUrl = `/api/satellite/image?lat=${encodeURIComponent(
      location.lat
    )}&lng=${encodeURIComponent(location.lng)}&zoom=${encodeURIComponent(
      20
    )}&address=${encodeURIComponent(result.formatted_address)}`;

    return NextResponse.json({
      formattedAddress: result.formatted_address,
      lat: location.lat,
      lng: location.lng,
      imageUrl,
      analysis,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unexpected satellite lookup error.",
      },
      { status: 500 }
    );
  }
}
