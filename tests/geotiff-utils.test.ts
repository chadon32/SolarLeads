import assert from "node:assert/strict";
import test from "node:test";
import { getGeoTiffBounds, utmToLatLng } from "../src/lib/geotiff-utils";

test("utmToLatLng converts a Mesa AZ UTM 12N coordinate", () => {
  // Center of a real Solar API DSM tile for 3555 N Diego, Mesa AZ
  // (geocoded at lat 33.4800827, lng -111.6912653).
  const result = utmToLatLng(435776.25, 3704724.7, 12, true);
  assert.ok(result);
  assert.ok(Math.abs(result.lat - 33.48) < 0.001, `lat ${result.lat}`);
  assert.ok(Math.abs(result.lng - -111.6913) < 0.001, `lng ${result.lng}`);
});

test("getGeoTiffBounds converts UTM bounding boxes via geo keys", () => {
  const fakeImage = {
    getBoundingBox: () => [435726, 3704674.7, 435826.5, 3704774.7],
    getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 32612 }),
  };

  const bounds = getGeoTiffBounds(fakeImage, null);

  // ~100m box near Mesa AZ.
  assert.ok(Math.abs(bounds.southwest.lat - 33.4796) < 0.001);
  assert.ok(Math.abs(bounds.northeast.lat - 33.4805) < 0.001);
  assert.ok(bounds.northeast.lat > bounds.southwest.lat);
  assert.ok(bounds.northeast.lng > bounds.southwest.lng);

  const latSpanMeters =
    (bounds.northeast.lat - bounds.southwest.lat) * 111_320;
  const lngSpanMeters =
    (bounds.northeast.lng - bounds.southwest.lng) *
    111_320 *
    Math.cos((33.48 * Math.PI) / 180);
  assert.ok(Math.abs(latSpanMeters - 100) < 2, `lat span ${latSpanMeters}m`);
  assert.ok(Math.abs(lngSpanMeters - 100.5) < 2, `lng span ${lngSpanMeters}m`);
});

test("getGeoTiffBounds keeps degree bounding boxes as-is", () => {
  const fakeImage = {
    getBoundingBox: () => [-111.9, 33.4, -111.899, 33.401],
    getGeoKeys: () => ({}),
  };

  const bounds = getGeoTiffBounds(fakeImage, null);
  assert.equal(bounds.southwest.lng, -111.9);
  assert.equal(bounds.northeast.lat, 33.401);
});

test("getGeoTiffBounds falls back when projection is unknown", () => {
  const fakeImage = {
    getBoundingBox: () => [435726, 3704674.7, 435826.5, 3704774.7],
    getGeoKeys: () => ({}),
  };

  const fallback = {
    northeast: { lat: 33.5, lng: -111.6 },
    southwest: { lat: 33.4, lng: -111.7 },
  };
  const bounds = getGeoTiffBounds(fakeImage, fallback);
  assert.deepEqual(bounds, fallback);
});
