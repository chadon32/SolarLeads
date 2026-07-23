# 3D Roof Model (Aurora-style) — Design

**Date:** 2026-07-16
**Status:** Approved

## Goal

Add an interactive 3D roof model to the rooftop analysis panel, comparable to Aurora Solar's scan view, using only data the app already pays for. No new API costs.

## Why this is possible for $0

The Google Solar API `dataLayers` response — already fetched by `/api/solar/data-layers` and proxied through `/api/solar/geotiff` — includes:

- **DSM** (Digital Surface Model): an elevation raster of the property at ~10–25 cm resolution
- **RGB**: orthorectified aerial imagery
- **Mask**: roof-pixel mask
- **Annual flux**: irradiance heatmap

`three`, `@react-three/fiber`, and `@react-three/drei` are already dependencies, and the client already parses GeoTIFFs with the `geotiff` package.

## User experience

- A third view-mode tab — **OVERVIEW | SUNLIGHT | 3D** — in the rooftop analysis panel.
- The 3D tab replaces the satellite map area with a Three.js scene:
  - Terrain heightfield built from the DSM, so the house and surroundings rise out of the ground in true 3D.
  - The aerial photo draped over the terrain as a texture.
  - Solar modules rendered as thin 3D boxes (dark crystalline glass, aluminum frame) positioned at Google's panel placements, tilted to segment pitch and rotated to segment azimuth.
  - Drag to orbit, scroll to zoom (OrbitControls with sane min/max distance and polar-angle clamps).
  - A "Sunlight" toggle repaints the roof pixels with the flux heatmap (photo remains everywhere else).
- The existing panel-count selection continues to control which modules render.
- 2D Overview and Sunlight tabs are untouched.

## Architecture

Three new files; one existing file lightly touched.

### 1. `src/lib/geotiff-utils.ts` (extraction)

Move `readGeoTiffRaster`, `getGeoTiffBounds`, and the `RasterData` type out of `solar-analysis.tsx` into a shared lib. Both the existing 2D heatmap code and the new 3D scene import from here. No behavior change.

### 2. `src/lib/roof-scene-geometry.ts` (pure math, unit-tested)

No WebGL, no DOM — fully testable with node:

- `estimateGroundElevationMeters(raster)` — low percentile (~5th) of valid DSM samples, so the terrain base sits at ground level and the house pops out.
- `latLngToLocalMeters(point, origin)` — equirectangular conversion to a local east/north meter frame centered on the roof.
- `sampleRasterBilinear(raster, width, height, bounds, lat, lng)` — bilinear DSM elevation lookup used for panel Z placement.
- `buildHeightfieldGeometry({ raster, width, height, bounds, cropBounds, maxGridSize })` — returns `positions` (Float32Array, x=east, y=up, z=south), `uvs` mapped against the RGB raster's geo-bounds, and triangle `indices`. Downsamples to ≤ ~192×192 vertices for performance. Clamps no-data pixels to ground level.
- `buildPanelTransform({ panel, panelWidthMeters, panelHeightMeters, origin, elevation })` — returns position (center offset to local meters, y from DSM sample + small standoff), heading rotation from azimuth, tilt from pitch, and full (non-foreshortened) module dimensions — the 3D tilt supplies the foreshortening naturally.

### 3. `src/components/roof-scene-3d.tsx` (client-only, lazy-loaded)

- Props: `dsmUrl`, `rgbUrl`, `fluxUrl`, `maskUrl`, `roofData`, `selectedPanelCount`, `showSunlight`.
- Loads and parses the GeoTIFFs (DSM + RGB always; flux + mask when the sunlight layer is on), builds `BufferGeometry` from the heightfield, and a `CanvasTexture` from the RGB raster.
- Sunlight mode: composites flux colors over the photo canvas only where the mask marks roof pixels.
- Modules: shared box geometry, dark glass top material with subtle env-style specular, aluminum edge color; per-panel group applies heading + tilt.
- Lighting: hemisphere + directional (sun angle roughly from the south for AZ), soft shadow under modules optional.
- States: loading spinner while parsing; friendly error card if layers are missing, fetch fails, or WebGL is unavailable.
- Imported with `next/dynamic` + `ssr: false` so the three.js chunk loads only when the tab is opened. Geometry/textures disposed on unmount.

### 4. `src/components/solar-analysis.tsx` (touch)

- `ViewMode` gains `"model3d"`; `viewModes` gains `{ id: "model3d", label: "3D" }`.
- When active, the map container renders the lazy 3D component instead of the Google Map; layer panel shows Panels + Sunlight toggles (roof-plane outlines are a 2D-only concept).
- Passes through the already-fetched `dsmUrl` / `rgbUrl` / flux/mask URLs and current `selectedPanelCount`.

## Error handling

| Failure | Behavior |
| --- | --- |
| `dataLayers` missing DSM or RGB | 3D tab renders "3D model unavailable for this address" card; 2D unaffected |
| GeoTIFF fetch/parse error | Same card + `console.warn`, no crash |
| WebGL unavailable | Same card with a device-support note |
| Flux/mask missing | Sunlight toggle hidden in 3D; photo drape still works |

## Testing

- Unit tests (`tests/roof-scene-geometry.test.ts`, existing `npm test` runner): ground-level estimation, local-meter conversion round-trip, bilinear sampling (known grid), heightfield dimensions/downsampling/UV range, panel transform (position, heading, tilt, dimensions).
- Manual: Mesa AZ address from the bug report — verify terrain, photo alignment, panel placement, sunlight toggle, orbit/zoom, tab switching both directions, and that Overview/Sunlight 2D views are unchanged.

## Out of scope (possible follow-ups)

- Panel grid regularization (snapping modules into perfect rows) — separate project.
- Shadow simulation / sun-path animation in 3D.
- Exporting 3D renders into the PDF report.
