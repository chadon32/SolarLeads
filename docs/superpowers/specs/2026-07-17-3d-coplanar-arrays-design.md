# 3D Coplanar Arrays and Terrain Smoothing — Design

**Date:** 2026-07-17
**Status:** Approved

## Goal

Make the 3D roof model read as professional: panel arrays mounted flat on
racked planes instead of jumbled tiles, and terrain without spiky
elevation-noise artifacts. Display-only polish — no data or API changes.

## Problem

Each panel currently samples its own elevation from the Solar API DSM
(bilinear). DSM noise of ±10–30 cm between neighboring samples makes
modules that belong to one racked array sit at visibly different heights
and angles. The terrain mesh also inherits high-frequency DSM noise,
producing melted, spiky roof edges.

## Approach

Two pure additions to `src/lib/roof-scene-geometry.ts`:

1. **`buildSegmentPlaneTransforms`** — constrained per-segment plane fit.
   - Group panels by `segmentIndex`.
   - Plane tilt and facing come from the group's own data (median
     `pitchDeg`, shared `azimuthDeg` — already consensus values from the
     regularizer). Only the plane's height offset is fitted: sample the DSM
     at each panel center, compensate each sample for its downslope
     position (`h + tan(pitch) · s`), and take the median.
   - Every panel's elevation is then read off that plane, plus the rack
     standoff. All modules in a segment are exactly coplanar.
   - Alternatives rejected: unconstrained plane fit (can contradict
     Google's segment pitch on small faces), pre-smoothing only (panels
     still not coplanar).
2. **`smoothGrid`** — separable 3-tap `[0.25, 0.5, 0.25]` blur over the
   sampled heightfield grid, edge-clamped, N iterations (default 2).
   `buildHeightfieldGeometry` gains an optional `smoothIterations` param;
   the 3D component passes it for display. Underlying raster data is
   untouched.

`roof-scene-3d.tsx` switches from per-panel `buildPanelTransform` to the
batch `buildSegmentPlaneTransforms`, and passes `smoothIterations` when
building the terrain.

## Testing

- Plane fit: synthetic 20°-pitch plane raster with noise — all panel
  transforms on a segment end exactly coplanar (h + tan(pitch)·s constant),
  at the group pitch/azimuth; single-panel segments still work.
- Smoothing: flat grid unchanged; a spike is attenuated; overall mean
  approximately preserved; zero iterations is a no-op.
- Existing roof-scene-geometry tests stay green.

## Out of scope

- Changing panel positions or energy data (already regularized upstream).
- Higher-resolution terrain sources.
