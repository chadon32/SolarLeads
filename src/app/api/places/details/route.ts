import { NextResponse } from "next/server";
import { maintenanceModeResponse, rateLimitResponse } from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  isArizonaAddressComponents,
  isArizonaCoordinate,
  looksLikeArizonaAddress,
} from "@/lib/arizona-address";
import { z } from "zod";

const googlePlacesKey =
  process.env.GOOGLE_PLACES_API_KEY;
const placeIdSchema = z.string().trim().min(10).max(500).regex(/^[A-Za-z0-9_-]+$/);

export async function GET(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:places-details",
      limit: 40,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many address lookups. Please pause and try again.",
        rateLimit.retryAfterSeconds
      );
    }

    if (!googlePlacesKey) {
      return NextResponse.json(
        { message: "Google Places API key is not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const parsedPlaceId = placeIdSchema.safeParse(searchParams.get("placeId"));

    if (!parsedPlaceId.success) {
      return NextResponse.json(
        { message: "A valid placeId is required." },
        { status: 400 }
      );
    }
    const placeId = parsedPlaceId.data;

    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": googlePlacesKey,
          "X-Goog-FieldMask":
            "formattedAddress,location,types,primaryType,businessStatus,addressComponents",
        },
        signal: AbortSignal.timeout(8_000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.warn("[places-details:provider]", { status: response.status });
      return NextResponse.json(
        { message: "Address details are temporarily unavailable." },
        { status: 502 }
      );
    }

    if (
      !isArizonaCoordinate(data.location?.latitude, data.location?.longitude) ||
      (!isArizonaAddressComponents(data.addressComponents) &&
        !looksLikeArizonaAddress(data.formattedAddress))
    ) {
      return NextResponse.json(
        { message: "Solartelligence currently supports Arizona properties only." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      formattedAddress: data.formattedAddress,
      lat: data.location?.latitude,
      lng: data.location?.longitude,
      types: data.types,
      primaryType: data.primaryType,
      businessStatus: data.businessStatus,
      addressComponents: data.addressComponents,
    });
  } catch (error) {
    console.warn("[places-details:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Address details are temporarily unavailable." },
      { status: 502 }
    );
  }
}
