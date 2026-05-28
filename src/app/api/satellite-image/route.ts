import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";

const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:satellite-image",
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many satellite image requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    if (!mapsKey) {
      return NextResponse.json(
        { message: "Google Maps Static API key is not configured." },
        { status: 500 }
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

    const satelliteUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    satelliteUrl.searchParams.set("center", `${lat},${lng}`);
    satelliteUrl.searchParams.set("zoom", "20");
    satelliteUrl.searchParams.set("size", "640x640");
    satelliteUrl.searchParams.set("scale", "2");
    satelliteUrl.searchParams.set("maptype", "satellite");
    satelliteUrl.searchParams.append(
      "style",
      "feature:all|element:labels|visibility:off"
    );
    satelliteUrl.searchParams.set("key", mapsKey);

    const imageResponse = await fetch(satelliteUrl, {
      headers: {
        Accept: "image/png,image/jpeg,image/webp,*/*",
      },
      cache: "no-store",
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { message: "Could not load the rooftop satellite image." },
        { status: 502 }
      );
    }

    const buffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = imageResponse.headers.get("content-type") || "image/png";

    return NextResponse.json({
      base64,
      mimeType,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unexpected satellite image failure.",
      },
      { status: 500 }
    );
  }
}
