/**
 * Keep only the building the user actually asked about.
 *
 * For attached or closely-spaced homes, the Solar API sometimes returns
 * roof segments spanning a neighboring structure, which puts rendered
 * panels on the neighbor's roof. Segments are clustered into connected
 * buildings (bounding boxes within a small gap of each other join one
 * cluster), and the cluster containing — or nearest to — the geocoded
 * address point wins.
 */

export type SegmentBox = {
  /** Original Solar API segment index. */
  index: number;
  north: number;
  south: number;
  east: number;
  west: number;
};

export type PanelPoint = {
  segmentIndex: number;
  lat: number;
  lng: number;
};

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Panels closer than this belong to one contiguous array outright —
 * real in-array module spacing is ~1m.
 */
const PANEL_CLUSTER_GAP_METERS = 1.5;
/** Beyond this, clusters are separate structures without needing terrain. */
const MAX_BRIDGE_CHECK_METERS = 12;
/**
 * The terrain between two clusters must stay at least this high above
 * ground everywhere for them to count as one structure. Eave lines sit at
 * ~2.4m+; the gap between detached homes drops to ~0m.
 */
const BRIDGE_MIN_HEIGHT_METERS = 1.8;
const BRIDGE_SAMPLE_STEP_METERS = 0.4;
/**
 * Even on a continuous roof (attached/party-wall homes), clusters this far
 * apart laterally AND this different in roof height belong to different
 * structures — a single home's array almost never splits across sections
 * that are simultaneously distant and on levels meters apart.
 */
const STEP_MIN_LATERAL_METERS = 2.0;
const STEP_MIN_HEIGHT_DIFF_METERS = 2.0;

/**
 * Segments whose panels sit on a structure detached from the one at the
 * queried address, judged by the terrain between panel clusters: if the
 * elevation between two nearby clusters dips to ground level, a real gap
 * separates two buildings — a ridge or valley on one roof never does.
 *
 * `sampleRelativeHeightMeters` returns height above ground at a point
 * (from the DSM), or null when unknown. Unknown terrain fails open: the
 * clusters merge and nothing is dropped.
 */
export function findDetachedSegments({
  points,
  targetLat,
  targetLng,
  sampleRelativeHeightMeters,
}: {
  points: PanelPoint[];
  targetLat: number;
  targetLng: number;
  sampleRelativeHeightMeters: (lat: number, lng: number) => number | null;
}): Set<number> {
  if (points.length < 2) {
    return new Set();
  }

  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT *
    Math.max(Math.cos((targetLat * Math.PI) / 180), 0.01);
  const local = points.map((point) => ({
    segmentIndex: point.segmentIndex,
    lat: point.lat,
    lng: point.lng,
    x: (point.lng - targetLng) * metersPerDegreeLng,
    y: (point.lat - targetLat) * METERS_PER_DEGREE_LAT,
  }));

  // Union-find: contiguous arrays first.
  const parent = local.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootA] = rootB;
    }
  };

  for (let a = 0; a < local.length; a += 1) {
    for (let b = a + 1; b < local.length; b += 1) {
      if (
        Math.hypot(local[a].x - local[b].x, local[a].y - local[b].y) <=
        PANEL_CLUSTER_GAP_METERS
      ) {
        union(a, b);
      }
    }
  }

  // Merge nearby clusters when the terrain between them stays roof-high.
  let merged = true;
  while (merged) {
    merged = false;
    const roots = [...new Set(local.map((_, index) => find(index)))];

    outer: for (let a = 0; a < roots.length; a += 1) {
      for (let b = a + 1; b < roots.length; b += 1) {
        const clusterA = local.filter((_, index) => find(index) === roots[a]);
        const clusterB = local.filter((_, index) => find(index) === roots[b]);

        let bestPair: [typeof clusterA[0], typeof clusterA[0]] | null = null;
        let bestDistance = Infinity;
        for (const pa of clusterA) {
          for (const pb of clusterB) {
            const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestPair = [pa, pb];
            }
          }
        }

        if (!bestPair || bestDistance > MAX_BRIDGE_CHECK_METERS) {
          continue;
        }

        // Attached-unit check: a big roof-height step across a real lateral
        // gap marks a different structure even when the roof is continuous.
        if (bestDistance >= STEP_MIN_LATERAL_METERS) {
          const heightA = clusterMedianHeight(
            clusterA,
            sampleRelativeHeightMeters
          );
          const heightB = clusterMedianHeight(
            clusterB,
            sampleRelativeHeightMeters
          );
          if (
            heightA !== null &&
            heightB !== null &&
            Math.abs(heightA - heightB) >= STEP_MIN_HEIGHT_DIFF_METERS
          ) {
            continue;
          }
        }

        if (terrainBridges(bestPair[0], bestPair[1], sampleRelativeHeightMeters)) {
          union(
            local.indexOf(bestPair[0]),
            local.indexOf(bestPair[1])
          );
          merged = true;
          break outer;
        }
      }
    }
  }

  // Primary cluster: contains the pin (with slack) or is nearest to it.
  const clusters = new Map<number, typeof local>();
  local.forEach((point, index) => {
    const root = find(index);
    const members = clusters.get(root);
    if (members) {
      members.push(point);
    } else {
      clusters.set(root, [point]);
    }
  });

  let primaryRoot: number | null = null;
  let best = { contains: false, distance: Infinity };

  for (const [root, members] of clusters) {
    const minX = Math.min(...members.map((m) => m.x)) - 2;
    const maxX = Math.max(...members.map((m) => m.x)) + 2;
    const minY = Math.min(...members.map((m) => m.y)) - 2;
    const maxY = Math.max(...members.map((m) => m.y)) + 2;
    const contains = 0 >= minX && 0 <= maxX && 0 >= minY && 0 <= maxY;
    const distance = Math.min(
      ...members.map((m) => Math.hypot(m.x, m.y))
    );

    if (
      primaryRoot === null ||
      (contains && !best.contains) ||
      (contains === best.contains && distance < best.distance)
    ) {
      primaryRoot = root;
      best = { contains, distance };
    }
  }

  // A segment is detached only when NONE of its panels are on the primary
  // structure.
  const detached = new Set<number>();
  const keptSegments = new Set<number>();
  local.forEach((point, index) => {
    if (find(index) === primaryRoot) {
      keptSegments.add(point.segmentIndex);
    }
  });
  local.forEach((point) => {
    if (!keptSegments.has(point.segmentIndex)) {
      detached.add(point.segmentIndex);
    }
  });

  return detached;
}

