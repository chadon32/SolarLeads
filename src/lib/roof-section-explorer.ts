import type { RoofAnalysis } from "./roof-analysis";
import type { RoofFaceFacts } from "./roof-face-labels";

export type ListedRoofSection = Omit<RoofFaceFacts, "moduleCount"> & { id: number; moduleCount: number | null };

/** Without a scene, use only indexed Solar API sections, not generic fallback geometry or panelsFit. */
export function listAnalysisSections(roof: Pick<RoofAnalysis, "source" | "roofSegments">): ListedRoofSection[] {
  if (roof.source !== "solar-api") return [];
  return roof.roofSegments.flatMap(({ segmentIndex, areaM2, pitchDeg, azimuthDeg }) => {
    if (segmentIndex === undefined || !Number.isInteger(segmentIndex) || segmentIndex < 0 ||
      !Number.isFinite(areaM2) || areaM2 <= 0 || !Number.isFinite(pitchDeg) || !Number.isFinite(azimuthDeg)) return [];
    return [{ id: segmentIndex, pitchDeg, azimuthDeg, areaM2, sunShare: null, moduleCount: null }];
  });
}
