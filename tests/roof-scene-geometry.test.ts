import assert from "node:assert/strict";
import test from "node:test";
import {
  boundsCenter,
  buildHeightfieldGeometry,
  buildObstructionMarkerGeometry,
  buildPanelTransform,
  buildRoofFaceGeometry,
  buildSegmentPlaneTransforms,
  earClipTriangulate,
  estimateGroundElevationMeters,
  expandBoundsMeters,
  fitSegmentPlanes,
  intersectBounds,
  latLngToLocalMeters,
  metersPerDegreeLng,
  normalizedOutlineToLatLng,
  sampleRasterBilinear,
  smoothGrid,
} from "../src/lib/roof-scene-geometry";
import type { SolarPanelPlacement } from "../src/lib/roof-analysis";

const ORIGIN = { lat: 33.4, lng: -111.9 };

function makeBounds(
  north: number,
  south: number,
  east: number,
  west: number
) {
  return {
    northeast: { lat: north, lng: east },
    southwest: { lat: south, lng: west },
  };
}

test("latLngToLocalMeters maps north to -z and east to +x", () => {
  const north = latLngToLocalMeters(
    { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng },
    ORIGIN
  );
  assert.ok(north.z < 0, "north should be negative z");
  assert.ok(Math.abs(north.z + 111.32) < 0.01);
  assert.equal(north.x, 0);

  const east = latLngToLocalMeters(
    { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 },
    ORIGIN
  );
  assert.ok(east.x > 0, "east should be positive x");
  assert.ok(Math.abs(east.x - metersPerDegreeLng(ORIGIN.lat) * 0.001) < 1e-9);
  assert.ok(Math.abs(east.z) < 1e-12);
});

test("estimateGroundElevationMeters picks a low percentile and skips no-data", () => {
  const raster = new Float32Array(1000);
  raster.fill(350); // ground
  for (let index = 0; index < 100; index += 1) {
    raster[index] = 356; // roof
  }
  raster[500] = -9999; // no-data sentinel
  raster[501] = Number.NaN;

  const ground = estimateGroundElevationMeters(raster);
  assert.ok(ground >= 349.9 && ground <= 350.1, `got ${ground}`);
});

test("sampleRasterBilinear interpolates between pixels", () => {
  // 2x2 raster: values 0, 10 (top row), 20, 30 (bottom row)
  const raster = new Float32Array([0, 10, 20, 30]);
  const bounds = makeBounds(33.401, 33.4, -111.899, -111.9);

  const center = sampleRasterBilinear({
    raster,
    width: 2,
    height: 2,
    bounds,
    lat: 33.4005,
    lng: -111.8995,
  });
  assert.ok(center !== null);
  assert.ok(Math.abs(center - 15) < 0.001, `expected 15, got ${center}`);

  const topLeft = sampleRasterBilinear({
    raster,
    width: 2,
    height: 2,
    bounds,
    lat: 33.401,
    lng: -111.9,
  });
  assert.equal(topLeft, 0);

  const outside = sampleRasterBilinear({
    raster,
    width: 2,
    height: 2,
    bounds,
    lat: 34,
    lng: -111.9,
  });
  assert.equal(outside, null);
});

test("intersectBounds returns overlap or null", () => {
  const a = makeBounds(33.41, 33.4, -111.89, -111.9);
  const b = makeBounds(33.405, 33.395, -111.895, -111.905);
  const overlap = intersectBounds(a, b);
  assert.ok(overlap);
  assert.equal(overlap.northeast.lat, 33.405);
  assert.equal(overlap.southwest.lat, 33.4);
  assert.equal(overlap.northeast.lng, -111.895);
  assert.equal(overlap.southwest.lng, -111.9);

  const disjoint = intersectBounds(a, makeBounds(34.01, 34, -111.89, -111.9));
  assert.equal(disjoint, null);
});

