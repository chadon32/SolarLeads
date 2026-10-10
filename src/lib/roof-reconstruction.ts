/**
 * Coherent roof reconstruction from the Solar API rasters the 3D view already
 * downloads (DSM + rooftop mask on one grid).
 *
 * The old view extruded each segment's panel-slot hull to the ground as its
 * own prism, so ridges became gaps and unpanelled wings vanished. Here:
 *
 * 1. Isolate the building: the mask component holding the panel slots, plus
 *    the eave ring the rooftop mask erodes away (~1 m).
 * 2. Label roof pixels with planes — panel-fitted segment planes first (so
 *    modules stay flush), then RANSAC for faces without panels.
 * 3. Classify adjacent plane pairs: convex (ridge/hip → lower envelope),
 *    concave (valley → upper envelope) or step (keep the pixel boundary).
 * 4. Evaluate an upsampled surface grid, so ridges and valleys land on the
 *    true plane intersections instead of the pixel staircase; snap boundary
 *    vertices to the simplified footprint so eaves are straight.
 * 5. Add a fascia band along the roof edge and walls inset under the eave.
 *
 * Every threshold is in metres, so 0.25 m and 0.5 m rasters behave the same.
 * Pure (no three.js, no DOM): it runs in a Web Worker unchanged.
 */
import type { RoofGeoBounds, SolarPanelPlacement } from "@/lib/roof-analysis";
import { regionWidthPixels, simplifyClosedLoop, traceRasterLoops, type Point } from "@/lib/raster-outline";
import { latLngToLocalMeters, type LatLng, type SegmentPlane } from "@/lib/roof-scene-geometry";

export type RasterGrid = { raster: ArrayLike<number>; width: number; height: number; bounds: RoofGeoBounds };
export type RoofPairType = "convex" | "concave" | "step";

export type RoofFace = {
  id: number;
  /** Solar API segment index when the face is a panel-fitted plane. */
  segmentIndex: number | null;
  pitchDeg: number;
  /** Downslope direction, degrees clockwise from north. */
  azimuthDeg: number;
  /** Sloped area. */
  areaM2: number;
  centroid: { x: number; y: number; z: number };
};

export type RoofObstruction = { x: number; z: number; widthM: number; depthM: number; baseM: number; topM: number };

export type RoofReconstruction = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Triangles (into `positions`) forming steps between roof levels. */
  cliffIndices: Uint32Array;
  /** Face id for each triangle in `indices`. */
  triangleFaces: Uint16Array;
  /** Non-indexed, outward-wound wall triangles. */
  wallPositions: Float32Array;
  /** Non-indexed fascia band along the roof edge. */
  fasciaPositions: Float32Array;
  /** Ridge, hip and valley lines (xyz, xyz pairs) — exact plane intersections. */
  creaseLines: Float32Array;
  /** Roof outline at the eaves (xyz, xyz pairs). */
  eaveLines: Float32Array;
  faces: RoofFace[];
  obstructions: RoofObstruction[];
  /** 1 for pixels of the rebuilt building (DSM grid). */
  roofPixels: Uint8Array;
  /** Face id per pixel, −1 off the roof. */
  pixelFaces: Int16Array;
  pairTypes: Record<string, RoofPairType>;
  maxHeightMeters: number;
  pixelSizeMeters: number;
};

export type RoofReconstructionInput = {
  dsm: RasterGrid;
  mask: RasterGrid;
  panels: SolarPanelPlacement[];
  /** From `fitSegmentPlanes` — the planes the panel transforms use. */
  segmentPlanes: Map<number, SegmentPlane>;
  origin: LatLng;
  groundElevationMeters: number;
  cellSizeMeters?: number;
  eaveOverhangMeters?: number;
};

/** h(x, z) = a·x + b·z + c in local metres above the ground datum. */
type Plane = { a: number; b: number; c: number };

const PLANE_TOLERANCE_M = 0.3;
/** Max difference between a pixel's DSM slope vector and a plane's (rise/run). */
const SLOPE_TOLERANCE = 0.18;
/** Half-baseline for DSM slope estimates. */
const SLOPE_BASELINE_M = 0.5;
const MIN_FACE_AREA_M2 = 2;
/** RANSAC regions thinner than this are ridge/valley strips, not faces. */
const MIN_FACE_WIDTH_M = 1.2;
const EAVE_RING_M = 1;
/** Eave pixels may sit this far below their face (gutter drop), never above it. */
const EAVE_DROP_M = 0.6;
const OBSTRUCTION_MIN_M = 0.35;
const OBSTRUCTION_MAX_M = 3;
const RANSAC_SAMPLE_RADIUS_M = 2;
const RANSAC_ITERATIONS = 250;
const RANSAC_ROUNDS = 16;
const RANSAC_COUNT_SAMPLES = 1_500;
const ENVELOPE_RADIUS_M = 1;
const PAIR_GAP_M = 0.45;
const OUTLINE_TOLERANCE_M = 0.45;
const SOFFIT_DROP_M = 0.25;
const FASCIA_DEPTH_M = 0.22;
const MIN_WALL_TOP_M = 0.3;
/** A surface cell rising more than this across its corners is a step, not roof. */
const CLIFF_RISE_M = 0.35;

