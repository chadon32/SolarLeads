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
    const zoom = 20;
    const size = 640;
    satelliteUrl.searchParams.set("center", `${lat},${lng}`);
    satelliteUrl.searchParams.set("zoom", String(zoom));
    satelliteUrl.searchParams.set("size", `${size}x${size}`);
    satelliteUrl.searchParams.set("scale", "1");
    satelliteUrl.searchParams.set("maptype", "satellite");
    satelliteUrl.searchParams.set("format", "jpg-baseline");
    satelliteUrl.searchParams.append(
      "style",
      "feature:all|element:labels|visibility:off"
    );
    satelliteUrl.searchParams.set("key", mapsKey);

    const imageResponse = await fetch(satelliteUrl, {
      headers: {
        Accept: "image/jpeg,image/png,image/webp,*/*",
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
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
    const bounds = getStaticMapBounds({
      lat,
      lng,
      zoom,
      width: size,
      height: size,
    });

    return NextResponse.json({
      base64,
      mimeType,
      bounds,
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

function getStaticMapBounds(params: {
  lat: number;
  lng: number;
  zoom: number;
  width: number;
  height: number;
}) {
  const tileSize = 256;
  const scale = 2 ** params.zoom;
  const worldSize = tileSize * scale;
  const centerX = ((params.lng + 180) / 360) * worldSize;
  const sinLat = Math.sin((params.lat * Math.PI) / 180);
  const centerY =
    (0.5 -
      Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
    worldSize;

  const halfWidth = params.width / 2;
  const halfHeight = params.height / 2;
  const sw = worldPointToLatLng(centerX - halfWidth, centerY + halfHeight, worldSize);
  const ne = worldPointToLatLng(centerX + halfWidth, centerY - halfHeight, worldSize);

  return {
    southwest: sw,
    northeast: ne,
  };
}

function worldPointToLatLng(x: number, y: number, worldSize: number) {
  const lng = (x / worldSize) * 360 - 180;
  const mercator = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat =
    (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercator) - Math.exp(-mercator)));

  return { lat, lng };
}
