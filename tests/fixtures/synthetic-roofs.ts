import type { RoofGeoBounds, SolarPanelPlacement } from "../../src/lib/roof-analysis";
import { metersPerDegreeLng, type LatLng } from "../../src/lib/roof-scene-geometry";

/**
 * Deterministic synthetic houses with known geometry, rendered into the same
 * rasters the Solar API returns (DSM, rooftop mask, annual flux). Used by the
 * reconstruction unit tests and the 3D screenshot regression spec, so no real
 * homeowner data is stored in the repository.
 *
 * Local frame: x = metres east, z = metres south of `origin`.
 */

export type SyntheticRoofKind = "gable" | "hip" | "l-shape" | "multi-level";

export type SyntheticRoofOptions = {
  pixelSizeMeters?: number;
  radiusMeters?: number;
  /** 1 × 1 m unit standing 0.8 m proud of the west face (gable only). */
  rooftopUnit?: boolean;
  /** 6 m canopy west of the house, outside the rooftop mask. */
  tree?: boolean;
  /** Flat-roofed neighbouring building east of the house. */
  neighbor?: boolean;
  /** 3 m tall, 0.3 m thick garden wall south of the house (not a tree). */
  wall?: boolean;
  /** The Solar API mask sits about one pixel inside the eaves. */
  maskErosionPx?: number;
  noiseMeters?: number;
  /**
   * Real DSMs blend roof and ground in the eave pixel: place the house off
   * the pixel grid and average 4×4 sub-samples per pixel (one mixed pixel at
   * each edge, matching the 0.5 m Solar API rasters).
   */
  mixedEdges?: boolean;
};

export type SyntheticRoof = {
  kind: SyntheticRoofKind;
  origin: LatLng;
  pixelSizeMeters: number;
  groundElevationMeters: number;
  width: number;
  height: number;
  bounds: RoofGeoBounds;
  dsm: Float32Array;
  mask: Uint8Array;
  flux: Float32Array;
  panels: SolarPanelPlacement[];
  segments: Array<{ segmentIndex: number; pitchDeg: number; azimuthDeg: number }>;
  /** Best-case annual flux on this roof (stands in for maxSunshineHoursPerYear). */
  bestCaseFlux: number;
  /** Ground-truth roof height (m above ground) at a local point, or null off the house. */
  roofHeightAt: (x: number, z: number) => number | null;
  toLatLng: (x: number, z: number) => LatLng;
  rooftopUnit?: { x: number; z: number; sizeM: number; heightM: number };
  tree?: { x: number; z: number; radiusM: number; heightM: number };
};

const ORIGIN: LatLng = { lat: 33.3, lng: -111.7 };
const GROUND = 400;
const BEST_CASE_FLUX = 2_000;
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

type PanelRow = { segmentIndex: number; pitchDeg: number; azimuthDeg: number; centers: Array<[number, number]> };

