import { NextResponse } from "next/server";
import { DAY_MS, maintenanceModeResponse, rateLimitResponse } from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isArizonaCoordinate } from "@/lib/arizona-address";

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;

export async function GET(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:satellite-image",
      limit: 20,
      windowMs: 10 * 60_000,
    });

    if (!rateLimit.allowed) {
      return rateLimitResponse(
        "Too many satellite image requests. Please try again soon.",
        rateLimit.retryAfterSeconds
      );
    }

    const dailyLimit = await enforceRateLimit({
      request,
      route: "api:satellite-image:day",
      limit: 80,
      windowMs: DAY_MS,
    });

    if (!dailyLimit.allowed) {
      return rateLimitResponse(
        "Daily satellite image limit reached. Please try again tomorrow.",
        dailyLimit.retryAfterSeconds
      );
    }

    if (!MAPS_KEY) {
      return NextResponse.json(
        { message: "Google Maps API key is not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const zoomParam = searchParams.get("zoom");
    const address = searchParams.get("address") ?? "Satellite preview";

    if (!isArizonaCoordinate(lat, lng)) {
      return NextResponse.json(
        { message: "Valid Arizona coordinates are required." },
        { status: 400 }
      );
    }

    const parsedZoom = Number(zoomParam ?? "20");
    const zoom = Number.isFinite(parsedZoom)
      ? Math.max(18, Math.min(21, Math.round(parsedZoom)))
      : 20;

    const staticMapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    staticMapUrl.searchParams.set("center", `${lat},${lng}`);
    staticMapUrl.searchParams.set("zoom", String(zoom));
    staticMapUrl.searchParams.set("size", "640x640");
    staticMapUrl.searchParams.set("scale", "2");
    staticMapUrl.searchParams.set("maptype", "satellite");
    staticMapUrl.searchParams.set("format", "png");
    staticMapUrl.searchParams.set("key", MAPS_KEY);

    const response = await fetch(staticMapUrl, {
      headers: {
        Accept: "image/png,image/*;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok || !response.body) {
      return satelliteFallbackResponse(
        address,
        "High-resolution satellite imagery unavailable"
      );
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Content-Disposition": `inline; filename="satellite-${address
          .slice(0, 32)
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "") || "preview"}.png"`,
      },
    });
  } catch {
    return satelliteFallbackResponse(
      "Satellite preview",
      "Rooftop satellite imagery is temporarily unavailable."
    );
  }
}

function satelliteFallbackResponse(address: string, message: string) {
  const safeAddress = escapeXml(address || "Satellite preview");
  const safeMessage = escapeXml(message);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700" role="img" aria-label="Satellite preview placeholder">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#07111d" />
        <stop offset="100%" stop-color="#0b2236" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="35%" r="70%">
        <stop offset="0%" stop-color="#67e8f9" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#67e8f9" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="1200" height="700" fill="url(#bg)" />
    <rect width="1200" height="700" fill="url(#glow)" />
    <g opacity="0.28" stroke="#7dd3fc" stroke-width="1">
      <path d="M70 610 C210 520, 380 472, 560 410 C710 358, 930 332, 1130 250" fill="none" />
      <path d="M70 560 C220 498, 370 452, 550 382 C720 324, 920 298, 1130 214" fill="none" />
    </g>
    <g opacity="0.18" stroke="#7dd3fc" stroke-width="1">
      <path d="M0 110 H1200" />
      <path d="M0 210 H1200" />
      <path d="M0 310 H1200" />
      <path d="M0 410 H1200" />
      <path d="M0 510 H1200" />
      <path d="M0 610 H1200" />
    </g>
    <g transform="translate(90 96)">
      <rect x="0" y="0" width="1020" height="508" rx="28" fill="#05070d" fill-opacity="0.74" stroke="#7dd3fc" stroke-opacity="0.16" />
      <text x="38" y="64" fill="#67e8f9" font-size="28" font-family="Inter, Arial, sans-serif" font-weight="700">AI ROOF ANALYSIS</text>
      <text x="38" y="118" fill="#e2e8f0" font-size="24" font-family="Inter, Arial, sans-serif">${safeAddress}</text>
      <text x="38" y="164" fill="#94a3b8" font-size="20" font-family="Inter, Arial, sans-serif">${safeMessage}</text>
      <rect x="38" y="214" width="944" height="224" rx="22" fill="#0f172a" fill-opacity="0.92" stroke="#67e8f9" stroke-opacity="0.14" />
      <rect x="104" y="278" width="206" height="88" rx="12" fill="#1e293b" stroke="#67e8f9" stroke-opacity="0.24" />
      <rect x="322" y="244" width="290" height="122" rx="14" fill="#111827" stroke="#67e8f9" stroke-opacity="0.22" />
      <rect x="632" y="278" width="206" height="88" rx="12" fill="#1e293b" stroke="#67e8f9" stroke-opacity="0.24" />
      <g opacity="0.9">
        <rect x="350" y="274" width="86" height="16" rx="4" fill="#67e8f9" fill-opacity="0.32" />
        <rect x="450" y="274" width="86" height="16" rx="4" fill="#67e8f9" fill-opacity="0.32" />
        <rect x="350" y="298" width="86" height="16" rx="4" fill="#67e8f9" fill-opacity="0.32" />
        <rect x="450" y="298" width="86" height="16" rx="4" fill="#67e8f9" fill-opacity="0.32" />
        <rect x="350" y="322" width="86" height="16" rx="4" fill="#67e8f9" fill-opacity="0.32" />
        <rect x="450" y="322" width="86" height="16" rx="4" fill="#67e8f9" fill-opacity="0.32" />
      </g>
      <path d="M330 244 L468 172 L612 244 Z" fill="#67e8f9" fill-opacity="0.08" stroke="#67e8f9" stroke-opacity="0.28" />
      <path d="M160 278 L206 252 L252 278 L206 304 Z" fill="#67e8f9" fill-opacity="0.18" />
      <path d="M706 278 L752 252 L798 278 L752 304 Z" fill="#67e8f9" fill-opacity="0.18" />
      <text x="118" y="412" fill="#cbd5e1" font-size="18" font-family="Inter, Arial, sans-serif">Placeholder imagery until Google Maps Static API is enabled.</text>
    </g>
  </svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