export function reconstructRoof({
  dsm,
  mask,
  panels,
  segmentPlanes,
  origin,
  groundElevationMeters,
  cellSizeMeters = 0.125,
  eaveOverhangMeters = 0.4,
}: RoofReconstructionInput): RoofReconstruction | null {
  const W = dsm.width;
  const H = dsm.height;
  const N = W * H;
  if (mask.width !== W || mask.height !== H || W < 3 || H < 3) return null;

  // Pixel-edge coordinates (px, py) map linearly onto local metres.
  const nw = latLngToLocalMeters({ lat: dsm.bounds.northeast.lat, lng: dsm.bounds.southwest.lng }, origin);
  const se = latLngToLocalMeters({ lat: dsm.bounds.southwest.lat, lng: dsm.bounds.northeast.lng }, origin);
  const dx = (se.x - nw.x) / W;
  const dz = (se.z - nw.z) / H;
  const pixelSize = (Math.abs(dx) + Math.abs(dz)) / 2;
  if (!(pixelSize > 0)) return null;
  const toPx = (meters: number) => meters / pixelSize;
  const xAt = (px: number) => nw.x + px * dx;
  const zAt = (py: number) => nw.z + py * dz;
  const evalPlane = (plane: Plane, px: number, py: number) => plane.a * xAt(px) + plane.b * zAt(py) + plane.c;

  const heights = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const value = Number(dsm.raster[i]);
    heights[i] = Number.isFinite(value) && value > -1000 && value < 9000 ? value - groundElevationMeters : Number.NaN;
  }
  const residualOf = (plane: Plane, i: number) => heights[i] - evalPlane(plane, (i % W) + 0.5, ((i / W) | 0) + 0.5);

  // ---- 1. The building that holds the panel slots ----
  const component = new Int32Array(N).fill(-1);
  let components = 0;
  for (let start = 0; start < N; start++) {
    if (component[start] !== -1 || !(Number(mask.raster[start]) > 0)) continue;
    const stack = [start];
    component[start] = components;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (y > 0) visit(p - W);
      if (y < H - 1) visit(p + W);
    }
    components++;
    function visit(q: number) {
      if (component[q] === -1 && Number(mask.raster[q]) > 0) {
        component[q] = components;
        stack.push(q);
      }
    }
  }
  const pixelOf = (point: LatLng) => {
    const local = latLngToLocalMeters(point, origin);
    const col = Math.floor((local.x - nw.x) / dx);
    const row = Math.floor((local.z - nw.z) / dz);
    return col >= 0 && row >= 0 && col < W && row < H ? row * W + col : -1;
  };
  const votes = new Map<number, number>();
  for (const panel of panels) {
    const i = pixelOf(panel.center);
    if (i >= 0 && component[i] >= 0) votes.set(component[i], (votes.get(component[i]) ?? 0) + 1);
  }
  const target = [...votes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (target === undefined) return null;
  const inMask = (i: number) => component[i] === target && Number.isFinite(heights[i]);
  const pixels: number[] = [];
  for (let i = 0; i < N; i++) if (inMask(i)) pixels.push(i);
  const minFacePixels = Math.max(3, Math.ceil(MIN_FACE_AREA_M2 / (pixelSize * pixelSize)));
  if (pixels.length < minFacePixels) return null;

  // The rooftop mask is conservative; ring pixels may join a face that fits them.
  const ring = new Uint8Array(N);
  const ringPx = Math.max(1, Math.round(toPx(EAVE_RING_M)));
  for (const i of pixels) {
    const x = i % W, y = (i / W) | 0;
    for (let oy = -ringPx; oy <= ringPx; oy++) {
      for (let ox = -ringPx; ox <= ringPx; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (component[q] === -1 && Number.isFinite(heights[q]) && heights[q] > 1.2) ring[q] = 1;
      }
    }
  }
  const claimable = (i: number) => inMask(i) || ring[i] === 1;

  // Local DSM slope where the whole baseline sits on the building. Height
  // alone is not enough: an extended plane can cross another face along a
  // line where their heights coincide, and region growing would leak along
  // it (an L-shaped wing's plane stealing the main roof's face).
  const slopeStep = Math.max(1, Math.round(toPx(SLOPE_BASELINE_M)));
  const slopeX = new Float32Array(N);
  const slopeZ = new Float32Array(N);
  const slopeKnown = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!claimable(i)) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < slopeStep || y < slopeStep || x >= W - slopeStep || y >= H - slopeStep) continue;
    const left = i - slopeStep, right = i + slopeStep, up = i - slopeStep * W, down = i + slopeStep * W;
    if (!claimable(left) || !claimable(right) || !claimable(up) || !claimable(down)) continue;
    slopeX[i] = (heights[right] - heights[left]) / (2 * slopeStep * dx);
    slopeZ[i] = (heights[down] - heights[up]) / (2 * slopeStep * dz);
    slopeKnown[i] = Number.isFinite(slopeX[i]) && Number.isFinite(slopeZ[i]) ? 1 : 0;
  }
  const fitsPlane = (plane: Plane, i: number) =>
    Math.abs(residualOf(plane, i)) < PLANE_TOLERANCE_M &&
    (!slopeKnown[i] || Math.hypot(slopeX[i] - plane.a, slopeZ[i] - plane.b) < SLOPE_TOLERANCE);

  // ---- 2. Plane labels ----
  const planes: Plane[] = [];
  const planeSegment: Array<number | null> = [];
  const label = new Int32Array(N).fill(-1);
  const grow = (seeds: number[], plane: Plane, allowed: (i: number) => boolean) => {
    const seen = new Uint8Array(N);
    const region: number[] = [];
    const stack = seeds.filter((seed) => allowed(seed) && Math.abs(residualOf(plane, seed)) < PLANE_TOLERANCE_M * 2);
    for (const seed of stack) seen[seed] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x > 0) consider(p - 1);
      if (x < W - 1) consider(p + 1);
      if (y > 0) consider(p - W);
      if (y < H - 1) consider(p + W);
    }
    return region;
    function consider(q: number) {
      if (seen[q] || !allowed(q)) return;
      seen[q] = 1;
      if (fitsPlane(plane, q)) stack.push(q);
    }
  };

  // 2a. Panel-fitted planes win their region.
  const bestResidual = new Float32Array(N).fill(Number.POSITIVE_INFINITY);
  for (const [segmentIndex, segmentPlane] of segmentPlanes) {
    const tanPitch = Math.tan((segmentPlane.pitchDeg * Math.PI) / 180);
    const azimuth = (segmentPlane.azimuthDeg * Math.PI) / 180;
    const plane: Plane = { a: -tanPitch * Math.sin(azimuth), b: tanPitch * Math.cos(azimuth), c: segmentPlane.planeOffsetMeters };
    const seeds = panels
      .filter((panel) => panel.segmentIndex === segmentIndex)
      .map((panel) => pixelOf(panel.center))
      .filter((i) => i >= 0 && inMask(i));
    const region = grow(seeds, plane, claimable);
    if (region.length < minFacePixels) continue;
    const id = planes.push(plane) - 1;
    planeSegment[id] = segmentIndex;
    for (const i of region) {
      const residual = Math.abs(residualOf(plane, i));
      if (residual < bestResidual[i]) {
        bestResidual[i] = residual;
        label[i] = id;
      }
    }
  }

  // 2b. RANSAC for faces without panels (hips, wings, porches).
  const random = mulberry32(0x5eed);
  const rejected = new Uint8Array(N);
  const free = (i: number) => inMask(i) && label[i] === -1;
  const sampleRadius = Math.max(2, Math.round(toPx(RANSAC_SAMPLE_RADIUS_M)));
  const nearbyFree = (seed: number) => {
    const x = seed % W, y = (seed / W) | 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      const nx = x + Math.round((random() * 2 - 1) * sampleRadius);
      const ny = y + Math.round((random() * 2 - 1) * sampleRadius);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (q !== seed && free(q)) return q;
    }
    return -1;
  };
  const regionWidthMeters = (region: number[]) => regionWidthPixels(region, W) * pixelSize;
  const fitPlane = (region: number[]): Plane | null => {
    let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sh = 0, sxh = 0, szh = 0, n = 0;
    for (const i of region) {
      const h = heights[i];
      if (!Number.isFinite(h)) continue;
      const x = xAt((i % W) + 0.5), z = zAt(((i / W) | 0) + 0.5);
      sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; sh += h; sxh += x * h; szh += z * h; n++;
    }
    if (n < 3) return null;
    const solved = solve3([[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], [sxh, szh, sh]);
    return solved ? { a: solved[0], b: solved[1], c: solved[2] } : null;
  };
  for (let round = 0; round < RANSAC_ROUNDS; round++) {
    const pool = pixels.filter((i) => free(i) && !rejected[i]);
    if (pool.length < minFacePixels) break;
    const stride = Math.max(1, Math.floor(pool.length / RANSAC_COUNT_SAMPLES));
    let best: { plane: Plane; inliers: number; seed: number } | null = null;
    for (let iteration = 0; iteration < RANSAC_ITERATIONS; iteration++) {
      const seed = pool[Math.floor(random() * pool.length)];
      const sample = [seed, nearbyFree(seed), nearbyFree(seed)];
      if (sample.some((i) => i < 0) || new Set(sample).size < 3) continue;
      const plane = fitPlane(sample);
      if (!plane || Math.hypot(plane.a, plane.b) > 1.2) continue; // steeper than ~50°: wall noise
      let inliers = 0;
      for (let k = 0; k < pool.length; k += stride) if (fitsPlane(plane, pool[k])) inliers++;
      if (!best || inliers > best.inliers) best = { plane, inliers, seed };
    }
    if (!best || best.inliers * stride < minFacePixels) break;
    const first = grow([best.seed], best.plane, free);
    const refined = first.length >= 3 ? fitPlane(first) : null;
    const region = refined ? grow([best.seed], refined, free) : first;
    const finalPlane = region.length >= 3 ? fitPlane(region) : null;
    if (!finalPlane || region.length < minFacePixels || regionWidthMeters(region) < MIN_FACE_WIDTH_M) {
      for (const i of first) rejected[i] = 1;
      rejected[best.seed] = 1;
      continue;
    }
    const id = planes.push(finalPlane) - 1;
    planeSegment[id] = null;
    for (const i of region) label[i] = id;
  }

  // 2b'. A face split by a narrow neck comes back from RANSAC as coplanar
  // fragments; fold each RANSAC plane into an earlier plane it duplicates.
  const merged = planes.map((_, id) => id);
  for (let id = 0; id < planes.length; id++) {
    if (planeSegment[id] !== null) continue;
    let count = 0, sumX = 0, sumZ = 0;
    for (const i of pixels) {
      if (label[i] !== id) continue;
      count++;
      sumX += (i % W) + 0.5;
      sumZ += ((i / W) | 0) + 0.5;
    }
    if (!count) continue;
    const cx = sumX / count, cz = sumZ / count;
    for (let other = 0; other < id; other++) {
      if (merged[other] !== other) continue;
      const a = planes[id], b = planes[other];
      if (Math.abs(a.a - b.a) < 0.04 && Math.abs(a.b - b.b) < 0.04 && Math.abs(evalPlane(a, cx, cz) - evalPlane(b, cx, cz)) < 0.15) {
        merged[id] = other;
        break;
      }
    }
  }
  for (const i of pixels) if (label[i] >= 0) label[i] = merged[label[i]];

  // 2c. Leftovers join the best-fitting neighbouring face.
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    for (const i of pixels) {
      if (label[i] !== -1) continue;
      const x = i % W, y = (i / W) | 0;
      let bestId = -1, bestFit = Number.POSITIVE_INFINITY;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const id = label[ny * W + nx];
          if (id < 0) continue;
          const fit = Math.abs(residualOf(planes[id], i));
          if (fit < bestFit) {
            bestFit = fit;
            bestId = id;
          }
        }
      }
      if (bestId >= 0) {
        label[i] = bestId;
        changed++;
      }
    }
    if (!changed) break;
  }
  if (!planes.length) return null;

  // 2d. The eave ring: a ring pixel's slope window reaches the blended
  // roof/ground pixel beyond it, so absorb ring pixels touching the roof by
  // height alone.
  for (let pass = 0; pass < ringPx; pass++) {
    const additions: Array<[number, number]> = [];
    for (let i = 0; i < N; i++) {
      if (!ring[i] || label[i] >= 0) continue;
      const x = i % W, y = (i / W) | 0;
      let bestId = -1, bestFit = Number.POSITIVE_INFINITY;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const id = label[ny * W + nx];
          if (id < 0) continue;
          const residual = residualOf(planes[id], i);
          if (residual > -EAVE_DROP_M && residual < PLANE_TOLERANCE_M && Math.abs(residual) < bestFit) {
            bestFit = Math.abs(residual);
            bestId = id;
          }
        }
      }
      if (bestId >= 0) additions.push([i, bestId]);
    }
    if (!additions.length) break;
    for (const [i, id] of additions) label[i] = id;
  }

  // ---- Footprint: labelled pixels, closed to remove one-pixel notches ----
  const labelled = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (claimable(i) && label[i] >= 0) labelled[i] = 1;
  const closeRadius = Math.max(1, Math.round(toPx(0.5)));
  let footprint = labelled;
  for (let pass = 0; pass < closeRadius; pass++) footprint = dilate(footprint, W, H);
  for (let pass = 0; pass < closeRadius; pass++) footprint = erode(footprint, W, H);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let i = 0; i < N; i++) {
    if (!footprint[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (!labelled[i]) {
      // Pixels added by the closing inherit a neighbouring face.
      let inherited = -1;
      for (let radius = 1; radius <= closeRadius + 1 && inherited < 0; radius++) {
        for (let oy = -radius; oy <= radius && inherited < 0; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (labelled[q]) {
              inherited = label[q];
              break;
            }
          }
        }
      }
      if (inherited < 0) {
        footprint[i] = 0;
        continue;
      }
      label[i] = inherited;
      heights[i] = evalPlane(planes[inherited], x + 0.5, y + 0.5);
    }
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return null;
  const inFoot = (i: number) => footprint[i] === 1;

  // ---- Real obstructions: interior pixels standing clearly above their own face ----
  const obstruction = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!inFoot(i)) continue;
    const x = i % W, y = (i / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
    let interior = true;
    for (let oy = -1; oy <= 1 && interior; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const q = (y + oy) * W + x + ox;
        if (!inFoot(q) || label[q] !== label[i]) {
          interior = false;
          break;
        }
      }
    }
    const rise = residualOf(planes[label[i]], i);
    if (interior && rise > OBSTRUCTION_MIN_M && rise < OBSTRUCTION_MAX_M) obstruction[i] = 1;
  }
  const obstructions = collectObstructions();

  // ---- 3. Pair relations from shared boundaries ----
  const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const pairStats = new Map<string, { a: number; b: number; gaps: number[]; convex: number; concave: number; midpoints: Point[] }>();
  for (let i = 0; i < N; i++) {
    if (!inFoot(i) || obstruction[i]) continue;
    const a = label[i];
    const x = i % W, y = (i / W) | 0;
    for (const j of [x < W - 1 ? i + 1 : -1, y < H - 1 ? i + W : -1]) {
      if (j < 0 || !inFoot(j) || obstruction[j] || label[j] === a) continue;
      const b = label[j];
      const ix = x + 0.5, iy = y + 0.5, jx = (j % W) + 0.5, jy = ((j / W) | 0) + 0.5;
      const mx = (ix + jx) / 2, my = (iy + jy) / 2;
      const stats = pairStats.get(pairKey(a, b)) ?? { a: Math.min(a, b), b: Math.max(a, b), gaps: [], convex: 0, concave: 0, midpoints: [] };
      stats.midpoints.push([mx, my]);
      stats.gaps.push(Math.abs(evalPlane(planes[a], mx, my) - evalPlane(planes[b], mx, my)));
      const bAboveAtI = evalPlane(planes[b], ix, iy) > evalPlane(planes[a], ix, iy);
      const aAboveAtJ = evalPlane(planes[a], jx, jy) > evalPlane(planes[b], jx, jy);
      if (bAboveAtI && aAboveAtJ) stats.convex++;
      else if (!bAboveAtI && !aAboveAtJ) stats.concave++;
      pairStats.set(pairKey(a, b), stats);
    }
  }
  const pairTypes: Record<string, RoofPairType> = {};
  for (const [key, stats] of pairStats) {
    stats.gaps.sort((l, r) => l - r);
    const medianGap = stats.gaps[Math.floor(stats.gaps.length / 2)];
    pairTypes[key] = medianGap < PAIR_GAP_M ? (stats.convex >= stats.concave ? "convex" : "concave") : "step";
  }

  // Ridges, hips and valleys as the straight intersection of their two
  // planes, spanning the stretch where the faces actually meet. Drawn as CAD
  // lines; lifted a little because the gridded surface sags across valleys.
  const creases: number[] = [];
  for (const [key, stats] of pairStats) {
    if (pairTypes[key] === "step" || stats.midpoints.length < 3) continue;
    const A = planes[stats.a], B = planes[stats.b];
    const nx = A.a - B.a, nz = A.b - B.b;
    const n2 = nx * nx + nz * nz;
    if (n2 < 1e-6) continue;
    const p0x = (-(A.c - B.c) * nx) / n2, p0z = (-(A.c - B.c) * nz) / n2;
    const length = Math.sqrt(n2);
    const tx = -nz / length, tz = nx / length;
    const along = stats.midpoints.map(([mx, my]) => (xAt(mx) - p0x) * tx + (zAt(my) - p0z) * tz).sort((l, r) => l - r);
    const from = along[Math.floor(along.length * 0.02)] - pixelSize / 2;
    const to = along[Math.min(along.length - 1, Math.ceil(along.length * 0.98) - 1)] + pixelSize / 2;
    for (const s of [from, to]) {
      const x = p0x + s * tx, z = p0z + s * tz;
      creases.push(x, A.a * x + A.b * z + A.c + 0.03, z);
    }
  }

  // ---- 4. Footprint polygon (marching squares + Douglas–Peucker) ----
  const loops = traceRasterLoops((x, y) => x >= 0 && y >= 0 && x < W && y < H && inFoot(y * W + x), minX - 1, minY - 1, maxX + 1, maxY + 1)
    .map((loop) => simplifyClosedLoop(loop, toPx(OUTLINE_TOLERANCE_M)))
    .filter((loop) => loop.length >= 3);
  if (!loops.length) return null;
  const insideFootprint = ([px, py]: Point) => {
    let inside = false;
    for (const loop of loops) {
      for (let k = 0, m = loop.length - 1; k < loop.length; m = k++) {
        const [xk, yk] = loop[k], [xm, ym] = loop[m];
        if (yk > py !== ym > py && px < ((xm - xk) * (py - yk)) / (ym - yk) + xk) inside = !inside;
      }
    }
    return inside;
  };
  const nearestOnFootprint = ([px, py]: Point): { point: Point; distance: number } => {
    let point: Point = [px, py], best = Number.POSITIVE_INFINITY;
    for (const loop of loops) {
      for (let k = 0, m = loop.length - 1; k < loop.length; m = k++) {
        const [ax, ay] = loop[m], [bx, by] = loop[k];
        const lx = bx - ax, ly = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * lx + (py - ay) * ly) / (lx * lx + ly * ly || 1e-12)));
        const cx = ax + t * lx, cy = ay + t * ly;
        const d = Math.hypot(cx - px, cy - py);
        if (d < best) {
          best = d;
          point = [cx, cy];
        }
      }
    }
    return { point, distance: best };
  };

  // ---- Surface evaluation with ridge/valley envelopes ----
  const searchPx = Math.max(2, Math.ceil(toPx(1.5)));
  const envelopePx = Math.max(1, Math.ceil(toPx(ENVELOPE_RADIUS_M)));
  const nearestFootprintPixel = (px: number, py: number) => {
    const cx = Math.floor(px), cy = Math.floor(py);
    for (let radius = 0; radius <= searchPx; radius++) {
      let best = -1, bestD = Number.POSITIVE_INFINITY;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;
          const x = cx + ox, y = cy + oy;
          if (x < 0 || y < 0 || x >= W || y >= H || !inFoot(y * W + x)) continue;
          const d = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2;
          if (d < bestD) {
            bestD = d;
            best = y * W + x;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const surfaceAt = (px: number, py: number): { height: number; face: number } => {
    const nearest = nearestFootprintPixel(px, py);
    if (nearest < 0) return { height: 0.05, face: -1 };
    let current = label[nearest];
    const cx = Math.floor(px), cy = Math.floor(py);
    const candidates = new Set<number>();
    for (let oy = -envelopePx; oy <= envelopePx; oy++) {
      for (let ox = -envelopePx; ox <= envelopePx; ox++) {
        const x = cx + ox, y = cy + oy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (inFoot(i) && !obstruction[i]) candidates.add(label[i]);
      }
    }
    for (const candidate of candidates) {
      if (candidate === current) continue;
      const type = pairTypes[pairKey(current, candidate)];
      if (!type || type === "step") continue;
      const candidateHeight = evalPlane(planes[candidate], px, py);
      const currentHeight = evalPlane(planes[current], px, py);
      if ((type === "convex" && candidateHeight < currentHeight) || (type === "concave" && candidateHeight > currentHeight)) current = candidate;
    }
    return { height: Math.max(0.05, evalPlane(planes[current], px, py)), face: current };
  };

  // ---- 5. Upsampled surface grid ----
  const F = Math.max(1, Math.round(pixelSize / cellSizeMeters));
  const bx = minX - 1, by = minY - 1;
  const cellsX = (maxX - minX + 3) * F;
  const cellsY = (maxY - minY + 3) * F;
  const included = scanlineFill(loops, bx, by, F, cellsX, cellsY);
  const cellIncluded = (i: number, j: number) => i >= 0 && j >= 0 && i < cellsX && j < cellsY && included[j * cellsX + i] === 1;

  const stride = cellsX + 1;
  const vertexIndex = new Int32Array(stride * (cellsY + 1)).fill(-1);
  const positions: number[] = [];
  const uvs: number[] = [];
  const vertexAt = (u: number, v: number) => {
    const key = v * stride + u;
    if (vertexIndex[key] >= 0) return vertexIndex[key];
    let point: Point = [bx + u / F, by + v / F];
    const around = [cellIncluded(u - 1, v - 1), cellIncluded(u, v - 1), cellIncluded(u - 1, v), cellIncluded(u, v)];
    if (around.some(Boolean) && !around.every(Boolean)) {
      const snapped = nearestOnFootprint(point);
      if (snapped.distance <= 1.5 / F) point = snapped.point;
    }
    vertexIndex[key] = positions.length / 3;
    positions.push(xAt(point[0]), surfaceAt(point[0], point[1]).height, zAt(point[1]));
    uvs.push(point[0] / W, 1 - point[1] / H);
    return vertexIndex[key];
  };

  const indices: number[] = [];
  const cliffIndices: number[] = [];
  const triangleFaces: number[] = [];
  const fascia: number[] = [];
  const pushBand = (target: number[], a: number, b: number, depthOf: (vertex: number) => number) => {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bxp = positions[b * 3], byp = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    if (Math.hypot(bxp - ax, bz - az) < 1e-4) return; // collapsed by snapping
    const aBottom = ay - depthOf(a), bBottom = byp - depthOf(b);
    target.push(ax, ay, az, bxp, byp, bz, bxp, bBottom, bz, ax, ay, az, bxp, bBottom, bz, ax, aBottom, az);
    eaves.push(ax, ay, az, bxp, byp, bz);
  };
  const eaves: number[] = [];
  const fasciaDepth = () => FASCIA_DEPTH_M;
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      if (!cellIncluded(i, j)) continue;
      const tl = vertexAt(i, j), tr = vertexAt(i + 1, j), bl = vertexAt(i, j + 1), br = vertexAt(i + 1, j + 1);
      const cornerHeights = [tl, tr, bl, br].map((vertex) => positions[vertex * 3 + 1]);
      if (Math.max(...cornerHeights) - Math.min(...cornerHeights) > CLIFF_RISE_M) {
        // A step between roof levels: drawn as wall, not as roof surface.
        cliffIndices.push(tl, bl, tr, tr, bl, br);
      } else {
        indices.push(tl, bl, tr, tr, bl, br);
        const face = surfaceAt(bx + (i + 0.5) / F, by + (j + 0.5) / F).face;
        triangleFaces.push(face, face);
      }
      // Exposed cell edges, walked so each band's front face points outward.
      if (!cellIncluded(i, j - 1)) pushBand(fascia, tl, tr, fasciaDepth);
      if (!cellIncluded(i, j + 1)) pushBand(fascia, br, bl, fasciaDepth);
      if (!cellIncluded(i - 1, j)) pushBand(fascia, bl, tl, fasciaDepth);
      if (!cellIncluded(i + 1, j)) pushBand(fascia, tr, br, fasciaDepth);
    }
  }

  // ---- Walls inset under the eave overhang ----
  const walls: number[] = [];
  const insetPx = toPx(eaveOverhangMeters);
  const wallStep = Math.max(0.25, toPx(cellSizeMeters));
  const wallTop = (point: Point) => Math.max(MIN_WALL_TOP_M, surfaceAt(point[0], point[1]).height - SOFFIT_DROP_M);
  for (const loop of loops) {
    const inset = insetLoop(loop, insetPx);
    for (let k = 0; k < inset.length; k++) {
      const p = inset[k], q = inset[(k + 1) % inset.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / wallStep));
      for (let s = 0; s < steps; s++) {
        const a: Point = [p[0] + ((q[0] - p[0]) * s) / steps, p[1] + ((q[1] - p[1]) * s) / steps];
        const b: Point = [p[0] + ((q[0] - p[0]) * (s + 1)) / steps, p[1] + ((q[1] - p[1]) * (s + 1)) / steps];
        const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // Skip collapsed or inverted stretches where the footprint is narrower than the overhang.
        if (!insideFootprint(mid) || nearestOnFootprint(mid).distance < insetPx * 0.5) continue;
        const [ax, az, bxw, bzw] = [xAt(a[0]), zAt(a[1]), xAt(b[0]), zAt(b[1])];
        const [aTop, bTop] = [wallTop(a), wallTop(b)];
        walls.push(ax, aTop, az, bxw, bTop, bzw, bxw, 0, bzw, ax, aTop, az, bxw, 0, bzw, ax, 0, az);
      }
    }
  }

  // ---- Faces ----
  const pixelFaces = new Int16Array(N).fill(-1);
  const faceStats = planes.map(() => ({ count: 0, sumX: 0, sumZ: 0 }));
  for (let i = 0; i < N; i++) {
    if (!inFoot(i)) continue;
    pixelFaces[i] = label[i];
    const stats = faceStats[label[i]];
    stats.count++;
    stats.sumX += xAt((i % W) + 0.5);
    stats.sumZ += zAt(((i / W) | 0) + 0.5);
  }
  const faces: RoofFace[] = [];
  planes.forEach((plane, id) => {
    const stats = faceStats[id];
    if (!stats.count) return;
    const slope = Math.hypot(plane.a, plane.b);
    const pitchDeg = (Math.atan(slope) * 180) / Math.PI;
    const azimuthDeg = slope > 1e-6 ? (((Math.atan2(-plane.a, plane.b) * 180) / Math.PI) + 360) % 360 : 180;
    const x = stats.sumX / stats.count, z = stats.sumZ / stats.count;
    faces.push({
      id,
      segmentIndex: planeSegment[id] ?? null,
      pitchDeg,
      azimuthDeg,
      areaM2: (stats.count * pixelSize * pixelSize) / Math.cos(Math.atan(slope)),
      centroid: { x, y: plane.a * x + plane.b * z + plane.c, z },
    });
  });

  let maxHeightMeters = 0;
  for (let k = 1; k < positions.length; k += 3) maxHeightMeters = Math.max(maxHeightMeters, positions[k]);

  return {
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    cliffIndices: Uint32Array.from(cliffIndices),
    triangleFaces: Uint16Array.from(triangleFaces.map((face) => Math.max(0, face))),
    wallPositions: Float32Array.from(walls),
    fasciaPositions: Float32Array.from(fascia),
    creaseLines: Float32Array.from(creases),
    eaveLines: Float32Array.from(eaves),
    faces,
    obstructions,
    roofPixels: footprint,
    pixelFaces,
    pairTypes,
    maxHeightMeters,
    pixelSizeMeters: pixelSize,
  };

  function collectObstructions(): RoofObstruction[] {
    const seen = new Uint8Array(N);
    const found: RoofObstruction[] = [];
    for (let start = 0; start < N; start++) {
      if (!obstruction[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      let x0 = W, y0 = H, x1 = -1, y1 = -1, top = Number.NEGATIVE_INFINITY;
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % W, y = (p / W) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        top = Math.max(top, heights[p]);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (obstruction[q] && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
      found.push({
        x: xAt(cx),
        z: zAt(cy),
        widthM: (x1 - x0 + 1) * pixelSize,
        depthM: (y1 - y0 + 1) * pixelSize,
        baseM: evalPlane(planes[label[start]], cx, cy),
        topM: top,
      });
    }
    return found;
  }
}

/** Median annual flux per face, from interior pixels where a face has any. */
export function faceSunlightMedians(
  reconstruction: Pick<RoofReconstruction, "pixelFaces">,
  flux: ArrayLike<number>,
  width?: number
): Map<number, number> {
  const { pixelFaces } = reconstruction;
  const W = width ?? Math.round(Math.sqrt(pixelFaces.length));
  const interior = new Map<number, number[]>();
  const all = new Map<number, number[]>();
  for (let i = 0; i < pixelFaces.length; i++) {
    const face = pixelFaces[i];
    const value = Number(flux[i]);
    if (face < 0 || !Number.isFinite(value) || value <= -9990) continue;
    (all.get(face) ?? all.set(face, []).get(face)!).push(value);
    const x = i % W;
    const isInterior = x > 0 && x < W - 1 && pixelFaces[i - 1] === face && pixelFaces[i + 1] === face && pixelFaces[i - W] === face && pixelFaces[i + W] === face;
    if (isInterior) (interior.get(face) ?? interior.set(face, []).get(face)!).push(value);
  }
  const medians = new Map<number, number>();
  for (const [face, values] of all) {
    const pool = interior.get(face)?.length ? interior.get(face)! : values;
    pool.sort((left, right) => left - right);
    medians.set(face, pool[Math.floor(pool.length / 2)]);
  }
  return medians;
}

// ---------------------------------------------------------------------------

/** Inward miter offset of a loop whose inside lies to the right (y down). */
function insetLoop(loop: Point[], distance: number): Point[] {
  const count = loop.length;
  return loop.map((current, index) => {
    const previous = loop[(index - 1 + count) % count];
    const next = loop[(index + 1) % count];
    const n1 = rightNormal(previous, current);
    const n2 = rightNormal(current, next);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const length = Math.hypot(mx, my);
    if (length < 1e-9) {
      mx = n1[0];
      my = n1[1];
    } else {
      mx /= length;
      my /= length;
    }
    const miter = distance / Math.max(0.4, mx * n1[0] + my * n1[1]);
    return [current[0] + mx * miter, current[1] + my * miter] as Point;
  });
}

function rightNormal(from: Point, to: Point): Point {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

/** Cells whose centres fall inside the loops (even–odd), via scanlines. */
function scanlineFill(loops: Point[][], bx: number, by: number, factor: number, cellsX: number, cellsY: number) {
  const included = new Uint8Array(cellsX * cellsY);
  for (let j = 0; j < cellsY; j++) {
    const py = by + (j + 0.5) / factor;
    const crossings: number[] = [];
    for (const loop of loops) {
      for (let k = 0, m = loop.length - 1; k < loop.length; m = k++) {
        const [xk, yk] = loop[k], [xm, ym] = loop[m];
        if (yk > py !== ym > py) crossings.push(xk + ((py - yk) * (xm - xk)) / (ym - yk));
      }
    }
    crossings.sort((left, right) => left - right);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const from = Math.max(0, Math.ceil((crossings[c] - bx) * factor - 0.5));
      const to = Math.min(cellsX - 1, Math.floor((crossings[c + 1] - bx) * factor - 0.5));
      for (let i = from; i <= to; i++) included[j * cellsX + i] = 1;
    }
  }
  return included;
}

function dilate(source: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let oy = -1; oy <= 1 && !on; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && source[ny * width + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function erode(source: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 1;
      for (let oy = -1; oy <= 1 && on; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !source[ny * width + nx]) {
            on = 0;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function solve3(matrix: number[][], vector: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(matrix);
  if (Math.abs(d) < 1e-9) return null;
  return [0, 1, 2].map((column) => det(matrix.map((row, r) => row.map((value, c) => (c === column ? vector[r] : value)))) / d);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

