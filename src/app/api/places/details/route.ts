import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";

const googlePlacesKey =
  process.env.GOOGLE_PLACES_API_KEY;

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:places-details",
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many address lookups. Please pause and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    if (!googlePlacesKey) {
      return NextResponse.json(
        { message: "Google Places API key is not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get("placeId");

    if (!placeId) {
      return NextResponse.json(
        { message: "Missing placeId." },
        { status: 400 }
      );
    }

    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": googlePlacesKey,
          "X-Goog-FieldMask":
            "formattedAddress,location,types,primaryType,businessStatus,addressComponents",
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          message:
            data?.error?.message ??
            "Google Places could not return address details.",
        },
        { status: response.status }
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
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unexpected Places details failure.",
      },
      { status: 500 }
    );
  }
}