test("expandBoundsMeters grows bounds symmetrically", () => {
  const bounds = makeBounds(33.401, 33.4, -111.899, -111.9);
  const expanded = expandBoundsMeters(bounds, 111.32);
  assert.ok(Math.abs(expanded.northeast.lat - 33.402) < 1e-6);
  assert.ok(Math.abs(expanded.southwest.lat - 33.399) < 1e-6);
  assert.ok(expanded.northeast.lng > bounds.northeast.lng);
  assert.ok(expanded.southwest.lng < bounds.southwest.lng);
});

test("buildHeightfieldGeometry produces a grid with ground-relative heights", () => {
  const width = 21;
  const height = 21;
  const raster = new Float32Array(width * height);
  raster.fill(350);
  // A 5x5 "house" bump in the middle, 4m tall.
  for (let r = 8; r <= 12; r += 1) {
    for (let c = 8; c <= 12; c += 1) {
      raster[r * width + c] = 354;
    }
  }

  const bounds = makeBounds(33.401, 33.4, -111.899, -111.9);
  const geometry = buildHeightfieldGeometry({
    raster,
    width,
    height,
    bounds,
    cropBounds: bounds,
    textureBounds: bounds,
    origin: boundsCenter(bounds),
    groundElevationMeters: 350,
    maxGridSize: 64,
  });

  assert.ok(geometry);
  assert.equal(geometry.rows, 21);
  assert.equal(geometry.cols, 21);
  assert.equal(geometry.positions.length, 21 * 21 * 3);
  assert.equal(geometry.uvs.length, 21 * 21 * 2);
  assert.equal(geometry.indices.length, 20 * 20 * 6);
  assert.ok(Math.abs(geometry.maxHeightMeters - 4) < 0.001);

  // Center vertex should be on the bump; corner on the ground.
  const centerVertex = 10 * 21 + 10;
  assert.ok(Math.abs(geometry.positions[centerVertex * 3 + 1] - 4) < 0.001);
  assert.equal(geometry.positions[1], 0);

  // UVs span the texture bounds: first vertex is northwest -> u=0, v=1.
  assert.ok(Math.abs(geometry.uvs[0] - 0) < 1e-6);
  assert.ok(Math.abs(geometry.uvs[1] - 1) < 1e-6);
  const lastVertex = 21 * 21 - 1;
  assert.ok(Math.abs(geometry.uvs[lastVertex * 2] - 1) < 1e-6);
  assert.ok(Math.abs(geometry.uvs[lastVertex * 2 + 1] - 0) < 1e-6);
});

test("buildHeightfieldGeometry downsamples large rasters", () => {
  const width = 500;
  const height = 500;
  const raster = new Float32Array(width * height).fill(350);
  const bounds = makeBounds(33.402, 33.4, -111.898, -111.9);

  const geometry = buildHeightfieldGeometry({
    raster,
    width,
    height,
    bounds,
    cropBounds: bounds,
    textureBounds: bounds,
    origin: boundsCenter(bounds),
    groundElevationMeters: 350,
    maxGridSize: 100,
  });

  assert.ok(geometry);
  assert.ok(geometry.rows <= 101, `rows ${geometry.rows}`);
  assert.ok(geometry.cols <= 101, `cols ${geometry.cols}`);
});

test("buildHeightfieldGeometry returns null when crop misses the raster", () => {
  const bounds = makeBounds(33.401, 33.4, -111.899, -111.9);
  const geometry = buildHeightfieldGeometry({
    raster: new Float32Array(4).fill(350),
    width: 2,
    height: 2,
    bounds,
    cropBounds: makeBounds(34.01, 34, -111.899, -111.9),
    textureBounds: bounds,
    origin: ORIGIN,
    groundElevationMeters: 350,
  });
  assert.equal(geometry, null);
});