export type PlanePanelPoint = {
  /** Index into the raw Solar API panel array. */
  panelIndex: number;
  segmentIndex: number;
  lat: number;
  lng: number;
  /** Segment plane facing/tilt (from roofSegmentStats). */
  azimuthDeg: number;
  pitchDeg: number;
};

/**
 * How far below its segment's fitted plane a panel's terrain may sit.
 * On-plane panels measure within ~0.3m (DSM noise); modules hanging past
 * the roof edge onto a lower structure measure 1.3m+ below.
 */
const OFF_PLANE_DROP_METERS = 1.0;

/**
 * Panels whose terrain height falls well below their roof plane — modules
 * the Solar API placed past the roof edge, hanging over a lower neighbor
 * roof, carport, or vegetation.
 *
 * The plane is fitted ROBUSTLY from the panel heights themselves
 * (least-squares with one outlier-trimmed refit) rather than trusting the
 * API's reported pitch: overhanging modules skew the API's own plane fit
 * badly enough that, under it, they look perfectly on-plane.
 */
export function findOffPlanePanels({
  points,
  targetLat,
  targetLng,
  sampleRelativeHeightMeters,
}: {
  points: PlanePanelPoint[];
  targetLat: number;
  targetLng: number;
  sampleRelativeHeightMeters: (lat: number, lng: number) => number | null;
}): Set<number> {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT *
    Math.max(Math.cos((targetLat * Math.PI) / 180), 0.01);

  const bySegment = new Map<number, PlanePanelPoint[]>();
  for (const point of points) {
    const members = bySegment.get(point.segmentIndex);
    if (members) {
      members.push(point);
    } else {
      bySegment.set(point.segmentIndex, [point]);
    }
  }

  const offPlane = new Set<number>();

  for (const members of bySegment.values()) {
    if (members.length < 4) {
      // Too few samples to fit a trustworthy plane.
      continue;
    }

    const samples = members.flatMap((member) => {
      const height = sampleRelativeHeightMeters(member.lat, member.lng);
      if (height === null) {
        return [];
      }
      return [
        {
          panelIndex: member.panelIndex,
          x: (member.lng - targetLng) * metersPerDegreeLng,
          y: (member.lat - targetLat) * METERS_PER_DEGREE_LAT,
          h: height,
        },
      ];
    });

    if (samples.length < 4) {
      continue;
    }

    const plane = fitRobustPlane(samples, OFF_PLANE_DROP_METERS);
    if (!plane) {
      continue;
    }

    for (const sample of samples) {
      if (residualOf(sample, plane) < -OFF_PLANE_DROP_METERS) {
        offPlane.add(sample.panelIndex);
      }
    }
  }

  return offPlane;
}

