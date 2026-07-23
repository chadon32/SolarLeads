import {
  angularDistanceDeg,
  bearingDegrees,
  getPanelGroundDimensionsMeters,
  haversineMeters,
  meanUndirectedAxisDeg,
  normalizeDegrees,
  orientAxisToward,
} from "@/lib/panel-geometry";
import type { SolarPanelPlacement } from "@/lib/roof-analysis";

/**
 * Snap Solar API panel placements onto per-roof-plane rack grids.
 *
 * Google's ML-detected centers wobble a few inches off-grid and per-panel
 * rotation inference amplifies the noise, so the rendered array reads as
 * scattered confetti. Real installs are ruler-straight: one azimuth per
 * plane, uniform row and column pitch. This pass aligns each plane's panels
 * to that lattice while staying honest — if snapping would move any module
 * more than `maxSnapDistanceMeters`, the whole plane keeps Google's
 * original placements.
 */

const METERS_PER_DEGREE_LAT = 111_320;

/** Same-row/column membership threshold, as a fraction of module pitch. */
const CLUSTER_BREAK_RATIO = 0.5;
/** Accept observed spacings within this band around the nominal pitch. */
const SPACING_MIN_RATIO = 0.7;
const SPACING_MAX_RATIO = 1.6;
/** Neighbor-pair distance tolerance when voting for the plane azimuth. */
const AXIS_VOTE_DISTANCE_TOLERANCE = 0.12;
/**
 * Bearing gate for azimuth votes. Diagonal neighbors in staggered (brick)
 * layouts sit >=16 degrees off-axis while genuine grid-axis error stays
 * within a few degrees, so 12 degrees separates the two cleanly.
 */
const AXIS_VOTE_MAX_DEVIATION_DEG = 12;
/**
 * Planes within this many degrees of a right angle of the building's
 * dominant axis snap onto it. Google's per-segment azimuths carry a few
 * degrees of noise BETWEEN planes of one rectangular house; genuinely
 * diagonal wings sit far outside this window and are left alone.
 */
const BUILDING_AXIS_SNAP_TOLERANCE_DEG = 8;

type RegularizeParams = {
  panels: SolarPanelPlacement[];
  panelWidthMeters: number;
  panelHeightMeters: number;
  maxSnapDistanceMeters?: number;
};

export function regularizeSolarPanels({
  panels,
  panelWidthMeters,
  panelHeightMeters,
  maxSnapDistanceMeters = 0.6,
}: RegularizeParams): SolarPanelPlacement[] {
  if (panels.length < 2) {
    return panels;
  }

  const groups = new Map<string, number[]>();

  panels.forEach((panel, index) => {
    const key = `${panel.segmentIndex}|${panel.orientation}`;
    const members = groups.get(key);
    if (members) {
      members.push(index);
    } else {
      groups.set(key, [index]);
    }
  });

  const result = [...panels];

  // First pass: each group's own consensus azimuth, then snap them all to
  // the building's dominant axis so planes of one rectangular house render
  // parallel/orthogonal instead of drifting a few degrees apart.
  const groupEntries = [...groups.values()]
    .filter((memberIndices) => memberIndices.length >= 2)
    .map((memberIndices) => {
      const group = memberIndices.map((index) => panels[index]);
      return {
        memberIndices,
        group,
        azimuthDeg: computeGroupConsensusAzimuth({
          group,
          panelWidthMeters,
          panelHeightMeters,
        }),
      };
    });

  const snappedAzimuths = snapAzimuthsToBuildingAxis(
    groupEntries.map((entry) => ({
      azimuthDeg: entry.azimuthDeg,
      weight: entry.group.length,
    }))
  );

  groupEntries.forEach((entry, entryIndex) => {
    const azimuthDeg = snappedAzimuths[entryIndex];
    const snapped = regularizeGroup({
      group: entry.group,
      panelWidthMeters,
      panelHeightMeters,
      maxSnapDistanceMeters,
      azimuthDeg,
    });

    if (snapped) {
      entry.memberIndices.forEach((panelIndex, groupIndex) => {
        result[panelIndex] = snapped[groupIndex];
      });
      return;
    }

    // Lattice snap refused (honesty clamp) — positions stay exactly as
    // detected, but orientation is render inference, not API data, so the
    // group still adopts the building-aligned azimuth and draws parallel
    // to the rest of the house.
    entry.memberIndices.forEach((panelIndex) => {
      result[panelIndex] = {
        ...panels[panelIndex],
        azimuthDeg: roundTo(normalizeDegrees(azimuthDeg), 2),
      };
    });
  });

  return result;
}

