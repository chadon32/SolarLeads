import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { analyzeRoofDeterministically } from "@/lib/deterministic-roof-analysis";
import {
  getCachedRoofAnalysis,
  saveCachedRoofAnalysis,
} from "@/lib/roof-analysis-cache";
import {
  buildInvalidRoofAnalysis,
  buildFallbackRoofAnalysis,
  normalizeRoofAnalysis,
} from "@/lib/roof-analysis";
import { enforceRateLimit } from "@/lib/rate-limit";

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const claudeFallbackEnabled = process.env.ENABLE_CLAUDE_ROOF_ANALYSIS === "true";
const configuredModel = process.env.ANTHROPIC_MODEL?.trim();
const modelCandidates = [
  configuredModel,
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

const analysisPrompt = (address: string) => `You are a solar rooftop analysis AI. You are looking at a satellite image of a property at: ${address}

Analyze the roof visible in this overhead satellite image and return ONLY a valid JSON object with no extra text, markdown, or explanation.

Return this exact structure:
{
  "propertyType": "residential" | "commercial" | "parking" | "road" | "vacant_lot" | "unknown",
  "rooftopDetected": <boolean>,
  "validSite": <boolean>,
  "invalidReason": <string or null>,
  "roofShape": "gable" | "hip" | "flat" | "shed" | "complex",
  "widthM": <estimated roof width in meters, number>,
  "depthM": <estimated roof depth in meters, number>,
  "pitchDeg": <estimated roof pitch in degrees, number, 0-45>,
  "usablePctRoof": <percentage of roof usable for panels, 0-100, number>,
  "primaryRoofAzimuth": <compass direction primary roof faces, e.g. 180 for south, number>,
  "panelCount": <estimated number of 400W panels that fit, integer>,
  "systemKw": <system size in kW, number, 1 decimal place>,
  "annualKwh": <estimated annual energy production in kWh for Arizona, integer>,
  "annualSavingsUSD": <estimated annual savings at $0.13/kWh AZ rate, integer>,
  "shadingRisk": "low" | "medium" | "high",
  "shadeNote": "<one sentence about trees or obstructions if any, or 'No significant shading detected'>",
  "roofOutline": [
    { "x": <0-100>, "y": <0-100> }
  ],
  "usableOutline": [
    { "x": <0-100>, "y": <0-100> }
  ],
  "obstructionOutlines": [
    [
      { "x": <0-100>, "y": <0-100> }
    ]
  ],
  "roofSegments": [
    {
      "label": "primary" | "secondary" | "garage",
      "pitchDeg": <number>,
      "azimuthDeg": <number>,
      "areaM2": <number>,
      "panelsFit": <integer>,
      "usable": true | false,
      "outline": [
        { "x": <0-100>, "y": <0-100> }
      ]
    }
  ],
  "confidence": "high" | "medium" | "low",
  "confidenceNote": "<one sentence about image quality or data limitations>"
}

Rules:
- Arizona gets about 5.5 peak sun hours per day
- Assume 400W panels and a 0.85 efficiency factor
- First decide whether this is a valid residential rooftop.
- Reject roads, parking lots, empty lots, commercial buildings, large apartment blocks, and images where a usable roof cannot be confidently identified.
- If the site is invalid, set:
  - "propertyType" appropriately
  - "rooftopDetected" to false if no clear roof exists
  - "validSite" to false
  - "invalidReason" to a short plain-English explanation
  - panel and savings numbers to 0
  - roofOutline, usableOutline, obstructionOutlines, and roofSegments to empty arrays
- If the site is valid, set "propertyType" to "residential", "rooftopDetected" to true, and "validSite" to true.
- Use normalized 0-100 coordinates for outlines, where x/y are percentages of the image.
- Match panel zones and roof segment outlines to the visible roof geometry as closely as possible.
- Return ONLY the JSON. No markdown. No explanation.`;

export async function POST(request: Request) {
  let body: {
    base64?: string;
    mimeType?: string;
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

    const address = body.address?.trim() || "Arizona residential property";
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const mediaType = normalizeMediaType(body.mimeType);
    const fallback = buildFallbackRoofAnalysis({
      address,
      lat: Number.isFinite(lat) ? lat : 33.4942,
      lng: Number.isFinite(lng) ? lng : -111.9261,
    });
    const cacheLat = Number.isFinite(lat) ? lat : 33.4942;
    const cacheLng = Number.isFinite(lng) ? lng : -111.9261;

    if (!body.base64 || !mediaType) {
      return NextResponse.json(
        { message: "base64 image and mimeType are required.", fallback },
        { status: 400 }
      );
    }

    const cached = await getCachedRoofAnalysis({
      address,
      lat: cacheLat,
      lng: cacheLng,
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

    const deterministicAnalysis = analyzeRoofDeterministically({
      address,
      lat: cacheLat,
      lng: cacheLng,
      base64: body.base64,
      mimeType: mediaType,
    });

    if (
      deterministicAnalysis.validSite &&
      deterministicAnalysis.rooftopDetected
    ) {
      await saveCachedRoofAnalysis({
        address,
        lat: cacheLat,
        lng: cacheLng,
        analysis: deterministicAnalysis,
      });
      return NextResponse.json({ analysis: deterministicAnalysis });
    }

    if (!claudeFallbackEnabled || !anthropicKey) {
      await saveCachedRoofAnalysis({
        address,
        lat: cacheLat,
        lng: cacheLng,
        analysis: deterministicAnalysis,
      });
      return NextResponse.json(
        {
          analysis: deterministicAnalysis,
          message:
            deterministicAnalysis.invalidReason ??
            "A usable residential rooftop could not be confirmed for this address.",
        },
        { status: 422 }
      );
    }

    const client = new Anthropic({ apiKey: anthropicKey });
    const parsed = await createParsedRoofAnalysis(client, {
      mediaType,
      base64: body.base64,
      address,
    });
    const analysis = normalizeRoofAnalysis(parsed, fallback);

    if (!analysis.validSite || !analysis.rooftopDetected) {
      const invalidAnalysis = buildInvalidRoofAnalysis({
        propertyType: analysis.propertyType,
        invalidReason:
          analysis.invalidReason ??
          "A usable residential rooftop could not be confirmed for this address.",
        confidenceNote: analysis.confidenceNote,
      });
      await saveCachedRoofAnalysis({
        address,
        lat: cacheLat,
        lng: cacheLng,
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
      address,
      lat: cacheLat,
      lng: cacheLng,
      analysis,
    });
    return NextResponse.json({ analysis });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unexpected roof analysis failure.";

    const fallback = buildFallbackRoofAnalysis({
      address: body.address?.trim() || "Arizona residential property",
      lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : 33.4942,
      lng: Number.isFinite(Number(body.lng)) ? Number(body.lng) : -111.9261,
    });

    if (isRecoverableAnalysisError(detail)) {
      await saveCachedRoofAnalysis({
        address: body.address?.trim() || "Arizona residential property",
        lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : 33.4942,
        lng: Number.isFinite(Number(body.lng)) ? Number(body.lng) : -111.9261,
        analysis: fallback,
      });
      return NextResponse.json(
        {
          analysis: fallback,
          message:
            "Detailed roof segmentation was unavailable, so the system is using the deterministic rooftop estimate for this address.",
          detail,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        message: "Roof analysis failed before a rooftop could be validated.",
        analysis: buildInvalidRoofAnalysis({
          propertyType: "unknown",
          invalidReason: "Roof analysis failed before a usable rooftop could be confirmed.",
          confidenceNote: detail,
        }),
        detail,
      },
      { status: 500 }
    );
  }
}

function isRecoverableAnalysisError(detail: string) {
  return (
    detail.includes("Could not process image") ||
    detail.includes("Expected ',' or ']' after array element") ||
    detail.includes("Claude did not return a valid JSON object.") ||
    detail.includes("Unexpected token") ||
    detail.includes("JSON")
  );
}

async function createParsedRoofAnalysis(
  client: Anthropic,
  params: {
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    base64: string;
    address: string;
  }
) {
  let lastError: unknown;

  for (const model of modelCandidates) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: params.mediaType,
                  data: params.base64,
                },
              },
              {
                type: "text",
                text: analysisPrompt(params.address),
              },
            ],
          },
        ],
      });

      const textContent = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return extractJsonObject(textContent);
    } catch (error) {
      lastError = error;

      if (isMissingModelError(error) || isRecoverableAnalysisError(getErrorMessage(error))) {
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No compatible Anthropic model was available for roof analysis.");
}

function isMissingModelError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("not_found_error") &&
    error.message.includes("model:")
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function extractJsonObject(text: string) {
  const withoutFences = text.replace(/```json|```/gi, "").trim();
  const firstBrace = withoutFences.indexOf("{");
  const lastBrace = withoutFences.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Claude did not return a valid JSON object.");
  }

  return JSON.parse(withoutFences.slice(firstBrace, lastBrace + 1));
}

function normalizeMediaType(value: unknown) {
  return value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/webp" ||
    value === "image/gif"
    ? value
    : null;
}
