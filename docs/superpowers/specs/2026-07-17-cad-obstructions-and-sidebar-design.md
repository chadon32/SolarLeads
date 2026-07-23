# CAD View Phases 2 & 3 — Obstructions + Design Sidebar

**Date:** 2026-07-17
**Status:** Approved

Continues the Aurora-style CAD 3D view. Phase 1 delivered extruded roof
faces + irradiance gradient. This adds roof obstruction markers (Phase 2)
and a module design sidebar (Phase 3).

## Phase 2 — obstruction markers

`RoofAnalysis.obstructionOutlines` are normalized roof-relative polygons
marking detected low-sun / shading zones on the roof (the same data the 2D
map draws as translucent gray polygons). We do NOT have detected tree or
vent positions, so — per the project honesty guardrail — we render these
as honest "shading obstruction" markers, not fabricated trees.

- New pure helper `buildObstructionMarkerGeometry({ outline, origin,
  raster, ..., heightMeters })` in `roof-scene-geometry.ts`: projects the
  outline to the local frame, fits a flat top height from the DSM at the
  outline's vertices/centroid (reusing `sampleRasterBilinear`), raises it
  by a small `heightMeters` (~0.6 m), and returns a top face (ear-clipped)
  plus short wall skirts from top down to the roof — a low prism sitting on
  the roof.
- Rendered as translucent slate-gray volumes. A small legend chip notes
  "Shading obstruction (detected)".
- Degrades to nothing when `obstructionOutlines` is empty (common).

## Phase 3 — module design sidebar

A floating panel on the right of the 3D viewport (only in 3D mode),
echoing Aurora's SOLAR PANEL panel:

- **Module picker** — a `<select>` of `SOLAR_PANELS` (brand + watts). On
  change, calls a new `onSelectedPanelIdChange` prop.
- **Specs readout** — selected module dimensions, wattage, efficiency,
  tier; plus system size = rendered panel count × module watts / 1000.
- Non-destructive: reuses the existing `selectedPanel` /
  `selectedPanelId` state already lifted in `home-client.tsx`.

### Wiring

`home-client.tsx` already owns `selectedPanelId` / `setSelectedPanelId`.
Thread a new optional `onSelectedPanelIdChange` prop down:
`HomeClient` → `SolarAnalysis` → `ViewportCanvas` → the 3D overlay. The
picker only shows when the handler is provided and the view is 3D.

## Testing

- Unit: `buildObstructionMarkerGeometry` returns a top face on the fitted
  plane at the raised height, with wall skirts, and null for degenerate
  outlines.
- Manual: Mesa address — obstruction markers appear on shaded roofs; the
  sidebar switches modules and updates specs + system size live.

## Out of scope

- Detected tree/vent identification (no data source).
- Tilt/rotation editing (arrays come pre-placed from the Solar API).