type CohesivePanelSelectionParams = {
  panels: SolarPanelPlacement[];
  targetCount: number;
  panelWidthMeters: number;
  panelHeightMeters: number;
};

type PanelGroup = {
  panels: SolarPanelPlacement[];
  averageEnergyKwh: number;
};

/**
 * Choose a compact installer-style sample array without inventing panel
 * coordinates. Google ranks candidates by production, so taking the first N
 * can scatter a small system across several planes. This selector prefers a
 * contiguous block on one sufficiently productive plane and only expands to
 * another plane when the requested count requires it.
 */
export function selectCohesiveSolarPanels({
  panels,
  targetCount,
  panelWidthMeters,
  panelHeightMeters,
}: CohesivePanelSelectionParams): SolarPanelPlacement[] {
  const safeTarget = Math.min(
    panels.length,
    Math.max(0, Math.round(targetCount))
  );

  if (safeTarget === 0) {
    return [];
  }

  if (safeTarget >= panels.length) {
    return [...panels];
  }

  const groupedPanels = new Map<string, SolarPanelPlacement[]>();
  panels.forEach((panel) => {
    const key = `${panel.segmentIndex}|${panel.orientation}`;
    const group = groupedPanels.get(key);
    if (group) {
      group.push(panel);
    } else {
      groupedPanels.set(key, [panel]);
    }
  });

  const groups: PanelGroup[] = [...groupedPanels.values()].map(
    (groupPanels) => ({
      panels: groupPanels,
      averageEnergyKwh: mean(
        groupPanels.map((panel) => Math.max(0, panel.yearlyEnergyDcKwh))
      ),
    })
  );
  const energyBenchmark = mean(
    [...panels]
      .sort(
        (left, right) =>
          Math.max(0, right.yearlyEnergyDcKwh) -
          Math.max(0, left.yearlyEnergyDcKwh)
      )
      .slice(0, safeTarget)
      .map((panel) => Math.max(0, panel.yearlyEnergyDcKwh))
  );

  // A single plane is the cleanest result. Keep it honest by requiring its
  // average production to stay close to Google's best N candidates.
  const singlePlane = groups
    .filter(
      (group) =>
        group.panels.length >= safeTarget &&
        (energyBenchmark <= 0 ||
          group.averageEnergyKwh >= energyBenchmark * 0.88)
    )
    .sort(
      (left, right) =>
        right.averageEnergyKwh - left.averageEnergyKwh ||
        left.panels.length - right.panels.length
    )[0];

  if (singlePlane) {
    return selectCompactPanelBlock({
      panels: singlePlane.panels,
      targetCount: safeTarget,
      panelWidthMeters,
      panelHeightMeters,
    });
  }

  // When one plane cannot hold the system, prefer the fewest large,
  // productive planes rather than hopping between small high-output patches.
  const minimumUsefulEnergy =
    energyBenchmark > 0 ? energyBenchmark * 0.78 : 0;
  const usefulGroups = groups.filter(
    (group) => group.averageEnergyKwh >= minimumUsefulEnergy
  );
  const orderedGroups = (usefulGroups.length ? usefulGroups : groups).sort(
    (left, right) => {
      const leftCoverage = Math.min(left.panels.length, safeTarget) / safeTarget;
      const rightCoverage =
        Math.min(right.panels.length, safeTarget) / safeTarget;
      const leftQuality =
        energyBenchmark > 0 ? left.averageEnergyKwh / energyBenchmark : 1;
      const rightQuality =
        energyBenchmark > 0 ? right.averageEnergyKwh / energyBenchmark : 1;
      const leftScore = leftCoverage * 0.72 + leftQuality * 0.28;
      const rightScore = rightCoverage * 0.72 + rightQuality * 0.28;
      return rightScore - leftScore;
    }
  );

  const selected: SolarPanelPlacement[] = [];
  for (const group of orderedGroups) {
    const remaining = safeTarget - selected.length;
    if (remaining <= 0) {
      break;
    }
    selected.push(
      ...selectCompactPanelBlock({
        panels: group.panels,
        targetCount: Math.min(remaining, group.panels.length),
        panelWidthMeters,
        panelHeightMeters,
      })
    );
  }

  if (selected.length < safeTarget) {
    const selectedSet = new Set(selected);
    selected.push(
      ...panels
        .filter((panel) => !selectedSet.has(panel))
        .slice(0, safeTarget - selected.length)
    );
  }

  return selected.slice(0, safeTarget);
}

