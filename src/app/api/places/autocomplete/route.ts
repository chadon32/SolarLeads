import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";

type PlaceSuggestion = {
  placePrediction?: {
    placeId?: string;
    text?: {
      text?: string;
    };
    structuredFormat?: {
      mainText?: {
        text?: string;
      };
      secondaryText?: {
        text?: string;
      };
    };
  };
};

const googlePlacesKey =
  process.env.GOOGLE_PLACES_API_KEY;

export async function POST(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:places-autocomplete",
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

    const body = (await request.json()) as { input?: string };
    const input = body.input?.trim();

    if (!input) {
      return NextResponse.json({ predictions: [] });
    }

    const response = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googlePlacesKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
        },
        body: JSON.stringify({
          input,
          includedRegionCodes: ["us"],
          includedPrimaryTypes: ["street_address", "premise"],
        }),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          message:
            data?.error?.message ??
            "Google Places could not return address suggestions.",
        },
        { status: response.status }
      );
    }

    const predictions = ((data.suggestions ?? []) as PlaceSuggestion[])
      .map((suggestion) => suggestion.placePrediction)
      .filter((prediction) => prediction?.placeId && prediction?.text?.text)
      .slice(0, 5)
      .map((prediction) => ({
        description: prediction?.text?.text ?? "",
        place_id: prediction?.placeId ?? "",
        structured_formatting: {
          main_text:
            prediction?.structuredFormat?.mainText?.text ??
            prediction?.text?.text ??
            "",
          secondary_text:
            prediction?.structuredFormat?.secondaryText?.text ?? "",
        },
      }));

    return NextResponse.json({ predictions });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unexpected Places autocomplete failure.",
      },
      { status: 500 }
    );
  }
}
