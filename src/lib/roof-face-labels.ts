/** Plain-language descriptions of roof faces for the 3D info card and screen readers. */

export type RoofFaceFacts = {
  pitchDeg: number;
  /** Downslope direction, degrees clockwise from north. */
  azimuthDeg: number;
  areaM2: number;
  /** Median annual flux ÷ the roof's best case, or null without sun data. */
  sunShare: number | null;
  moduleCount: number;
};

const DIRECTIONS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const FLAT_BELOW_DEG = 3;

export function compassDirection(azimuthDeg: number) {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  return DIRECTIONS[Math.round(normalized / 45) % 8];
}

export function describeRoofFace({ pitchDeg, azimuthDeg, areaM2, sunShare, moduleCount }: RoofFaceFacts) {
  const direction = compassDirection(azimuthDeg);
  const title = pitchDeg < FLAT_BELOW_DEG ? "Flat roof" : `${direction[0].toUpperCase()}${direction.slice(1)}-facing roof`;
  const details = [`${Math.round(pitchDeg)}° pitch`, `${Math.round(areaM2)} m²`];
  if (sunShare !== null && Number.isFinite(sunShare)) details.push(`${Math.round(sunShare * 100)}% of best-case sun`);
  details.push(moduleCount === 0 ? "No modules" : `${moduleCount} module${moduleCount === 1 ? "" : "s"}`);
  return { title, details };
}

export function summarizeRoofFaces(faces: RoofFaceFacts[]) {
  const sorted = [...faces].sort((left, right) => right.areaM2 - left.areaM2);
  const parts = sorted.map((face) => {
    const { title, details } = describeRoofFace(face);
    return `${title}: ${details.join(", ")}.`;
  });
  return [`${faces.length} roof face${faces.length === 1 ? "" : "s"}.`, ...parts].join(" ");
}
