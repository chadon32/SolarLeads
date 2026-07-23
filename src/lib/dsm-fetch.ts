import "server-only";
import { fromArrayBuffer } from "geotiff";
import { fetchSolarDataLayers } from "@/lib/google-solar";
import { getGeoTiffBounds } from "@/lib/geotiff-utils";
import {
  estimateGroundElevationMeters,
  sampleRasterBilinear,
} from "@/lib/roof-scene-geometry";

const GOOGLE_SOLAR_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;

const METERS_PER_DEGREE_LAT = 111_320;
/** Half-extents (m) of the footprint scanned for raised equipment. */
const FOOTPRINT_HALF_ALONG_METERS = 0.9;
const FOOTPRINT_HALF_ACROSS_METERS = 0.55;

export type DsmSamplers = {
  /**
   * Bilinear height above ground (m) at a point — smooth, for plane fits.
   * Null outside the raster.
   */
  heightAt: (lat: number, lng: number) => number | null;
  /**
   * Peak height above ground (m) among the NATIVE pixels under a panel-
   * sized footprint centered on the point. Nearest-neighbor max-pool, so a
   * 1-2 pixel AC unit is preserved rather than smoothed away. Null when no
   * pixel in the footprint is valid.
   */
  footprintPeakAt: (lat: number, lng: number) => number | null;
};

/**
 * Server-side DSM fetch for the building filters. Returns both a smooth
 * height sampler (plane fitting) and a native-resolution footprint-peak
 * sampler (raised-equipment detection), or null when the elevation layer
 * is unavailable. Best-effort — callers fail open.
 */
export async function fetchDsmSamplers(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<DsmSamplers | null> {
  if (!GOOGLE_SOLAR_KEY) {
    return null;
  }

  try {
    const layers = await fetchSolarDataLayers(lat, lng, signal);

    if (!layers.dsmUrl) {
      return null;
    }

    const url = new URL(layers.dsmUrl);
    url.searchParams.set("key", GOOGLE_SOLAR_KEY);

    const response = await fetch(url, { cache: "no-store", signal });

    if (!response.ok) {
      return null;
    }

    const buffer = await response.arrayBuffer();
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const raster = (await image.readRasters({
      interleave: true,
    })) as Float32Array;
    const width = image.getWidth();
    const height = image.getHeight();
    const bounds = getGeoTiffBounds(image, null);
    const ground = estimateGroundElevationMeters(raster);

    const latSpan = bounds.northeast.lat - bounds.southwest.lat;
    const lngSpan = bounds.northeast.lng - bounds.southwest.lng;
    const metersPerDegreeLng =
      METERS_PER_DEGREE_LAT *
      Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const pixelMeters = latSpan > 0 ? (latSpan * METERS_PER_DEGREE_LAT) / height : 0.5;

    const nativeAt = (sampleLat: number, sampleLng: number) => {
      if (latSpan <= 0 || lngSpan <= 0) {
        return null;
      }
      const col = Math.floor(((sampleLng - bounds.southwest.lng) / lngSpan) * width);
      const row = Math.floor(((bounds.northeast.lat - sampleLat) / latSpan) * height);
      if (col < 0 || row < 0 || col >= width || row >= height) {
        return null;
      }
      const value = Number(raster[row * width + col]);
      return Number.isFinite(value) && value > -1000 && value < 9000
        ? value
        : null;
    };

    return {
      heightAt: (sampleLat, sampleLng) => {
        const value = sampleRasterBilinear({
          raster,
          width,
          height,
          bounds,
          lat: sampleLat,
          lng: sampleLng,
        });
        return value === null ? null : Math.max(0, value - ground);
      },
      footprintPeakAt: (sampleLat, sampleLng) => {
        const step = Math.max(pixelMeters, 0.25);
        const dLat = step / METERS_PER_DEGREE_LAT;
        const dLng = step / metersPerDegreeLng;
        let peak: number | null = null;
        for (
          let along = -FOOTPRINT_HALF_ALONG_METERS;
          along <= FOOTPRINT_HALF_ALONG_METERS + 1e-9;
          along += step
        ) {
          for (
            let across = -FOOTPRINT_HALF_ACROSS_METERS;
            across <= FOOTPRINT_HALF_ACROSS_METERS + 1e-9;
            across += step
          ) {
            const value = nativeAt(
              sampleLat + (along / step) * dLat,
              sampleLng + (across / step) * dLng
            );
            if (value !== null) {
              const relative = Math.max(0, value - ground);
              peak = peak === null ? relative : Math.max(peak, relative);
            }
          }
        }
        return peak;
      },
    };
  } catch {
    return null;
  }
}