test("buildPanelTransform positions and orients a module", () => {
  const panel = {
    azimuthDeg: 180,
    center: { lat: ORIGIN.lat - 0.0001, lng: ORIGIN.lng },
    columnIndex: null,
    orientation: "PORTRAIT" as const,
    pitchDeg: 20,
    rowIndex: null,
    segmentIndex: 0,
    yearlyEnergyDcKwh: 500,
  };

  const transform = buildPanelTransform({
    panel,
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    origin: ORIGIN,
    elevationAboveGroundMeters: 4,
  });

  // South of origin -> +z; module floats above roof surface by the standoff.
  assert.ok(transform.position.z > 0);
  assert.ok(Math.abs(transform.position.z - 11.132) < 0.01);
  assert.equal(transform.position.x, 0);
  assert.ok(Math.abs(transform.position.y - 4.14) < 0.001);

  // South-facing: heading = pi - pi = 0. Tilt equals pitch.
  assert.ok(Math.abs(transform.headingRad) < 1e-9);
  assert.ok(Math.abs(transform.tiltRad - (20 * Math.PI) / 180) < 1e-9);

  // Portrait: long edge runs along the azimuth.
  assert.equal(transform.alongMeters, 1.879);
  assert.equal(transform.acrossMeters, 1.045);

  const landscape = buildPanelTransform({
    panel: { ...panel, orientation: "LANDSCAPE" as const },
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    origin: ORIGIN,
    elevationAboveGroundMeters: 4,
  });
  assert.equal(landscape.alongMeters, 1.045);
  assert.equal(landscape.acrossMeters, 1.879);

  // West-facing roof (azimuth 270): heading rotates +Z toward compass west.
  const west = buildPanelTransform({
    panel: { ...panel, azimuthDeg: 270 },
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    origin: ORIGIN,
    elevationAboveGroundMeters: 4,
  });
  // Rotating (0,0,1) by headingRad about +Y gives (sin h, 0, cos h);
  // compass west in the local frame is (-1, 0, 0).
  assert.ok(Math.abs(Math.sin(west.headingRad) + 1) < 1e-9);
  assert.ok(Math.abs(Math.cos(west.headingRad)) < 1e-9);
});

test("smoothGrid leaves a flat grid unchanged and is a no-op at 0 iterations", () => {
  const flat = new Float32Array(25).fill(4.5);
  const smoothed = smoothGrid(flat, 5, 5, 2);
  for (const value of smoothed) {
    assert.ok(Math.abs(value - 4.5) < 1e-6);
  }

  const noisy = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const untouched = smoothGrid(noisy, 3, 3, 0);
  assert.deepEqual([...untouched], [...noisy]);
});

test("smoothGrid attenuates a spike while roughly preserving the surface", () => {
  const grid = new Float32Array(49).fill(3);
  grid[24] = 9; // spike in the middle of a 7x7 grid

  const smoothed = smoothGrid(grid, 7, 7, 2);

  assert.ok(smoothed[24] < 6, `spike still ${smoothed[24]}`);
  const mean =
    [...smoothed].reduce((sum, value) => sum + value, 0) / smoothed.length;
  assert.ok(Math.abs(mean - (3 + 6 / 49)) < 0.05, `mean drifted to ${mean}`);
});

function makePlanePanel({
  lat,
  lng,
  segmentIndex = 0,
  azimuthDeg = 180,
  pitchDeg = 20,
}: {
  lat: number;
  lng: number;
  segmentIndex?: number;
  azimuthDeg?: number;
  pitchDeg?: number;
}): SolarPanelPlacement {
  return {
    center: { lat, lng },
    orientation: "PORTRAIT",
    azimuthDeg,
    pitchDeg,
    rowIndex: null,
    columnIndex: null,
    yearlyEnergyDcKwh: 500,
    segmentIndex,
  };
}