/**
 * A panel counts as sitting over raised equipment (AC unit, vent stack)
 * when the peak DSM height under its footprint rises this far above the
 * fitted roof plane. Rooftop HVAC is ~1m+; roof noise/eaves stay well
 * below (verified: clean roofs peak ~0.5m, AC-unit panels ~1.1m).
 */
const OBSTACLE_ABOVE_PLANE_METERS = 0.8;

/**
 * Panels sitting over raised rooftop equipment. The roof plane is fitted
 * robustly from smooth (bilinear) panel-center heights; each panel is then
 * tested against a NATIVE-resolution footprint peak, so a 1-2 pixel AC
 * unit — which bilinear sampling smooths into the roof — is preserved and
 * detected.
 */
export function findObstructedPanels({
  points,
  targetLat,
  targetLng,
  sampleRelativeHeightMeters,
  sampleFootprintPeakMeters,
}: {
  points: PlanePanelPoint[];
  targetLat: number;
  targetLng: number;
  sampleRelativeHeightMeters: (lat: number, lng: number) => number | null;
  sampleFootprintPeakMeters: (lat: number, lng: number) => number | null;
}): Set<number> {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT *
    Math.max(Math.cos((targetLat * Math.PI) / 180), 0.01);

  const bySegment = new Map<number, PlanePanelPoint[]>();
  for (const point of points) {
    const members = bySegment.get(point.segmentIndex);
    if (members) {
      members.push(point);
    } else {
      bySegment.set(point.segmentIndex, [point]);
    }
  }

  const obstructed = new Set<number>();

  for (const members of bySegment.values()) {
    if (members.length < 4) {
      continue;
    }

    const samples = members.flatMap((member) => {
      const height = sampleRelativeHeightMeters(member.lat, member.lng);
      if (height === null) {
        return [];
      }
      return [
        {
          panelIndex: member.panelIndex,
          lat: member.lat,
          lng: member.lng,
          x: (member.lng - targetLng) * metersPerDegreeLng,
          y: (member.lat - targetLat) * METERS_PER_DEGREE_LAT,
          h: height,
        },
      ];
    });

    if (samples.length < 4) {
      continue;
    }

    const plane = fitRobustPlane(samples, OFF_PLANE_DROP_METERS);
    if (!plane) {
      continue;
    }

    for (const sample of samples) {
      const peak = sampleFootprintPeakMeters(sample.lat, sample.lng);
      if (peak === null) {
        continue;
      }
      const planeHeight = plane.a * sample.x + plane.b * sample.y + plane.c;
      if (peak - planeHeight > OBSTACLE_ABOVE_PLANE_METERS) {
        obstructed.add(sample.panelIndex);
      }
    }
  }

  return obstructed;
}

function residualOf(
  sample: { x: number; y: number; h: number },
  plane: { a: number; b: number; c: number }
): number {
  return sample.h - (plane.a * sample.x + plane.b * sample.y + plane.c);
}

/**
 * Iteratively reweighted plane fit. Seeded horizontal at the median height
 * so a run of outliers (drooping or raised) stays out of the first inlier
 * set and cannot tilt the plane toward itself; a genuinely pitched roof
 * re-admits its rows as the fitted tilt converges within a few rounds.
 */
function fitRobustPlane(
  samples: Array<{ x: number; y: number; h: number }>,
  tolerance: number
): { a: number; b: number; c: number } | null {
  const sortedHeights = samples.map((s) => s.h).sort((a, b) => a - b);
  let plane = {
    a: 0,
    b: 0,
    c: sortedHeights[Math.floor(sortedHeights.length / 2)],
  };

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const inliers = samples.filter(
      (sample) => Math.abs(residualOf(sample, plane)) <= tolerance
    );
    if (inliers.length < 4) {
      break;
    }
    const refit = fitPlaneLsq(inliers);
    if (!refit) {
      break;
    }
    plane = refit;
  }

  return plane;
}

/**
 * Least-squares plane h = a·x + b·y + c. Returns null when the points are
 * too collinear for a stable fit.
 */
