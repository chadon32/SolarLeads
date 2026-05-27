import { NextResponse } from "next/server";
import { buildRoofAnalysis } from "@/lib/roof-analysis";
import { enforceRateLimit } from "@/lib/rate-limit";

type GeocodeResponse = {
  results?: Array<{
    formatted_address: string;
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
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
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:satellite-preview",
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many roof scans. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
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

    if (!address || address.length < 5) {
      return NextResponse.json(
        { message: "Enter a valid address." },
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

    const analysis = buildRoofAnalysis({
      address: result.formatted_address,
      lat: location.lat,
      lng: location.lng,
      viewport,
    });

    const imageUrl = `/api/satellite/image?lat=${encodeURIComponent(
      location.lat
    )}&lng=${encodeURIComponent(location.lng)}&zoom=${encodeURIComponent(
      analysis.zoom
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