/** House geometry in its own frame (centred on the origin, before any offset). */
function house(kind: SyntheticRoofKind): { heightAt: (x: number, z: number) => number | null; rows: PanelRow[] } {
  switch (kind) {
    case "gable":
      return {
        heightAt: (x, z) => (Math.abs(x) <= 6 && Math.abs(z) <= 10 ? 3 + tan(20) * (6 - Math.abs(x)) : null),
        rows: [
          { segmentIndex: 0, pitchDeg: 20, azimuthDeg: 90, centers: grid([1.5, 3.4], [-3.3, -2.2, -1.1, 0, 1.1, 2.2]) },
          { segmentIndex: 1, pitchDeg: 20, azimuthDeg: 270, centers: grid([-1.5, -3.4], [-3.3, -2.2, -1.1, 0, 1.1, 2.2]) },
        ],
      };
    case "hip":
      return {
        heightAt: (x, z) =>
          Math.abs(x) <= 6 && Math.abs(z) <= 9 ? 3 + tan(22) * Math.min(6 - Math.abs(x), 9 - Math.abs(z)) : null,
        rows: [{ segmentIndex: 0, pitchDeg: 22, azimuthDeg: 180, centers: grid([-1.05, 0, 1.05], [5.6]) }],
      };
    case "l-shape":
      return {
        heightAt: (x, z) => {
          const main = Math.abs(x) <= 5 && Math.abs(z) <= 10 ? 3 + tan(20) * (5 - Math.abs(x)) : null;
          const wing = x >= 0 && x <= 14 && z >= -10 && z <= -2 ? 3 + tan(20) * (4 - Math.abs(z + 6)) : null;
          return main === null ? wing : wing === null ? main : Math.max(main, wing);
        },
        rows: [
          { segmentIndex: 0, pitchDeg: 20, azimuthDeg: 270, centers: grid([-1.4, -3.3], [2, 3.1, 4.2, 5.3]) },
          { segmentIndex: 1, pitchDeg: 20, azimuthDeg: 180, centers: grid([8, 9.1, 10.2, 11.3], [-3.5]) },
        ],
      };
    case "multi-level":
      return {
        heightAt: (x, z) => {
          if (Math.abs(x) <= 6 && z >= -10 && z <= 4) return 3 + tan(20) * (6 - Math.abs(x));
          if (Math.abs(x) <= 6 && z > 4 && z <= 11) return 2.6 - tan(5) * (z - 4);
          return null;
        },
        rows: [
          { segmentIndex: 0, pitchDeg: 20, azimuthDeg: 90, centers: grid([1.5, 3.4], [-6, -4.9, -3.8, -2.7]) },
          { segmentIndex: 1, pitchDeg: 5, azimuthDeg: 180, centers: grid([-2.2, -1.1, 0, 1.1, 2.2], [6, 8]) },
        ],
      };
  }
}

function grid(xs: number[], zs: number[]): Array<[number, number]> {
  return zs.flatMap((z) => xs.map((x) => [x, z] as [number, number]));
}