function selectCompactPanelBlock({
  panels,
  targetCount,
  panelWidthMeters,
  panelHeightMeters,
}: CohesivePanelSelectionParams): SolarPanelPlacement[] {
  if (targetCount >= panels.length) {
    return [...panels];
  }

  const originLat = mean(panels.map((panel) => panel.center.lat));
  const originLng = mean(panels.map((panel) => panel.center.lng));
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT *
    Math.max(Math.cos((originLat * Math.PI) / 180), 0.01);
  const azimuthDeg = normalizeDegrees(panels[0]?.azimuthDeg ?? 0);
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const sinAzimuth = Math.sin(azimuthRad);
  const cosAzimuth = Math.cos(azimuthRad);
  const medianPitchDeg = median(
    panels.map((panel) => panel.pitchDeg ?? 0)
  );
  const { alongAzimuthMeters, acrossAzimuthMeters } =
    getPanelGroundDimensionsMeters({
      orientation: panels[0]?.orientation ?? "PORTRAIT",
      panelWidthMeters,
      panelHeightMeters,
      pitchDeg: medianPitchDeg,
      insetMeters: 0,
    });
  const alongPitch = Math.max(0.1, alongAzimuthMeters);
  const acrossPitch = Math.max(0.1, acrossAzimuthMeters);
  const energyValues = panels.map((panel) =>
    Math.max(0, panel.yearlyEnergyDcKwh)
  );
  const minimumEnergy = Math.min(...energyValues);
  const maximumEnergy = Math.max(...energyValues);
  const energyRange = Math.max(1, maximumEnergy - minimumEnergy);
  const points = panels.map((panel, index) => {
    const east = (panel.center.lng - originLng) * metersPerDegreeLng;
    const north = (panel.center.lat - originLat) * METERS_PER_DEGREE_LAT;
    return {
      index,
      panel,
      u: (east * sinAzimuth + north * cosAzimuth) / alongPitch,
      v: (east * cosAzimuth - north * sinAzimuth) / acrossPitch,
    };
  });

  let bestIndices = new Set<number>();
  let bestScore = Number.POSITIVE_INFINITY;

  for (const anchor of points) {
    const candidate = [...points]
      .sort((left, right) => {
        const leftDistance = Math.max(
          Math.abs(left.u - anchor.u),
          Math.abs(left.v - anchor.v)
        );
        const rightDistance = Math.max(
          Math.abs(right.u - anchor.u),
          Math.abs(right.v - anchor.v)
        );
        const leftEnergyPenalty =
          (maximumEnergy - Math.max(0, left.panel.yearlyEnergyDcKwh)) /
          energyRange;
        const rightEnergyPenalty =
          (maximumEnergy - Math.max(0, right.panel.yearlyEnergyDcKwh)) /
          energyRange;
        return (
          leftDistance +
          leftEnergyPenalty * 0.12 -
          (rightDistance + rightEnergyPenalty * 0.12)
        );
      })
      .slice(0, targetCount);
    const minU = Math.min(...candidate.map((point) => point.u));
    const maxU = Math.max(...candidate.map((point) => point.u));
    const minV = Math.min(...candidate.map((point) => point.v));
    const maxV = Math.max(...candidate.map((point) => point.v));
    const rowSpan = maxU - minU + 1;
    const columnSpan = maxV - minV + 1;
    const averageEnergy = mean(
      candidate.map((point) => Math.max(0, point.panel.yearlyEnergyDcKwh))
    );
    const normalizedEnergy =
      (averageEnergy - minimumEnergy) / energyRange;
    const averageAnchorDistance = mean(
      candidate.map((point) =>
        Math.hypot(point.u - anchor.u, point.v - anchor.v)
      )
    );
    const score =
      rowSpan * columnSpan +
      (rowSpan + columnSpan) * 0.08 +
      averageAnchorDistance * 0.05 -
      normalizedEnergy * 0.16;

    if (score < bestScore) {
      bestScore = score;
      bestIndices = new Set(candidate.map((point) => point.index));
    }
  }

  return panels.filter((_, index) => bestIndices.has(index));
}

