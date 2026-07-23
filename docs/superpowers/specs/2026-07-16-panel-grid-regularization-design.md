# Panel Grid Regularization — Design

**Date:** 2026-07-16
**Status:** Approved

## Goal

Make the rendered panel array look like a professional installer layout — ruler-straight rows, uniform seams, one rotation per roof plane — in the 2D map, the 3D view, and the PDF report, without inventing placements the Google Solar API didn't produce.

## Problem

Solar API panel centers are ML-derived and noisy: centers wobble off-grid and per-panel rotation inference amplifies small errors, so the array reads as scattered confetti (see the 2026-07-16 Mesa screenshot report).

## Approach

A pure regularization pass over `solarPanels`, applied once where the analysis is built (server side), so every consumer inherits it.

New lib `src/lib/panel-layout.ts`:

1. **Group** panels by `(segmentIndex, orientation)`.
2. **Consensus azimuth** per group — circular mean of the per-panel rotations inferred by the existing neighbor-grid logic in `panel-geometry.ts`, oriented toward the segment azimuth. All modules in the group get exactly this azimuth.
3. **Project** centers into the plane's local frame: u = meters along azimuth, v = meters across.
4. **Cluster** rows by u (split when the gap exceeds half the along-spacing), columns within each row by v.
5. **Estimate lattice pitch from the data** — median consecutive spacing within clusters (bounded to 0.7–1.3× the nominal ground-projected module size), so Google's actual packing is preserved.
6. **Snap** with least squares: assign integer lattice indices, fit the lattice origin, place each module exactly on the lattice. Rows may stagger independently (hip/trapezoid planes); within a row spacing is uniform.
7. **Safety clamp** — if any module in a group would move more than 0.6 m from its API position, the whole group reverts to the original placements. We align, we don't relocate.

Output panels keep all original fields (energy, indices, pitch) with updated `center` and `azimuthDeg`.

## Integration

- Called from the server-side analysis build path so the 2D map, 3D scene, PDF report, and report snapshots all render the same regularized layout.
- 2D rendering needs no changes: `inferPanelRotationDeg` on a perfect grid returns the consensus axis.
- 3D rendering needs no changes: it reads `panel.azimuthDeg`, which now carries the consensus value.
- Honesty copy: legend line becomes "Photovoltaic modules — aligned to rack grid from Google Solar API positions."

## Testing

- Unit tests (`tests/panel-layout.test.ts`):
  - Jittered synthetic grid (±0.15 m noise, ±4° rotation noise) snaps back to an exact uniform grid.
  - Staggered two-row trapezoid layout keeps its stagger but gets uniform in-row spacing.
  - A group with an outlier beyond the clamp reverts untouched.
  - Mixed-orientation segment regularizes each orientation independently.
  - Energy/order fields pass through unchanged.
- Manual: Mesa AZ address — before/after comparison in 2D and 3D.

## Out of scope

- Adding or removing panels, fire-setback enforcement, electrical stringing — installer domain.
