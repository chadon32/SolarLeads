import { NextResponse } from "next/server";
import {
  geocodeAddress,
  fetchSolarBuildingInsights,
  buildSolarRoofAnalysis,
  validateGeocodedResidentialSite,
} from "@/lib/google-solar";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getCachedRoofAnalysis, saveCachedRoofAnalysis } from "@/lib/roof-analysis-cache";
import { buildFallbackRoofAnalysis, buildInvalidRoofAnalysis } from "@/lib/roof-analysis";

export async function POST(request: Request) {
  let body: {
    address?: string;
    lat?: number;
    lng?: number;
  } = {};

  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:analyze-roof",
      limit: 12,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many roof analysis requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    body = (await request.json().catch(() => ({}))) as typeof body;

    const inputAddress = body.address?.trim();
    if (!inputAddress) {
      return NextResponse.json(
        { message: "An address is required to analyze a roof." },
        { status: 400 }
      );
    }

    const geocoded = await geocodeAddress(inputAddress);
    const geocodeValidation = validateGeocodedResidentialSite(geocoded);

    if (geocodeValidation) {
      const invalidAnalysis = buildInvalidRoofAnalysis({
        propertyType: "unknown",
        invalidReason: geocodeValidation,
        confidenceNote: geocodeValidation,
      });

      return NextResponse.json(
        {
          analysis: invalidAnalysis,
          message: geocodeValidation,
        },
        { status: 422 }
      );
    }

    const fallback = buildFallbackRoofAnalysis({
      address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      viewport: geocoded.viewport,
    });

    const cached = await getCachedRoofAnalysis({
      address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      fallback,
    });

    if (cached) {
      if (cached.validSite && cached.rooftopDetected) {
        return NextResponse.json({ analysis: cached, cache: "hit" });
      }

      return NextResponse.json(
        {
          analysis: cached,
          message:
            cached.invalidReason ??
            "A usable residential rooftop could not be confirmed for this address.",
          cache: "hit",
        },
        { status: 422 }
      );
    }

    const insights = await fetchSolarBuildingInsights(geocoded.lat, geocoded.lng);
    const analysis = buildSolarRoofAnalysis({
      address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      insights,
    });

    if (!analysis.validSite || !analysis.rooftopDetected) {
      const invalidAnalysis = buildInvalidRoofAnalysis({
        propertyType: analysis.propertyType,
        invalidReason:
          analysis.invalidReason ??
          "A usable residential rooftop could not be confirmed for this address.",
        confidenceNote: analysis.confidenceNote,
      });

      await saveCachedRoofAnalysis({
        address: geocoded.formattedAddress,
        lat: geocoded.lat,
        lng: geocoded.lng,
        analysis: invalidAnalysis,
      });

      return NextResponse.json(
        {
          analysis: invalidAnalysis,
          message:
            analysis.invalidReason ??
            "A usable residential rooftop could not be confirmed for this address.",
        },
        { status: 422 }
      );
    }

    await saveCachedRoofAnalysis({
      address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      analysis,
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unexpected roof analysis failure.";

    const invalidAnalysis = buildInvalidRoofAnalysis({
      propertyType: "unknown",
      invalidReason: detail,
      confidenceNote: detail,
    });

    return NextResponse.json(
      {
        message: detail,
        analysis: invalidAnalysis,
        detail,
      },
      { status: 500 }
    );
  }
}
