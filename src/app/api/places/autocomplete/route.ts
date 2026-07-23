import { NextResponse } from "next/server";
import {
  isRequestTooLarge,
  logAbuseSignal,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

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
const autocompleteSchema = z.object({
  input: z.string().trim().min(3).max(220),
});

export async function POST(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    if (isRequestTooLarge(request, 8 * 1024)) {
      logAbuseSignal(request, "places-autocomplete-payload-too-large", {
        route: "api:places-autocomplete",
      });
      return payloadTooLargeResponse("The address lookup request is too large.");
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:places-autocomplete",
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

    const jsonBody = await readJsonWithLimit(request, 8 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The address lookup request is too large.");
    }

    const parsed = autocompleteSchema.safeParse(jsonBody.ok ? jsonBody.data : null);

    if (!parsed.success) {
      return NextResponse.json({ predictions: [] });
    }

    const input = parsed.data.input;

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
        signal: AbortSignal.timeout(8_000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.warn("[places-autocomplete:provider]", { status: response.status });
      return NextResponse.json(
        { message: "Address suggestions are temporarily unavailable." },
        { status: 502 }
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
    console.warn("[places-autocomplete:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Address suggestions are temporarily unavailable." },
      { status: 502 }
    );
  }
}
