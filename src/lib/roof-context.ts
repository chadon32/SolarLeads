/**
 * Surroundings from the same elevation scan: trees and neighbouring roofs
 * that can shade the house. Only features the DSM actually shows are
 * returned — nothing is invented when the data is silent.
 *
 * Pure (no DOM); runs in the reconstruction worker.
 */
import { regionWidthPixels, simplifyClosedLoop, traceRasterLoops } from "@/lib/raster-outline";
import type { RasterGrid } from "@/lib/roof-reconstruction";
import { latLngToLocalMeters, type LatLng } from "@/lib/roof-scene-geometry";

export type ContextTree = { x: number; z: number; radiusM: number; topM: number; canopyBaseM: number };
export type ContextBuilding = { outline: Array<{ x: number; z: number }>; heightM: number };
export type RoofContext = { trees: ContextTree[]; buildings: ContextBuilding[] };

const TREE_MIN_HEIGHT_M = 2.5;
const TREE_MIN_AREA_M2 = 1.5;
/** Narrower features (walls, fences, poles, wires) are not canopies. */
const TREE_MIN_WIDTH_M = 0.8;
/** Canopies wider than this are split into crowns of about CROWN_SIZE_M. */
const SPLIT_ABOVE_M = 9;
const CROWN_SIZE_M = 6;
const HOUSE_BUFFER_M = 1.5;
const BUILDING_MIN_AREA_M2 = 10;
const OUTLINE_TOLERANCE_M = 0.45;
const MAX_TREES = 60;
const MAX_BUILDINGS = 12;

