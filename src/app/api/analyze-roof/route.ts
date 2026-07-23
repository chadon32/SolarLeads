import { NextResponse } from "next/server";
import {
  geocodeAddress,
  fetchSolarBuildingInsights,
  buildSolarRoofAnalysis,
  validateGeocodedResidentialSite,
} from "@/lib/google-solar";
import {
  findDetachedSegments,
  findObstructedPanels,
  findOffPlanePanels,
} from "@/lib/building-filter";
import { fetchDsmSamplers } from "@/lib/dsm-fetch";
import {
  DAY_MS,
  disabledFeatureResponse,
  isKillSwitchEnabled,
  isLikelyBotAddress,
  isRequestTooLarge,
  logAbuseSignal,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  readJsonWithLimit,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { normalizeAddress } from "@/lib/lead-normalization";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  getCachedRoofAnalysis,
  getCachedRoofAnalysisByAddress,
  saveCachedRoofAnalysis,
} from "@/lib/roof-analysis-cache";
import {
  buildFallbackRoofAnalysis,
  buildInvalidRoofAnalysis,
  type RoofAnalysis,
} from "@/lib/roof-analysis";
import { buildRoofAnalysisProof } from "@/lib/roof-analysis-proof";
import { z } from "zod";

const analyzeRoofSchema = z.object({
  address: z.string().trim().min(8).max(220),
});

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

    const jsonBody = await readJsonWithLimit(request, 16 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      return payloadTooLargeResponse("The roof analysis request is too large.");
    }

    const parsedBody = analyzeRoofSchema.safeParse(
      jsonBody.ok ? jsonBody.data : null
    );

    if (!parsedBody.success || isLikelyBotAddress(parsedBody.data.address)) {
      return NextResponse.json(
        { message: "Enter a complete residential street address." },
        { status: 400 }
      );
    }
    body = parsedBody.data;
    const inputAddress = parsedBody.data.address;
    const normalizedAddress = normalizeAddress(inputAddress);

    // Serve warm cache before rate limits so refreshes and retries never look
    // like "no roof" after a few analyses. Paid Solar API calls are limited below.
    const addressCached = await getCachedRoofAnalysisByAddress(inputAddress);

    if (addressCached) {
      logAbuseSignal(request, "roof-analysis-cache-hit", {
        normalizedAddress,
        paidApiCalled: false,
        route: "api:analyze-roof",
      });

      if (addressCached.validSite && addressCached.rooftopDetected) {
        return roofAnalysisResponse(inputAddress, {
          analysis: addressCached,
          cache: "hit",
        });
      }

      return roofAnalysisResponse(
        inputAddress,
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

    // Rate-limit only the paid path (geocode + Solar API), not cache hits.
    const shortIpLimit = await enforceRateLimit({
      request,
      route: "api:analyze-roof",
      limit: 8,
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
      limit: 30,
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

    if (normalizedAddress) {
      const addressLimit = await enforceRateLimit({
        key: `address:${normalizedAddress}`,
        request,
        route: "api:analyze-roof:address",
        limit: 12,
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

    const geocoded = await geocodeAddress(inputAddress);
    const geocodeValidation = validateGeocodedResidentialSite(geocoded);

    if (geocodeValidation) {
      const invalidAnalysis = buildInvalidRoofAnalysis({
        propertyType: "unknown",
        invalidReason: geocodeValidation,
        confidenceNote: geocodeValidation,
      });

      return roofAnalysisResponse(
        inputAddress,
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
        return roofAnalysisResponse(inputAddress, {
          analysis: cached,
          cache: "hit",
        });
      }

      return roofAnalysisResponse(
        inputAddress,
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

    const [insights, dsm] = await Promise.all([
      fetchSolarBuildingInsights(geocoded.lat, geocoded.lng),
      // Best-effort: terrain evidence for filtering neighbor roofs and
      // panels over roof edges or raised equipment.
      fetchDsmSamplers(geocoded.lat, geocoded.lng).catch(() => null),
    ]);

    let detachedSegmentIndices: Set<number> | undefined;
    let excludedPanelIndices: Set<number> | undefined;

    if (dsm) {
      const segments = insights.solarPotential?.roofSegmentStats ?? [];
      const rawPanels = insights.solarPotential?.solarPanels ?? [];
      const points = rawPanels.flatMap((panel, panelIndex) => {
        const lat = Number(panel.center?.latitude);
        const lng = Number(panel.center?.longitude);
        const segmentIndex = Number(panel.segmentIndex ?? -1);
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          segmentIndex < 0
        ) {
          return [];
        }
        const segment = segments[segmentIndex];
        return [
          {
            panelIndex,
            segmentIndex,
            lat,
            lng,
            azimuthDeg: Number(segment?.azimuthDegrees ?? 180),
            pitchDeg: Number(segment?.pitchDegrees ?? 0),
          },
        ];
      });
      // Per-panel exclusions: modules hanging past the roof edge, and
      // modules sitting over raised rooftop equipment (AC units, vents).
      const offPlane = findOffPlanePanels({
        points,
        targetLat: geocoded.lat,
        targetLng: geocoded.lng,
        sampleRelativeHeightMeters: dsm.heightAt,
      });
      const obstructed = findObstructedPanels({
        points,
        targetLat: geocoded.lat,
        targetLng: geocoded.lng,
        sampleRelativeHeightMeters: dsm.heightAt,
        sampleFootprintPeakMeters: dsm.footprintPeakAt,
      });
      excludedPanelIndices = new Set([...offPlane, ...obstructed]);
      // Neighbor clustering uses the full on-roof layout: only overhang
      // panels (off no plane) are removed here. Equipment-covered panels
      // stay — they are still part of this building's footprint, and
      // removing them first breaks the cluster geometry.
      detachedSegmentIndices = findDetachedSegments({
        points: points.filter((point) => !offPlane.has(point.panelIndex)),
        targetLat: geocoded.lat,
        targetLng: geocoded.lng,
        sampleRelativeHeightMeters: dsm.heightAt,
      });
    }

    const analysis = buildSolarRoofAnalysis({
      address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      insights,
      detachedSegmentIndices,
      excludedPanelIndices,
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

      return roofAnalysisResponse(
        inputAddress,
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

    return roofAnalysisResponse(inputAddress, { analysis });
  } catch (error) {
    console.error("[roof-analysis:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    const message = isTimeoutError(error)
      ? "Roof data took too long to respond. Please try again."
      : "Roof data is temporarily unavailable. Please try again shortly.";

    const invalidAnalysis = buildInvalidRoofAnalysis({
      propertyType: "unknown",
      invalidReason: message,
      confidenceNote: "The roof data provider did not complete this analysis.",
    });

    return roofAnalysisResponse(
      body.address ?? "unknown",
      {
        message,
        analysis: invalidAnalysis,
      },
      { status: 502 }
    );
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function roofAnalysisResponse(
  address: string,
  payload: {
    analysis: RoofAnalysis;
    cache?: "hit";
    detail?: string;
    message?: string;
  },
  init?: ResponseInit
) {
  return NextResponse.json(
    {
      ...payload,
      analysisProof: buildRoofAnalysisProof({
        address,
        analysis: payload.analysis,
      }),
    },
    init
  );
}
