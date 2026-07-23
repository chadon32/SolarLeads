# CAD-Style 3D Roof View — Design

**Date:** 2026-07-17
**Status:** Approved

## Goal

Make the 3D tab read like a professional solar design tool (Aurora-style):
a dark CAD workspace with a subtle grid floor, an extruded house model with
crisp flat roof faces, a continuous irradiance gradient flowing across the
roof when Sunlight is on, and the existing black module arrays on top.
This is Phase 1 of the Aurora-parity roadmap; 3D obstructions (Phase 2)
and the editing sidebar (Phase 3) come later.

## What changes

The photo-draped DSM terrain is removed from the 3D scene entirely. The
DSM is still loaded — but only to fit the height of each roof plane. The
RGB GeoTIFF is no longer fetched by the 3D view.

### Scene composition (`roof-scene-3d.tsx`)

1. **Dark workspace** — transparent canvas over the existing dark panel,
   plus a large dark ground plane at y=0 and a subtle grid (CAD floor).
2. **Roof faces** — one flat polygon mesh per `analysis.roofSegments`
   entry, built from its outline. Default material is a warm light gray;
   the Sunlight toggle swaps it for the flux-gradient texture.
3. **Walls** — each face's perimeter extruded straight down to the ground
   as white quads, giving the solid extruded-house mass.
4. **Panels** — unchanged: the coplanar racked arrays from
   `buildSegmentPlaneTransforms`. Their 0.14 m rack standoff keeps them
   safely above the face planes.
5. **Flux gradient** — a canvas built from the annual-flux GeoTIFF using
   the existing 2–98 percentile normalization and blue→amber→orange ramp,
   mapped onto the faces with geographic UVs so the gradient is continuous
   across each face (hot ridges, cool valleys — like Aurora), not one flat
   color per face.

### Geometry (`roof-scene-geometry.ts`, pure + tested)

- `normalizedOutlineToLatLng(outline, bounds)` — inverse of the 0–100
  normalization used by the analysis pipeline (x: west→east %, y:
  north→south %).
- `earClipTriangulate(points)` — small ear-clipping triangulator for the
  (possibly concave) outline polygons.
- `buildRoofFaceGeometry({...})` — projects the outline into the local
  meter frame, fits the face plane (pitch/azimuth from the segment's own
  data; height offset = median of downslope-compensated DSM samples at the
  outline vertices and centroid — same robust fit as the panel planes),
  triangulates, and returns positions, indices, geographic UVs, and wall
  skirt geometry.

## Fallbacks

- Outline with fewer than 3 valid points → face skipped.
- No valid DSM samples for a face → height falls back to a supplied
  default (the scene passes ~60% of max roof height).
- No flux layer → Sunlight toggle simply has no texture to swap in
  (existing behavior).

## Testing

- Unit: outline denormalization hits bounds corners; ear clipping yields
  n−2 triangles with consistent winding for convex and concave polygons;
  face vertices satisfy the plane equation exactly on a synthetic planar
  DSM; UVs land in [0,1] for in-bounds faces.
- Manual: Mesa address — house reads as extruded model on dark grid;
  Sunlight shows continuous gradient; panels sit flush on faces.

## Out of scope

- 3D trees/vents/chimneys (Phase 2).
- Module picker / tilt / rotation editor sidebar (Phase 3).
- Irradiance hover tooltip.
