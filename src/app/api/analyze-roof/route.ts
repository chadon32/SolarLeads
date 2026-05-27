import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  buildFallbackRoofAnalysis,
  normalizeRoofAnalysis,
} from "@/lib/roof-analysis";
import { enforceRateLimit } from "@/lib/rate-limit";

const anthropicKey = process.env.ANTHROPIC_API_KEY;

const analysisPrompt = (address: string) => `You are a solar rooftop analysis AI. You are looking at a satellite image of a residential property at: ${address}

Analyze the roof visible in this overhead satellite image and return ONLY a valid JSON object with no extra text, markdown, or explanation.

Return this exact structure:
{
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
  "roofSegments": [
    {
      "label": "primary" | "secondary" | "garage",
      "pitchDeg": <number>,
      "azimuthDeg": <number>,
      "areaM2": <number>,
      "panelsFit": <integer>,
      "usable": true | false
    }
  ],
  "confidence": "high" | "medium" | "low",
  "confidenceNote": "<one sentence about image quality or data limitations>"
}

Rules:
- Arizona gets about 5.5 peak sun hours per day
- Assume 400W panels and a 0.85 efficiency factor
- If the roof is not clearly visible or this is not a residential building, set confidence to "low" and use conservative estimates
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
      return NextResponse.json(
        {
          message:
            "ANTHROPIC_API_KEY is not configured. Showing a modeled Arizona estimate instead.",
          fallback,
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

    return NextResponse.json({ analysis });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unexpected roof analysis failure.";

    return NextResponse.json(
      {
        message: "Roof analysis failed. Showing a modeled Arizona estimate instead.",
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
