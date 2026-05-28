import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fetchSolarDataLayers } from "@/lib/google-solar";

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:solar-data-layers",
      limit: 24,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many irradiance requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { message: "lat and lng are required." },
        { status: 400 }
      );
    }

    const dataLayers = await fetchSolarDataLayers(lat, lng);
    const proxyUrl = (sourceUrl?: string) =>
      sourceUrl
        ? `/api/solar/geotiff?url=${encodeURIComponent(sourceUrl)}`
        : null;

    return NextResponse.json({
      annualFluxUrl: proxyUrl(dataLayers.annualFluxUrl),
      dsmUrl: proxyUrl(dataLayers.dsmUrl),
      maskUrl: proxyUrl(dataLayers.maskUrl),
      rgbUrl: proxyUrl(dataLayers.rgbUrl),
      imageryQuality: dataLayers.imageryQuality ?? null,
      imageryDate: dataLayers.imageryDate ?? null,
      imageryProcessedDate: dataLayers.imageryProcessedDate ?? null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unexpected solar data layer failure.";

    return NextResponse.json(
      {
        message: detail,
      },
      { status: 502 }
    );
  }
}