test("buildSegmentPlaneTransforms mounts a segment's panels exactly coplanar", () => {
  // 21x21 raster over a ~111m square; a south-facing 20-degree plane with
  // deterministic per-cell noise.
  const size = 21;
  const bounds = makeBounds(33.4005, 33.3995, -111.8995, -111.9005);
  const ground = 400;
  const tan20 = Math.tan((20 * Math.PI) / 180);
  const raster = new Float32Array(size * size);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      // Row r=0 is north; the plane faces south (azimuth 180), so height
      // drops toward the south edge. Downslope s = meters south of center.
      const metersSouth = ((r - (size - 1) / 2) / (size - 1)) * 111.32;
      const noise = 0.25 * Math.sin(r * 12.9898 + c * 78.233);
      raster[r * size + c] = ground + 8 - tan20 * metersSouth + noise;
    }
  }

  const origin = boundsCenter(bounds);
  const panels = [
    makePlanePanel({ lat: 33.40005, lng: -111.90005 }),
    makePlanePanel({ lat: 33.40003, lng: -111.90001 }),
    makePlanePanel({ lat: 33.40001, lng: -111.89998 }),
    makePlanePanel({ lat: 33.39998, lng: -111.90003 }),
    // Second segment, different facing.
    makePlanePanel({ lat: 33.39995, lng: -111.9, segmentIndex: 1, azimuthDeg: 90 }),
    makePlanePanel({ lat: 33.39994, lng: -111.89999, segmentIndex: 1, azimuthDeg: 90 }),
  ];

  const transforms = buildSegmentPlaneTransforms({
    panels,
    raster,
    width: size,
    height: size,
    bounds,
    origin,
    groundElevationMeters: ground,
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    fallbackElevationMeters: 3,
    standoffMeters: 0.14,
  });

  assert.equal(transforms.length, panels.length);
  assert.ok(transforms.every((transform) => transform !== null));

  // Coplanarity: height + tan(pitch) * downslope must be constant per segment.
  const planeConstant = (transform: NonNullable<(typeof transforms)[0]>, azimuthDeg: number) => {
    const azRad = (azimuthDeg * Math.PI) / 180;
    const s =
      transform.position.x * Math.sin(azRad) +
      -transform.position.z * Math.cos(azRad);
    return transform.position.y - 0.14 + tan20 * s;
  };

  const southConstants = transforms
    .slice(0, 4)
    .map((transform) => planeConstant(transform!, 180));
  for (const constant of southConstants) {
    assert.ok(
      Math.abs(constant - southConstants[0]) < 1e-6,
      `south segment not coplanar: ${southConstants.join(", ")}`
    );
  }

  // Shared orientation within the segment.
  const headings = new Set(transforms.slice(0, 4).map((t) => t!.headingRad));
  const tilts = new Set(transforms.slice(0, 4).map((t) => t!.tiltRad));
  assert.equal(headings.size, 1);
  assert.equal(tilts.size, 1);

  // The east-facing segment fits its own plane, independent of the first.
  const eastConstants = transforms
    .slice(4)
    .map((transform) => planeConstant(transform!, 90));
  assert.ok(Math.abs(eastConstants[0] - eastConstants[1]) < 1e-6);
});

test("buildSegmentPlaneTransforms returns null for invalid centers and falls back off-raster", () => {
  const size = 5;
  const bounds = makeBounds(33.4001, 33.3999, -111.8999, -111.9001);
  const raster = new Float32Array(size * size).fill(402);
  const origin = boundsCenter(bounds);

  const panels = [
    makePlanePanel({ lat: Number.NaN, lng: -111.9 }),
    // Far outside the raster: no samples, uses the fallback elevation.
    makePlanePanel({ lat: 33.5, lng: -111.5, pitchDeg: 0 }),
  ];

  const transforms = buildSegmentPlaneTransforms({
    panels,
    raster,
    width: size,
    height: size,
    bounds,
    origin,
    groundElevationMeters: 400,
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    fallbackElevationMeters: 3,
    standoffMeters: 0.14,
  });

  assert.equal(transforms[0], null);
  assert.ok(transforms[1]);
  assert.ok(Math.abs(transforms[1]!.position.y - (3 + 0.14)) < 1e-6);
});