export function extractRoofContext({
  dsm,
  mask,
  buildingPixels,
  origin,
  groundElevationMeters,
  radiusMeters = 30,
}: {
  dsm: RasterGrid;
  mask: RasterGrid;
  /** The rebuilt house on the DSM grid (`RoofReconstruction.roofPixels`). */
  buildingPixels: Uint8Array;
  origin: LatLng;
  groundElevationMeters: number;
  /** Keep features whose centre lies within this distance of the house. */
  radiusMeters?: number;
}): RoofContext {
  const W = dsm.width, H = dsm.height, N = W * H;
  if (mask.width !== W || mask.height !== H || buildingPixels.length !== N) return { trees: [], buildings: [] };
  const nw = latLngToLocalMeters({ lat: dsm.bounds.northeast.lat, lng: dsm.bounds.southwest.lng }, origin);
  const se = latLngToLocalMeters({ lat: dsm.bounds.southwest.lat, lng: dsm.bounds.northeast.lng }, origin);
  const dx = (se.x - nw.x) / W, dz = (se.z - nw.z) / H;
  const pixelSize = (Math.abs(dx) + Math.abs(dz)) / 2;
  if (!(pixelSize > 0)) return { trees: [], buildings: [] };
  const xOf = (i: number) => nw.x + ((i % W) + 0.5) * dx;
  const zOf = (i: number) => nw.z + (((i / W) | 0) + 0.5) * dz;
  const heightOf = (i: number) => {
    const value = Number(dsm.raster[i]);
    return Number.isFinite(value) && value > -1000 && value < 9000 ? value - groundElevationMeters : Number.NaN;
  };
  const inMask = (i: number) => Number(mask.raster[i]) > 0;

  let houseCount = 0, houseX = 0, houseZ = 0;
  for (let i = 0; i < N; i++) {
    if (!buildingPixels[i]) continue;
    houseCount++;
    houseX += xOf(i);
    houseZ += zOf(i);
  }
  const center = houseCount ? { x: houseX / houseCount, z: houseZ / houseCount } : { x: 0, z: 0 };
  const nearHouse = (x: number, z: number) => Math.hypot(x - center.x, z - center.z) <= radiusMeters;

  // Rooftop masks stop short of the eaves, so the tall unmasked ring around
  // every roof (ours and the neighbours') belongs to that roof, not a tree.
  let buffer = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (buildingPixels[i] || inMask(i)) buffer[i] = 1;
  for (let pass = 0, passes = Math.ceil(HOUSE_BUFFER_M / pixelSize); pass < passes; pass++) buffer = dilate(buffer, W, H);

  // ---- Trees: tall, wide-enough canopy outside every rooftop ----
  const isCanopy = (i: number) => !inMask(i) && !buffer[i] && heightOf(i) >= TREE_MIN_HEIGHT_M;
  const trees: ContextTree[] = [];
  for (const region of components(N, W, H, isCanopy, true)) {
    if (region.length * pixelSize * pixelSize < TREE_MIN_AREA_M2) continue;
    if (regionWidthPixels(region, W) * pixelSize < TREE_MIN_WIDTH_M) continue;
    for (const crown of splitCrowns(region)) {
      const area = crown.length * pixelSize * pixelSize;
      if (area < TREE_MIN_AREA_M2) continue;
      const x = crown.reduce((sum, i) => sum + xOf(i), 0) / crown.length;
      const z = crown.reduce((sum, i) => sum + zOf(i), 0) / crown.length;
      if (!nearHouse(x, z)) continue;
      const heights = crown.map(heightOf).filter(Number.isFinite).sort((left, right) => left - right);
      const topM = heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.95))];
      const radiusM = Math.min(6, Math.max(0.8, Math.sqrt(area / Math.PI)));
      trees.push({ x, z, radiusM, topM, canopyBaseM: Math.min(topM - 1, Math.max(0.8, topM - 1.6 * radiusM)) });
    }
  }
  trees.sort((left, right) => Math.hypot(left.x - center.x, left.z - center.z) - Math.hypot(right.x - center.x, right.z - center.z));

  // ---- Neighbouring roofs: other rooftop-mask components ----
  const buildings: Array<ContextBuilding & { distance: number }> = [];
  for (const region of components(N, W, H, inMask, false)) {
    if (region.some((i) => buildingPixels[i])) continue; // the house itself
    if (region.length * pixelSize * pixelSize < BUILDING_MIN_AREA_M2) continue;
    const x = region.reduce((sum, i) => sum + xOf(i), 0) / region.length;
    const z = region.reduce((sum, i) => sum + zOf(i), 0) / region.length;
    if (!nearHouse(x, z)) continue;
    const heights = region.map(heightOf).filter(Number.isFinite).sort((left, right) => left - right);
    if (!heights.length) continue;
    const members = new Set(region);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (const i of region) {
      const px = i % W, py = (i / W) | 0;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const loops = traceRasterLoops((px, py) => px >= 0 && py >= 0 && px < W && py < H && members.has(py * W + px), minX - 1, minY - 1, maxX + 1, maxY + 1);
    const outer = loops.sort((left, right) => right.length - left.length)[0];
    if (!outer) continue;
    const outline = simplifyClosedLoop(outer, OUTLINE_TOLERANCE_M / pixelSize).map(([px, py]) => ({ x: nw.x + px * dx, z: nw.z + py * dz }));
    if (outline.length < 3) continue;
    buildings.push({ outline, heightM: heights[Math.floor(heights.length / 2)], distance: Math.hypot(x - center.x, z - center.z) });
  }
  buildings.sort((left, right) => left.distance - right.distance);

  return {
    trees: trees.slice(0, MAX_TREES),
    buildings: buildings.slice(0, MAX_BUILDINGS).map(({ outline, heightM }) => ({ outline, heightM })),
  };

  /** Split very wide canopies (tree rows, merged crowns) evenly over their own extent. */
  function splitCrowns(region: number[]): number[][] {
    let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY, minZ = Number.POSITIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY;
    for (const i of region) {
      const x = xOf(i), z = zOf(i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const spanX = maxX - minX + pixelSize, spanZ = maxZ - minZ + pixelSize;
    if (spanX <= SPLIT_ABOVE_M && spanZ <= SPLIT_ABOVE_M) return [region];
    const cellsX = Math.max(1, Math.round(spanX / CROWN_SIZE_M)), cellsZ = Math.max(1, Math.round(spanZ / CROWN_SIZE_M));
    const crowns = new Map<number, number[]>();
    for (const i of region) {
      const cx = Math.min(cellsX - 1, Math.floor(((xOf(i) - minX) / spanX) * cellsX));
      const cz = Math.min(cellsZ - 1, Math.floor(((zOf(i) - minZ) / spanZ) * cellsZ));
      const key = cz * cellsX + cx;
      (crowns.get(key) ?? crowns.set(key, []).get(key)!).push(i);
    }
    return [...crowns.values()];
  }
}

function components(N: number, W: number, H: number, member: (i: number) => boolean, diagonal: boolean): number[][] {
  const seen = new Uint8Array(N);
  const found: number[][] = [];
  for (let start = 0; start < N; start++) {
    if (seen[start] || !member(start)) continue;
    const region: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if ((!ox && !oy) || (!diagonal && ox && oy)) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (!seen[q] && member(q)) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    found.push(region);
  }
  return found;
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