/**
 * Snap each plane azimuth to the nearest right angle of the weighted
 * dominant building axis (circular mean modulo 90 degrees), when within
 * the snap tolerance. Azimuths outside the window pass through untouched.
 */
function snapAzimuthsToBuildingAxis(
  entries: Array<{ azimuthDeg: number; weight: number }>
): number[] {
  let x = 0;
  let y = 0;

  for (const entry of entries) {
    const phi = (4 * entry.azimuthDeg * Math.PI) / 180;
    x += entry.weight * Math.cos(phi);
    y += entry.weight * Math.sin(phi);
  }

  if (Math.hypot(x, y) < 1e-9) {
    return entries.map((entry) => entry.azimuthDeg);
  }

  const axisDeg = (Math.atan2(y, x) * 180) / Math.PI / 4;

  return entries.map((entry) => {
    const steps = Math.round((entry.azimuthDeg - axisDeg) / 90);
    const candidate = axisDeg + steps * 90;
    return angularDistanceDeg(entry.azimuthDeg, candidate) <=
      BUILDING_AXIS_SNAP_TOLERANCE_DEG
      ? normalizeDegrees(candidate)
      : entry.azimuthDeg;
  });
}

function computeGroupConsensusAzimuth({
  group,
  panelWidthMeters,
  panelHeightMeters,
}: {
  group: SolarPanelPlacement[];
  panelWidthMeters: number;
  panelHeightMeters: number;
}): number {
  const segmentAzimuth = group[0].azimuthDeg;
  const medianPitchDeg = median(group.map((panel) => panel.pitchDeg ?? 0));
  const { alongAzimuthMeters, acrossAzimuthMeters } =
    getPanelGroundDimensionsMeters({
      orientation: group[0].orientation,
      panelWidthMeters,
      panelHeightMeters,
      pitchDeg: medianPitchDeg,
      insetMeters: 0,
    });

  return inferConsensusAzimuthDeg({
    group,
    segmentAzimuth,
    alongAzimuthMeters,
    acrossAzimuthMeters,
  });
}