test("normalizedOutlineToLatLng maps corners onto the bounds corners", () => {
  const bounds = makeBounds(33.41, 33.4, -111.89, -111.9);
  const outline = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  const latLng = normalizedOutlineToLatLng(outline, bounds);

  assert.deepEqual(latLng[0], { lat: 33.41, lng: -111.9 }); // NW
  assert.deepEqual(latLng[1], { lat: 33.41, lng: -111.89 }); // NE
  assert.deepEqual(latLng[2], { lat: 33.4, lng: -111.89 }); // SE
  assert.deepEqual(latLng[3], { lat: 33.4, lng: -111.9 }); // SW
});

test("earClipTriangulate handles convex and concave polygons with up-facing winding", () => {
  const square = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];
  const squareTris = earClipTriangulate(square);
  assert.equal(squareTris.length, 6); // n - 2 = 2 triangles

  // Concave L-shape: 6 vertices -> 4 triangles.
  const ell = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 4 },
    { x: 4, z: 4 },
    { x: 4, z: 10 },
    { x: 0, z: 10 },
  ];
  const ellTris = earClipTriangulate(ell);
  assert.equal(ellTris.length, 12);

  // Every triangle faces up: cross-product normal has positive y.
  for (let index = 0; index < ellTris.length; index += 3) {
    const a = ell[ellTris[index]];
    const b = ell[ellTris[index + 1]];
    const c = ell[ellTris[index + 2]];
    const normalY =
      (b.z - a.z) * (c.x - a.x) - (c.z - a.z) * (b.x - a.x);
    assert.ok(normalY > 0, `triangle ${index / 3} faces down`);
  }
});

test("buildRoofFaceGeometry produces vertices on the segment plane with UVs", () => {
  // Synthetic 21x21 DSM: a south-facing 18-degree plane, like the panel test.
  const size = 21;
  const bounds = makeBounds(33.4005, 33.3995, -111.8995, -111.9005);
  const ground = 400;
  const tan18 = Math.tan((18 * Math.PI) / 180);
  const raster = new Float32Array(size * size);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const metersSouth = ((r - (size - 1) / 2) / (size - 1)) * 111.32;
      raster[r * size + c] = ground + 6 - tan18 * metersSouth;
    }
  }

  const origin = boundsCenter(bounds);
  const outline = [
    { lat: 33.4002, lng: -111.9002 },
    { lat: 33.4002, lng: -111.89985 },
    { lat: 33.39995, lng: -111.89985 },
    { lat: 33.39995, lng: -111.9002 },
  ];

  const face = buildRoofFaceGeometry({
    outline,
    pitchDeg: 18,
    azimuthDeg: 180,
    origin,
    raster,
    width: size,
    height: size,
    bounds,
    groundElevationMeters: ground,
    fallbackElevationMeters: 3,
    textureBounds: bounds,
  });

  assert.ok(face);
  assert.equal(face.positions.length, outline.length * 3);
  assert.equal(face.indices.length, (outline.length - 2) * 3);

  // Plane equation: y + tan(pitch) * s constant across all vertices.
  const constants: number[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const x = face.positions[index * 3];
    const y = face.positions[index * 3 + 1];
    const z = face.positions[index * 3 + 2];
    const s = x * Math.sin(Math.PI) + -z * Math.cos(Math.PI);
    constants.push(y + tan18 * s);
  }
  for (const constant of constants) {
    assert.ok(
      Math.abs(constant - constants[0]) < 1e-6,
      `face not planar: ${constants.join(", ")}`
    );
  }

  // Geographic UVs stay inside [0, 1] for an in-bounds face.
  for (let index = 0; index < face.uvs.length; index += 1) {
    assert.ok(face.uvs[index] >= 0 && face.uvs[index] <= 1);
  }

  // Wall skirts: one quad (4 verts, 6 indices) per perimeter edge.
  assert.equal(face.wallPositions.length, outline.length * 4 * 3);
  assert.equal(face.wallIndices.length, outline.length * 6);
});

