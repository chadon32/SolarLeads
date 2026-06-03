import { NextResponse } from "next/server";
import {
  geocodeAddress,
  fetchSolarBuildingInsights,
  buildSolarRoofAnalysis,
  validateGeocodedResidentialSite,
} from "@/lib/google-solar";
import {
  DAY_MS,
  disabledFeatureResponse,
  isKillSwitchEnabled,
  isLikelyBotAddress,
  isRequestTooLarge,
  logAbuseSignal,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { normalizeAddress } from "@/lib/lead-normalization";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  getCachedRoofAnalysis,
  getCachedRoofAnalysisByAddress,
  saveCachedRoofAnalysis,
} from "@/lib/roof-analysis-cache";
import { buildFallbackRoofAnalysis, buildInvalidRoofAnalysis } from "@/lib/roof-analysis";

export async function POST(request: Request) {
  let body: {
    address?: string;
    lat?: number;
    lng?: number;
  } = {};

  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    if (isRequestTooLarge(request, 16 * 1024)) {
      logAbuseSignal(request, "roof-analysis-payload-too-large", {
        route: "api:analyze-roof",
      });
      return payloadTooLargeResponse("The roof analysis request is too large.");
    }

    const shortIpLimit = await enforceRateLimit({
      request,
      route: "api:analyze-roof",
      limit: 5,
      windowMs: 10 * 60_000,
    });

    if (!shortIpLimit.allowed) {
      logAbuseSignal(request, "roof-analysis-rate-limited", {
        route: "api:analyze-roof",
        window: "10m",
      });
      return rateLimitResponse(
        "Too many roof analysis requests. Please try again shortly.",
        shortIpLimit.retryAfterSeconds
      );
    }

    const dailyIpLimit = await enforceRateLimit({
      request,
      route: "api:analyze-roof:day",
      limit: 20,
      windowMs: DAY_MS,
    });

    if (!dailyIpLimit.allowed) {
      logAbuseSignal(request, "roof-analysis-rate-limited", {
        route: "api:analyze-roof",
        window: "day",
      });
      return rateLimitResponse(
        "Daily roof analysis limit reached. Please try again tomorrow.",
        dailyIpLimit.retryAfterSeconds
      );
    }

    body = (await request.json().catch(() => ({}))) as typeof body;

    const inputAddress = body.address?.trim();
    if (!inputAddress || isLikelyBotAddress(inputAddress)) {
      return NextResponse.json(
        { message: "Enter a complete residential street address." },
        { status: 400 }
      );
    }

    const normalizedAddress = normalizeAddress(inputAddress);

    if (normalizedAddress) {
      const addressLimit = await enforceRateLimit({
        key: `address:${normalizedAddress}`,
        request,
        route: "api:analyze-roof:address",
        limit: 8,
        windowMs: DAY_MS,
      });

      if (!addressLimit.allowed) {
        logAbuseSignal(request, "roof-analysis-address-rate-limited", {
          normalizedAddress,
          route: "api:analyze-roof",
        });
        return rateLimitResponse(
          "Too many roof analysis requests for this address today.",
          addressLimit.retryAfterSeconds
        );
      }
    }

    const addressCached = await getCachedRoofAnalysisByAddress(inputAddress);

    if (addressCached) {
      logAbuseSignal(request, "roof-analysis-cache-hit", {
        normalizedAddress,
        paidApiCalled: false,
        route: "api:analyze-roof",
      });

      if (addressCached.validSite && addressCached.rooftopDetected) {
        return NextResponse.json({ analysis: addressCached, cache: "hit" });
      }

      return NextResponse.json(
        {
          analysis: addressCached,
          cache: "hit",
          message:
            addressCached.invalidReason ??
            "A usable residential rooftop could not be confirmed for this address.",
        },
        { status: 422 }
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
      logAbuseSignal(request, "roof-analysis-cache-hit", {
        normalizedAddress,
        paidApiCalled: false,
        route: "api:analyze-roof",
      });

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

    if (isKillSwitchEnabled("DISABLE_SOLAR_API_CALLS")) {
      logAbuseSignal(request, "roof-analysis-disabled", {
        normalizedAddress,
        paidApiCalled: false,
        route: "api:analyze-roof",
      });
      return disabledFeatureResponse(
        "Roof analysis is temporarily unavailable. Please try again shortly."
      );
    }

    logAbuseSignal(request, "roof-analysis-cache-miss", {
      normalizedAddress,
      paidApiCalled: true,
      route: "api:analyze-roof",
    });

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