function fitPlaneLsq(
  samples: Array<{ x: number; y: number; h: number }>
): { a: number; b: number; c: number } | null {
  const n = samples.length;
  let sx = 0, sy = 0, sh = 0;
  let sxx = 0, syy = 0, sxy = 0, sxh = 0, syh = 0;

  for (const s of samples) {
    sx += s.x;
    sy += s.y;
    sh += s.h;
    sxx += s.x * s.x;
    syy += s.y * s.y;
    sxy += s.x * s.y;
    sxh += s.x * s.h;
    syh += s.y * s.h;
  }

  // Normal equations for [a, b, c].
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const v = [sxh, syh, sh];

  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  if (Math.abs(det) < 1e-6) {
    return null;
  }

  // Cramer's rule.
  const detFor = (column: number) => {
    const mm = m.map((row) => [...row]);
    for (let r = 0; r < 3; r += 1) {
      mm[r][column] = v[r];
    }
    return (
      mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1]) -
      mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0]) +
      mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0])
    );
  };

  return {
    a: detFor(0) / det,
    b: detFor(1) / det,
    c: detFor(2) / det,
  };
}

function clusterMedianHeight(
  members: Array<{ lat: number; lng: number }>,
  sampleRelativeHeightMeters: (lat: number, lng: number) => number | null
): number | null {
  const heights = members
    .map((member) => sampleRelativeHeightMeters(member.lat, member.lng))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  return heights.length ? heights[Math.floor(heights.length / 2)] : null;
}

function terrainBridges(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  sampleRelativeHeightMeters: (lat: number, lng: number) => number | null
): boolean {
  const distanceMeters = Math.hypot(
    (a.lat - b.lat) * METERS_PER_DEGREE_LAT,
    (a.lng - b.lng) *
      METERS_PER_DEGREE_LAT *
      Math.cos((a.lat * Math.PI) / 180)
  );
  const steps = Math.max(2, Math.ceil(distanceMeters / BRIDGE_SAMPLE_STEP_METERS));

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const height = sampleRelativeHeightMeters(
      a.lat + (b.lat - a.lat) * t,
      a.lng + (b.lng - a.lng) * t
    );
    // Unknown terrain fails open (counts as bridged).
    if (height !== null && height < BRIDGE_MIN_HEIGHT_METERS) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the original segment indices belonging to the primary building.
 * Segments without a usable box are always kept (no basis to exclude).
 */
export function selectPrimaryBuildingSegments({
  boxes,
  targetLat,
  targetLng,
  gapMeters = 2.5,
}: {
  boxes: SegmentBox[];
  targetLat: number;
  targetLng: number;
  gapMeters?: number;
}): Set<number> {
  if (!boxes.length) {
    return new Set();
  }

  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT *
    Math.max(Math.cos((targetLat * Math.PI) / 180), 0.01);
  const latPad = gapMeters / 2 / METERS_PER_DEGREE_LAT;
  const lngPad = gapMeters / 2 / metersPerDegreeLng;

  // Union-find over segments whose padded boxes overlap.
  const parent = boxes.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootA] = rootB;
    }
  };

  const overlaps = (a: SegmentBox, b: SegmentBox) =>
    a.south - latPad <= b.north + latPad &&
    a.north + latPad >= b.south - latPad &&
    a.west - lngPad <= b.east + lngPad &&
    a.east + lngPad >= b.west - lngPad;

  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      if (overlaps(boxes[a], boxes[b])) {
        union(a, b);
      }
    }
  }

  // Score each cluster: containment of the target point wins outright;
  // otherwise nearest cluster-center distance.
  const clusters = new Map<number, SegmentBox[]>();
  boxes.forEach((box, position) => {
    const root = find(position);
    const members = clusters.get(root);
    if (members) {
      members.push(box);
    } else {
      clusters.set(root, [box]);
    }
  });

  let best: { members: SegmentBox[]; contains: boolean; distance: number } | null =
    null;

  for (const members of clusters.values()) {
    const north = Math.max(...members.map((m) => m.north));
    const south = Math.min(...members.map((m) => m.south));
    const east = Math.max(...members.map((m) => m.east));
    const west = Math.min(...members.map((m) => m.west));
    const contains =
      targetLat >= south - latPad &&
      targetLat <= north + latPad &&
      targetLng >= west - lngPad &&
      targetLng <= east + lngPad;
    const centerLat = (north + south) / 2;
    const centerLng = (east + west) / 2;
    const distance = Math.hypot(
      (targetLat - centerLat) * METERS_PER_DEGREE_LAT,
      (targetLng - centerLng) * metersPerDegreeLng
    );

    if (
      !best ||
      (contains && !best.contains) ||
      (contains === best.contains && distance < best.distance)
    ) {
      best = { members, contains, distance };
    }
  }

  return new Set((best?.members ?? []).map((member) => member.index));
}