test("buildRoofFaceGeometry falls back off-raster and rejects degenerate outlines", () => {
  const size = 5;
  const bounds = makeBounds(33.4001, 33.3999, -111.8999, -111.9001);
  const raster = new Float32Array(size * size).fill(402);
  const origin = boundsCenter(bounds);

  // Two points only -> null.
  const degenerate = buildRoofFaceGeometry({
    outline: [
      { lat: 33.4, lng: -111.9 },
      { lat: 33.4001, lng: -111.9 },
    ],
    pitchDeg: 20,
    azimuthDeg: 180,
    origin,
    raster,
    width: size,
    height: size,
    bounds,
    groundElevationMeters: 400,
    fallbackElevationMeters: 3,
    textureBounds: null,
  });
  assert.equal(degenerate, null);

  // Entirely off the raster with pitch 0 -> flat face at the fallback height.
  const offRaster = buildRoofFaceGeometry({
    outline: [
      { lat: 33.5, lng: -111.5 },
      { lat: 33.5, lng: -111.4995 },
      { lat: 33.4995, lng: -111.4995 },
    ],
    pitchDeg: 0,
    azimuthDeg: 180,
    origin: { lat: 33.4998, lng: -111.4998 },
    raster,
    width: size,
    height: size,
    bounds,
    groundElevationMeters: 400,
    fallbackElevationMeters: 3.5,
    textureBounds: null,
  });
  assert.ok(offRaster);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(offRaster.positions[index * 3 + 1] - 3.5) < 1e-6);
  }
});

test("buildObstructionMarkerGeometry builds a raised prism on the roof", () => {
  const size = 11;
  const bounds = makeBounds(33.4005, 33.3995, -111.8995, -111.9005);
  const ground = 400;
  // Flat roof patch 5m above ground.
  const raster = new Float32Array(size * size).fill(ground + 5);
  const origin = boundsCenter(bounds);

  const outline = [
    { lat: 33.4001, lng: -111.9001 },
    { lat: 33.4001, lng: -111.8999 },
    { lat: 33.3999, lng: -111.8999 },
    { lat: 33.3999, lng: -111.9001 },
  ];

  const marker = buildObstructionMarkerGeometry({
    outline,
    origin,
    raster,
    width: size,
    height: size,
    bounds,
    groundElevationMeters: ground,
    fallbackElevationMeters: 3,
    heightMeters: 0.6,
  });

  assert.ok(marker);
  // Top sits 5m (roof) + 0.6m (marker) above ground.
  assert.ok(Math.abs(marker.topHeightMeters - 5.6) < 1e-6);
  for (let index = 0; index < outline.length; index += 1) {
    assert.ok(Math.abs(marker.positions[index * 3 + 1] - 5.6) < 1e-6);
  }
  // Wall skirts run from the top height down to the roof base. Each quad is
  // [top1, top2, base2, base1]; y is every 3rd float from offset 1.
  assert.equal(marker.wallPositions.length, outline.length * 4 * 3);
  assert.ok(Math.abs(marker.wallPositions[1] - 5.6) < 1e-6); // top1 y
  assert.ok(Math.abs(marker.wallPositions[4] - 5.6) < 1e-6); // top2 y
  assert.ok(Math.abs(marker.wallPositions[7] - 5) < 1e-6); // base2 y
  assert.ok(Math.abs(marker.wallPositions[10] - 5) < 1e-6); // base1 y
});

test("buildObstructionMarkerGeometry rejects degenerate outlines", () => {
  const size = 5;
  const bounds = makeBounds(33.4001, 33.3999, -111.8999, -111.9001);
  const marker = buildObstructionMarkerGeometry({
    outline: [
      { lat: 33.4, lng: -111.9 },
      { lat: 33.4001, lng: -111.9 },
    ],
    origin: boundsCenter(bounds),
    raster: new Float32Array(size * size).fill(402),
    width: size,
    height: size,
    bounds,
    groundElevationMeters: 400,
    fallbackElevationMeters: 3,
  });
  assert.equal(marker, null);
});