function regularizeGroup({
  group,
  panelWidthMeters,
  panelHeightMeters,
  maxSnapDistanceMeters,
  azimuthDeg,
}: {
  group: SolarPanelPlacement[];
  panelWidthMeters: number;
  panelHeightMeters: number;
  maxSnapDistanceMeters: number;
  /** Final plane azimuth (consensus + building-axis snap). */
  azimuthDeg: number;
}): SolarPanelPlacement[] | null {
  const medianPitchDeg = median(group.map((panel) => panel.pitchDeg ?? 0));
  const { alongAzimuthMeters, acrossAzimuthMeters } =
    getPanelGroundDimensionsMeters({
      orientation: group[0].orientation,
      panelWidthMeters,
      panelHeightMeters,
      pitchDeg: medianPitchDeg,
      insetMeters: 0,
    });

  // Local plane frame in meters: u along the azimuth, v across it.
  const lat0 = mean(group.map((panel) => panel.center.lat));
  const lng0 = mean(group.map((panel) => panel.center.lng));
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.max(Math.cos((lat0 * Math.PI) / 180), 0.01);
  const azimuthRad = (normalizeDegrees(azimuthDeg) * Math.PI) / 180;
  const sinAz = Math.sin(azimuthRad);
  const cosAz = Math.cos(azimuthRad);

  const local = group.map((panel) => {
    const east = (panel.center.lng - lng0) * metersPerDegreeLng;
    const north = (panel.center.lat - lat0) * METERS_PER_DEGREE_LAT;
    return {
      u: east * sinAz + north * cosAz,
      v: east * cosAz - north * sinAz,
    };
  });

  // Rows cluster along u; columns cluster along v within each row.
  const rowClusters = cluster1d(
    local.map((point, index) => ({ value: point.u, index })),
    alongAzimuthMeters * CLUSTER_BREAK_RATIO
  );
  const rowSpacing = estimateSpacing(
    [rowClusters.map(clusterCenter)],
    alongAzimuthMeters
  );
  const snappedU = snapClustersToLattice(rowClusters, rowSpacing);

  const columnClustersByRow = rowClusters.map((row) =>
    cluster1d(
      row.map(({ index }) => ({ value: local[index].v, index })),
      acrossAzimuthMeters * CLUSTER_BREAK_RATIO
    )
  );

  // Two modules landing in one column slot would overlap after snapping
  // (an off-grid module merged into its neighbor's cluster). Keep the
  // plane as detected instead of inventing an impossible layout.
  if (
    columnClustersByRow.some((clusters) =>
      clusters.some((members) => members.length > 1)
    )
  ) {
    return null;
  }

  // One column pitch for the whole plane; rows fit their own origin but
  // origins are phase-aligned across rows afterwards, so columns line up
  // unless rows are genuinely staggered (hip/trapezoid brick layouts).
  const columnSpacing = estimateSpacing(
    columnClustersByRow.map((clusters) => clusters.map(clusterCenter)),
    acrossAzimuthMeters
  );
  const snappedV = snapRowsWithPhaseAlignment(
    columnClustersByRow,
    columnSpacing,
    group.length
  );

  // Honesty clamp: alignment only. If the lattice wants to move any module
  // too far from Google's detection, keep the plane as detected.
  for (let index = 0; index < group.length; index += 1) {
    const du = (snappedU.get(index) ?? local[index].u) - local[index].u;
    const dv = snappedV[index] - local[index].v;
    if (Math.hypot(du, dv) > maxSnapDistanceMeters) {
      return null;
    }
  }

  return group.map((panel, index) => {
    const u = snappedU.get(index) ?? local[index].u;
    const v = snappedV[index];
    const east = u * sinAz + v * cosAz;
    const north = u * cosAz - v * sinAz;

    return {
      ...panel,
      azimuthDeg: roundTo(normalizeDegrees(azimuthDeg), 2),
      center: {
        lat: lat0 + north / METERS_PER_DEGREE_LAT,
        lng: lng0 + east / metersPerDegreeLng,
      },
    };
  });
}

/**
 * One azimuth for the whole plane, from pairwise neighbor geometry.
 *
 * A pair votes only when its distance matches the along or across module
 * pitch AND its bearing sits near the corresponding grid axis. The bearing
 * gate matters: in staggered (brick) layouts, diagonal neighbors match the
 * row pitch by distance but sit well off-axis, and letting them vote would
 * twist the consensus several degrees.
 */
