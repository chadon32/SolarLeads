import type { RoofGeoBounds } from "@/lib/roof-analysis";

export type RasterData =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;

export type GeoTiffRaster = {
  bounds: RoofGeoBounds;
  height: number;
  raster: RasterData;
  width: number;
};

export async function readGeoTiffRaster(
  url: string,
  fallbackBounds: RoofGeoBounds | null
): Promise<GeoTiffRaster | null> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  const { fromArrayBuffer } = await import("geotiff");
  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();

  return {
    bounds: getGeoTiffBounds(image, fallbackBounds),
    height: image.getHeight(),
    raster: (await image.readRasters({ interleave: true })) as RasterData,
    width: image.getWidth(),
  };
}

export function getGeoTiffBounds(
  image: unknown,
  fallbackBounds: RoofGeoBounds | null
): RoofGeoBounds {
  const imageWithBounds = image as {
    getBoundingBox?: () => number[];
    getGeoKeys?: () => { ProjectedCSTypeGeoKey?: number } | null;
  };
  const box = imageWithBounds.getBoundingBox?.();

  if (box && box.length >= 4) {
    const [west, south, east, north] = box.map(Number);

    if (
      Number.isFinite(west) &&
      Number.isFinite(south) &&
      Number.isFinite(east) &&
      Number.isFinite(north)
    ) {
      if (
        Math.abs(south) <= 90 &&
        Math.abs(north) <= 90 &&
        Math.abs(west) <= 180 &&
        Math.abs(east) <= 180
      ) {
        return {
          northeast: {
            lat: Math.max(north, south),
            lng: Math.max(east, west),
          },
          southwest: {
            lat: Math.min(north, south),
            lng: Math.min(east, west),
          },
        };
      }

      // Google Solar GeoTIFFs are projected in UTM (EPSG:326xx/327xx).
      const epsg = imageWithBounds.getGeoKeys?.()?.ProjectedCSTypeGeoKey;
      const utm = parseUtmEpsg(epsg);

      if (utm) {
        const southwest = utmToLatLng(west, south, utm.zone, utm.northern);
        const northeast = utmToLatLng(east, north, utm.zone, utm.northern);

        if (southwest && northeast) {
          return {
            northeast: {
              lat: Math.max(northeast.lat, southwest.lat),
              lng: Math.max(northeast.lng, southwest.lng),
            },
            southwest: {
              lat: Math.min(northeast.lat, southwest.lat),
              lng: Math.min(northeast.lng, southwest.lng),
            },
          };
        }
      }
    }
  }

  return (
    fallbackBounds ?? {
      northeast: { lat: 0, lng: 0 },
      southwest: { lat: 0, lng: 0 },
    }
  );
}

function parseUtmEpsg(
  epsg: number | undefined
): { zone: number; northern: boolean } | null {
  if (!epsg) {
    return null;
  }

  if (epsg >= 32601 && epsg <= 32660) {
    return { zone: epsg - 32600, northern: true };
  }

  if (epsg >= 32701 && epsg <= 32760) {
    return { zone: epsg - 32700, northern: false };
  }

  return null;
}

/**
 * Inverse transverse Mercator (WGS84, standard UTM parameters).
 * Snyder series expansion — sub-centimeter accuracy at these scales.
 */
export function utmToLatLng(
  easting: number,
  northing: number,
  zone: number,
  northern: boolean
): { lat: number; lng: number } | null {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    return null;
  }

  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const x = easting - 500_000;
  const y = northern ? northing : northing - 10_000_000;

  const M = y / k0;
  const mu =
    M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const C1 = ep2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  const latRad =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) *
          D ** 6) /
          720);

  const lngRad =
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) *
        D ** 5) /
        120) /
    cosPhi1;

  const centralMeridian = (zone - 1) * 6 - 180 + 3;
  const lat = (latRad * 180) / Math.PI;
  const lng = centralMeridian + (lngRad * 180) / Math.PI;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}