test("faces sharing a fitted segment plane sit exactly under their panels", () => {
  // Noisy 20-degree plane raster (same setup as the coplanar panel test).
  const size = 21;
  const bounds = makeBounds(33.4005, 33.3995, -111.8995, -111.9005);
  const ground = 400;
  const tan20 = Math.tan((20 * Math.PI) / 180);
  const raster = new Float32Array(size * size);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const metersSouth = ((r - (size - 1) / 2) / (size - 1)) * 111.32;
      const noise = 0.25 * Math.sin(r * 12.9898 + c * 78.233);
      raster[r * size + c] = ground + 8 - tan20 * metersSouth + noise;
    }
  }

  const origin = boundsCenter(bounds);
  const panels: SolarPanelPlacement[] = [
    { lat: 33.40005, lng: -111.90005 },
    { lat: 33.40003, lng: -111.90001 },
    { lat: 33.39998, lng: -111.90003 },
  ].map((center) => ({
    center,
    orientation: "PORTRAIT",
    azimuthDeg: 180,
    pitchDeg: 20,
    rowIndex: null,
    columnIndex: null,
    yearlyEnergyDcKwh: 500,
    segmentIndex: 0,
  }));

  const planes = fitSegmentPlanes({
    panels,
    raster,
    width: size,
    height: size,
    bounds,
    origin,
    groundElevationMeters: ground,
    fallbackElevationMeters: 3.2,
  });
  const plane = planes.get(0);
  assert.ok(plane);

  // Transforms built from the same plane map.
  const transforms = buildSegmentPlaneTransforms({
    panels,
    raster,
    width: size,
    height: size,
    bounds,
    origin,
    groundElevationMeters: ground,
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    fallbackElevationMeters: 3.2,
  });

  // Face built ON the shared plane, ignoring its own (edge-biased) samples.
  const face = buildRoofFaceGeometry({
    outline: [
      { lat: 33.40007, lng: -111.90007 },
      { lat: 33.40007, lng: -111.89999 },
      { lat: 33.39996, lng: -111.89999 },
      { lat: 33.39996, lng: -111.90007 },
    ],
    pitchDeg: 17, // deliberately different from the plane's pitch
    azimuthDeg: 175, // and azimuth — the shared plane must win
    origin,
    raster,
    width: size,
    height: size,
    bounds,
    groundElevationMeters: ground,
    fallbackElevationMeters: 3.2,
    textureBounds: null,
    plane,
  });
  assert.ok(face);

  // Every face vertex satisfies the SHARED plane equation.
  const azRad = (plane.azimuthDeg * Math.PI) / 180;
  const tanP = Math.tan((plane.pitchDeg * Math.PI) / 180);
  for (let index = 0; index < 4; index += 1) {
    const x = face.positions[index * 3];
    const y = face.positions[index * 3 + 1];
    const z = face.positions[index * 3 + 2];
    const s = x * Math.sin(azRad) + -z * Math.cos(azRad);
    assert.ok(
      Math.abs(y + tanP * s - plane.planeOffsetMeters) < 1e-6,
      `face vertex ${index} off the shared plane`
    );
  }

  // Panels float exactly one standoff above the face plane at their centers.
  transforms.forEach((transform) => {
    assert.ok(transform);
    const s =
      transform.position.x * Math.sin(azRad) +
      -transform.position.z * Math.cos(azRad);
    const faceY = plane.planeOffsetMeters - tanP * s;
    assert.ok(
      Math.abs(transform.position.y - 0.14 - faceY) < 1e-6,
      `panel gap ${transform.position.y - 0.14 - faceY}`
    );
  });
});