function inferConsensusAzimuthDeg({
  group,
  segmentAzimuth,
  alongAzimuthMeters,
  acrossAzimuthMeters,
}: {
  group: SolarPanelPlacement[];
  segmentAzimuth: number;
  alongAzimuthMeters: number;
  acrossAzimuthMeters: number;
}): number {
  const axisVotes: number[] = [];
  const acrossAxis = segmentAzimuth + 90;

  for (let a = 0; a < group.length; a += 1) {
    for (let b = a + 1; b < group.length; b += 1) {
      const distance = haversineMeters(
        group[a].center.lat,
        group[a].center.lng,
        group[b].center.lat,
        group[b].center.lng
      );
      const bearing = bearingDegrees(
        group[a].center.lat,
        group[a].center.lng,
        group[b].center.lat,
        group[b].center.lng
      );

      const alongError =
        Math.abs(distance - alongAzimuthMeters) / alongAzimuthMeters;
      const acrossError =
        Math.abs(distance - acrossAzimuthMeters) / acrossAzimuthMeters;

      if (
        alongError <= AXIS_VOTE_DISTANCE_TOLERANCE &&
        axisDeviationDeg(bearing, segmentAzimuth) <= AXIS_VOTE_MAX_DEVIATION_DEG
      ) {
        axisVotes.push(bearing);
      } else if (
        acrossError <= AXIS_VOTE_DISTANCE_TOLERANCE &&
        axisDeviationDeg(bearing, acrossAxis) <= AXIS_VOTE_MAX_DEVIATION_DEG
      ) {
        // Across votes describe the azimuth + 90 axis; recover the azimuth.
        axisVotes.push(bearing - 90);
      }
    }
  }

  if (!axisVotes.length) {
    return normalizeDegrees(segmentAzimuth);
  }

  return orientAxisToward(meanUndirectedAxisDeg(axisVotes), segmentAzimuth);
}

/** Angular distance between a bearing and an undirected axis. */
function axisDeviationDeg(bearing: number, axisDeg: number) {
  return Math.min(
    angularDistanceDeg(bearing, axisDeg),
    angularDistanceDeg(bearing, axisDeg + 180)
  );
}

/**
 * Rows whose lattice phases differ by less than this fraction of the pitch
 * are treated as the same column grid and aligned; larger offsets are a
 * deliberate stagger and are preserved.
 */
const PHASE_ALIGN_TOLERANCE_RATIO = 0.25;

/**
 * Snap each row's column clusters to the shared pitch, then align the row
 * origins across rows. Without this, rows with few panels (e.g. a single
 * module per row on a narrow plane) each keep their own lateral offset and
 * the column zigzags instead of reading as one straight line.
 */
