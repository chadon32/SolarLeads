import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  buildInvalidRoofAnalysis,
  buildFallbackRoofAnalysis,
  normalizeRoofAnalysis,
} from "@/lib/roof-analysis";
import { enforceRateLimit } from "@/lib/rate-limit";

const anthropicKey = process.env.ANTHROPIC_API_KEY;

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

    const body = (await request.json().catch(() => ({}))) as {
      base64?: string;
      mimeType?: string;
      address?: string;
      lat?: number;
      lng?: number;
    };

    const address = body.address?.trim() || "Arizona residential property";
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const mediaType = normalizeMediaType(body.mimeType);
    const fallback = buildFallbackRoofAnalysis({
      address,
      lat: Number.isFinite(lat) ? lat : 33.4942,
      lng: Number.isFinite(lng) ? lng : -111.9261,
    });

    if (!body.base64 || !mediaType) {
      return NextResponse.json(
        { message: "base64 image and mimeType are required.", fallback },
        { status: 400 }
      );
    }

    if (!anthropicKey) {
      const unavailableAnalysis = buildInvalidRoofAnalysis({
        propertyType: "unknown",
        invalidReason:
          "Roof analysis is temporarily unavailable because the image-analysis service is not configured.",
        confidenceNote:
          "Image analysis could not run, so the rooftop could not be validated.",
      });

      return NextResponse.json(
        {
          message:
            "Roof analysis is temporarily unavailable because the image-analysis service is not configured.",
          analysis: unavailableAnalysis,
        },
        { status: 503 }
      );
    }

    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: body.base64,
              },
            },
            {
              type: "text",
              text: analysisPrompt(address),
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
    const parsed = extractJsonObject(textContent);
    const analysis = normalizeRoofAnalysis(parsed, fallback);

    if (!analysis.validSite || !analysis.rooftopDetected) {
      return NextResponse.json(
        {
          analysis: buildInvalidRoofAnalysis({
            propertyType: analysis.propertyType,
            invalidReason:
              analysis.invalidReason ??
              "A usable residential rooftop could not be confirmed for this address.",
            confidenceNote: analysis.confidenceNote,
          }),
          message:
            analysis.invalidReason ??
            "A usable residential rooftop could not be confirmed for this address.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unexpected roof analysis failure.";

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