export function buildSyntheticRoof(kind: SyntheticRoofKind, options: SyntheticRoofOptions = {}): SyntheticRoof {
  const {
    pixelSizeMeters = 0.5,
    radiusMeters = 20,
    rooftopUnit = false,
    tree = false,
    neighbor = false,
    wall = false,
    maskErosionPx = 1,
    noiseMeters = 0.04,
    mixedEdges = false,
  } = options;
  const shape = house(kind);
  // Off-grid placement makes eave pixels straddle roof and ground.
  const offset = mixedEdges ? { x: 0.27, z: 0.19 } : { x: 0, z: 0 };
  const houseHeightAt = (x: number, z: number) => shape.heightAt(x - offset.x, z - offset.z);

  const metersPerLng = metersPerDegreeLng(ORIGIN.lat);
  const toLatLng = (x: number, z: number): LatLng => ({ lat: ORIGIN.lat - z / 111_320, lng: ORIGIN.lng + x / metersPerLng });
  const size = Math.round((radiusMeters * 2) / pixelSizeMeters);
  const step = (radiusMeters * 2) / size;
  const bounds: RoofGeoBounds = {
    northeast: toLatLng(radiusMeters, -radiusMeters),
    southwest: toLatLng(-radiusMeters, radiusMeters),
  };

  const unit = rooftopUnit && kind === "gable" ? { x: -3 + offset.x, z: 4 + offset.z, sizeM: 1, heightM: 0.8 } : undefined;
  const canopy = tree ? { x: -13, z: 2, radiusM: 3, heightM: 6 } : undefined;
  const neighborHeightAt = (x: number, z: number) => (neighbor && x >= 11 && x <= 19 && z >= -6 && z <= 2 ? 4 : null);
  const roofHeightAt = (x: number, z: number) => {
    const base = houseHeightAt(x, z);
    if (base === null) return null;
    if (unit && Math.abs(x - unit.x) <= unit.sizeM / 2 && Math.abs(z - unit.z) <= unit.sizeM / 2) return base + unit.heightM;
    return base;
  };
  const surfaceAt = (x: number, z: number) => {
    const roof = roofHeightAt(x, z) ?? neighborHeightAt(x, z);
    if (roof !== null) return roof;
    if (canopy) {
      const d = Math.hypot(x - canopy.x, z - canopy.z);
      if (d < canopy.radiusM) return canopy.heightM * Math.sqrt(1 - (d / canopy.radiusM) ** 2);
    }
    if (wall && z >= 14 && z < 14.3 && Math.abs(x) <= 10) return 3;
    return 0;
  };

  const random = mulberry32(kind.length * 7919 + Math.round(pixelSizeMeters * 1000));
  const dsm = new Float32Array(size * size);
  const roofMask = new Uint8Array(size * size);
  const flux = new Float32Array(size * size);
  // Sun a little west of south, 60° up: west faces out-earn east faces.
  const sun = normalize([-Math.sin((20 * Math.PI) / 180) * 0.5, Math.sin(Math.PI / 3), Math.cos((20 * Math.PI) / 180) * 0.5]);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const index = row * size + col;
      const x = -radiusMeters + (col + 0.5) * step;
      const z = -radiusMeters + (row + 0.5) * step;
      let height = 0;
      if (mixedEdges) {
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) height += surfaceAt(x + ((sx + 0.5) / 4 - 0.5) * step, z + ((sy + 0.5) / 4 - 0.5) * step);
        height /= 16;
      } else {
        height = surfaceAt(x, z);
      }
      dsm[index] = GROUND + height + (random() - 0.5) * 2 * noiseMeters;
      const roofHeight = roofHeightAt(x, z);
      if (roofHeight !== null || neighborHeightAt(x, z) !== null) roofMask[index] = 1;
      if (roofHeight !== null) {
        const e = 0.05;
        const hx = ((houseHeightAt(x + e, z) ?? roofHeight) - (houseHeightAt(x - e, z) ?? roofHeight)) / (2 * e);
        const hz = ((houseHeightAt(x, z + e) ?? roofHeight) - (houseHeightAt(x, z - e) ?? roofHeight)) / (2 * e);
        const normal = normalize([-hx, 1, -hz]);
        const incidence = Math.max(0, normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2]);
        flux[index] = BEST_CASE_FLUX * (0.62 + 0.38 * incidence);
      } else {
        flux[index] = BEST_CASE_FLUX * 0.9;
      }
    }
  }
  const mask = erode(roofMask, size, size, maskErosionPx);
  const panels: SolarPanelPlacement[] = shape.rows.flatMap((row) =>
    row.centers.map(([x, z], index) => ({
      center: toLatLng(x + offset.x, z + offset.z),
      orientation: "PORTRAIT" as const,
      azimuthDeg: row.azimuthDeg,
      pitchDeg: row.pitchDeg,
      rowIndex: null,
      columnIndex: index,
      yearlyEnergyDcKwh: 600,
      segmentIndex: row.segmentIndex,
    }))
  );

  return {
    kind,
    origin: ORIGIN,
    pixelSizeMeters: step,
    groundElevationMeters: GROUND,
    width: size,
    height: size,
    bounds,
    dsm,
    mask,
    flux,
    panels,
    segments: shape.rows.map(({ segmentIndex, pitchDeg, azimuthDeg }) => ({ segmentIndex, pitchDeg, azimuthDeg })),
    bestCaseFlux: BEST_CASE_FLUX,
    roofHeightAt,
    toLatLng,
    rooftopUnit: unit,
    tree: canopy,
  };
}

function erode(source: Uint8Array, width: number, height: number, radius: number) {
  let current = source;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        next[i] = current[i] && current[i - 1] && current[i + 1] && current[i - width] && current[i + width] ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

function normalize([x, y, z]: number[]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
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