function snapRowsWithPhaseAlignment(
  columnClustersByRow: ClusterEntry[][][],
  spacing: number,
  panelCount: number
): number[] {
  type RowFit = {
    clusters: ClusterEntry[][];
    latticeIndices: number[];
    origin: number;
  };

  const rows: RowFit[] = columnClustersByRow.map((clusters) => {
    const centers = clusters.map(clusterCenter);
    const latticeIndices: number[] = [0];
    for (let index = 1; index < centers.length; index += 1) {
      const steps = Math.max(
        1,
        Math.round((centers[index] - centers[index - 1]) / spacing)
      );
      latticeIndices.push(latticeIndices[index - 1] + steps);
    }

    const residuals: number[] = [];
    clusters.forEach((members, clusterIndex) => {
      for (const entry of members) {
        residuals.push(entry.value - latticeIndices[clusterIndex] * spacing);
      }
    });

    return { clusters, latticeIndices, origin: median(residuals) };
  });

  // Group rows whose origins share a lattice phase, then snap each group's
  // rows to the group's common phase.
  const phaseOf = (origin: number) =>
    ((origin % spacing) + spacing) % spacing;
  const sortedRows = rows
    .map((row, rowIndex) => ({ rowIndex, phase: phaseOf(row.origin) }))
    .sort((left, right) => left.phase - right.phase);

  // Circular clustering: cut the phase circle at its largest gap, then
  // split greedily wherever neighbors differ more than the tolerance.
  let cutIndex = 0;
  let largestGap = -1;
  for (let index = 0; index < sortedRows.length; index += 1) {
    const next = sortedRows[(index + 1) % sortedRows.length];
    const gap =
      index + 1 < sortedRows.length
        ? next.phase - sortedRows[index].phase
        : next.phase + spacing - sortedRows[index].phase;
    if (gap > largestGap) {
      largestGap = gap;
      cutIndex = (index + 1) % sortedRows.length;
    }
  }

  const rotated = [
    ...sortedRows.slice(cutIndex),
    ...sortedRows.slice(0, cutIndex),
  ];
  const base = rotated.length ? rotated[0].phase : 0;
  const unwrapped = rotated.map((entry) => ({
    ...entry,
    phase:
      entry.phase >= base ? entry.phase : entry.phase + spacing,
  }));

  const tolerance = spacing * PHASE_ALIGN_TOLERANCE_RATIO;
  const phaseGroups: Array<typeof unwrapped> = [];
  let current: typeof unwrapped = [];
  for (const entry of unwrapped) {
    if (
      current.length &&
      entry.phase - current[current.length - 1].phase > tolerance
    ) {
      phaseGroups.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length) {
    phaseGroups.push(current);
  }

  const alignedOrigins = new Array<number>(rows.length);
  for (const groupEntries of phaseGroups) {
    const groupPhase = mean(groupEntries.map((entry) => entry.phase));
    for (const entry of groupEntries) {
      const origin = rows[entry.rowIndex].origin;
      alignedOrigins[entry.rowIndex] =
        groupPhase + Math.round((origin - groupPhase) / spacing) * spacing;
    }
  }

  const snapped = new Array<number>(panelCount);
  rows.forEach((row, rowIndex) => {
    row.clusters.forEach((members, clusterIndex) => {
      const value =
        alignedOrigins[rowIndex] + row.latticeIndices[clusterIndex] * spacing;
      for (const entry of members) {
        snapped[entry.index] = value;
      }
    });
  });

  return snapped;
}

type ClusterEntry = { value: number; index: number };

/** Sort by value and split into clusters wherever the gap exceeds the break. */
function cluster1d(
  entries: ClusterEntry[],
  breakDistance: number
): ClusterEntry[][] {
  const sorted = [...entries].sort((left, right) => left.value - right.value);
  const clusters: ClusterEntry[][] = [];
  let current: ClusterEntry[] = [];

  for (const entry of sorted) {
    if (
      current.length &&
      entry.value - current[current.length - 1].value > breakDistance
    ) {
      clusters.push(current);
      current = [];
    }
    current.push(entry);
  }

  if (current.length) {
    clusters.push(current);
  }

  return clusters;
}

/** Robust cluster position: median of member values. */
function clusterCenter(members: ClusterEntry[]) {
  return median(members.map((entry) => entry.value));
}

/**
 * Lattice pitch estimated from the data — the median spacing between
 * neighboring cluster centers, bounded around the nominal module size — so
 * Google's real packing is preserved. Falls back to the nominal size when
 * no observed spacing qualifies.
 */
function estimateSpacing(centerLists: number[][], nominalSpacing: number) {
  const observed: number[] = [];

  for (const centers of centerLists) {
    for (let index = 1; index < centers.length; index += 1) {
      const delta = centers[index] - centers[index - 1];
      if (
        delta >= nominalSpacing * SPACING_MIN_RATIO &&
        delta <= nominalSpacing * SPACING_MAX_RATIO
      ) {
        observed.push(delta);
      }
    }
  }

  return observed.length ? median(observed) : nominalSpacing;
}

/**
 * Snap cluster members onto a uniform lattice with the given pitch.
 *
 * The origin is the median residual, so a single off-grid module cannot
 * drag its clean neighbors. Returns member index -> snapped coordinate.
 */
function snapClustersToLattice(
  clusters: ClusterEntry[][],
  spacing: number
): Map<number, number> {
  const centers = clusters.map(clusterCenter);

  // Integer lattice index per cluster; gaps (skipped positions) allowed.
  const latticeIndices: number[] = [0];
  for (let index = 1; index < centers.length; index += 1) {
    const steps = Math.max(
      1,
      Math.round((centers[index] - centers[index - 1]) / spacing)
    );
    latticeIndices.push(latticeIndices[index - 1] + steps);
  }

  const residuals: number[] = [];
  clusters.forEach((members, clusterIndex) => {
    for (const entry of members) {
      residuals.push(entry.value - latticeIndices[clusterIndex] * spacing);
    }
  });
  const origin = residuals.length ? median(residuals) : 0;

  const snapped = new Map<number, number>();
  clusters.forEach((members, clusterIndex) => {
    const value = origin + latticeIndices[clusterIndex] * spacing;
    for (const entry of members) {
      snapped.set(entry.index, value);
    }
  });

  return snapped;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
