import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoofFaceGeometry,
  buildSegmentPlaneTransforms,
  latLngToLocalMeters,
  liftRoofSegmentPlanes,
  type SegmentPlane,
} from "../src/lib/roof-scene-geometry";

const origin = { lat: 33.4, lng: -111.9 };
const outline = [
  { lat: 33.40005, lng: -111.90005 },
  { lat: 33.40005, lng: -111.89995 },
  { lat: 33.39995, lng: -111.89995 },
  { lat: 33.39995, lng: -111.90005 },
];

test("cropped elevation scans keep roof faces planar and panels above them", () => {
  const planes = new Map<number, SegmentPlane>([
    [0, { azimuthDeg: 180, pitchDeg: 30, planeOffsetMeters: 0.2 }],
    [1, { azimuthDeg: 90, pitchDeg: 10, planeOffsetMeters: 2 }],
  ]);
  const lifted = liftRoofSegmentPlanes({ planes, outlines: [{ segmentIndex: 0, points: outline }], origin });
  assert.ok(lifted.liftMeters > 0);
  assert.equal(planes.get(0)!.planeOffsetMeters, 0.2, "source data is not mutated");
  assert.ok(Math.abs(lifted.planes.get(1)!.planeOffsetMeters - lifted.planes.get(0)!.planeOffsetMeters - 1.8) < 1e-10);
  const plane = lifted.planes.get(0)!;
  const common = {
    origin,
    raster: new Float32Array(4).fill(400),
    width: 2,
    height: 2,
    bounds: { northeast: outline[1], southwest: outline[3] },
    groundElevationMeters: 400 - lifted.liftMeters,
    fallbackElevationMeters: 3.2,
  };
  const face = buildRoofFaceGeometry({ ...common, outline, plane, pitchDeg: 30, azimuthDeg: 180, textureBounds: null });
  assert.ok(face);
  const heightAt = (point: { lat: number; lng: number }) => {
    const local = latLngToLocalMeters(point, origin);
    return plane.planeOffsetMeters - Math.tan(Math.PI / 6) * local.z;
  };
  outline.forEach((point, index) => {
    assert.ok(Math.abs(face.positions[index * 3 + 1] - heightAt(point)) < 1e-6);
    assert.ok(face.positions[index * 3 + 1] >= 0.049999);
  });
  const panels = [origin, { lat: 33.39998, lng: -111.9 }].map((center) => ({
    center, orientation: "PORTRAIT" as const, azimuthDeg: 180, pitchDeg: 30,
    rowIndex: null, columnIndex: null, yearlyEnergyDcKwh: 500, segmentIndex: 0,
  }));
  const transforms = buildSegmentPlaneTransforms({
    ...common, panels, planes: lifted.planes, panelWidthMeters: 1.045, panelHeightMeters: 1.879,
  });
  transforms.forEach((transform, index) => {
    assert.ok(transform);
    assert.ok(Math.abs(transform.position.y - heightAt(panels[index].center) - 0.14) < 1e-6);
  });
});

test("a roof already above ground retains its original display planes", () => {
  const planes = new Map<number, SegmentPlane>([[0, { azimuthDeg: 180, pitchDeg: 20, planeOffsetMeters: 8 }]]);
  const result = liftRoofSegmentPlanes({ planes, outlines: [{ segmentIndex: 0, points: outline }], origin });
  assert.equal(result.liftMeters, 0);
  assert.equal(result.planes, planes);
});
