import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DAY_MS,
  isLikelyBotAddress,
  isRequestTooLarge,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import {
  geocodeAddress,
  validateGeocodedResidentialSite,
} from "@/lib/google-solar";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildFallbackRoofAnalysis } from "@/lib/roof-analysis";

const previewSchema = z.object({
  address: z.string().trim().min(8).max(220),
});

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

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The satellite preview request is too large.");
    }

    const parsed = previewSchema.safeParse(jsonBody.ok ? jsonBody.data : null);

    if (!parsed.success || isLikelyBotAddress(parsed.data.address)) {
      return NextResponse.json(
        { message: "Enter a complete residential street address." },
        { status: 400 }
      );
    }

    const geocoded = await geocodeAddress(parsed.data.address);
    const validationMessage = validateGeocodedResidentialSite(geocoded);

    if (validationMessage) {
      return NextResponse.json(
        { message: validationMessage },
        { status: 422 }
      );
    }

    const analysis = buildFallbackRoofAnalysis({
      address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      viewport: geocoded.viewport,
    });

    return NextResponse.json({
      formattedAddress: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      imageUrl: `/api/satellite/image?lat=${encodeURIComponent(
        geocoded.lat
      )}&lng=${encodeURIComponent(geocoded.lng)}&zoom=20`,
      analysis,
    });
  } catch (error) {
    console.warn("[satellite-preview:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        message:
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
            ? "Address lookup took too long. Please try again."
            : "Address lookup is temporarily unavailable.",
      },
      { status: 502 }
    );
  }
}
