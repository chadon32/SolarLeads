/**
 * Everything the 3D viewer derives from the rasters in one pure call:
 * the rebuilt roof, its real surroundings and each face's median sunlight.
 * Runs inside the roof-model worker, or on the main thread as a fallback.
 */
import { extractRoofContext, type RoofContext } from "@/lib/roof-context";
import {
  faceSunlightMedians,
  reconstructRoof,
  type RasterGrid,
  type RoofReconstruction,
  type RoofReconstructionInput,
} from "@/lib/roof-reconstruction";

export type RoofModelJob = RoofReconstructionInput & { flux: RasterGrid | null };

export type RoofModel = {
  reconstruction: RoofReconstruction;
  context: RoofContext;
  /** [face id, median annual flux] for every face (empty without a flux layer). */
  faceSunlight: Array<[number, number]>;
};

export function computeRoofModel(job: RoofModelJob): RoofModel | null {
  const reconstruction = reconstructRoof(job);
  if (!reconstruction) return null;
  const context = extractRoofContext({
    dsm: job.dsm,
    mask: job.mask,
    buildingPixels: reconstruction.roofPixels,
    origin: job.origin,
    groundElevationMeters: job.groundElevationMeters,
  });
  const sameGrid = job.flux && job.flux.width === job.dsm.width && job.flux.height === job.dsm.height;
  const faceSunlight = sameGrid ? [...faceSunlightMedians(reconstruction, job.flux!.raster, job.dsm.width)] : [];
  return { reconstruction, context, faceSunlight };
}

/** Buffers a worker can hand back without copying. */
export function roofModelTransferables(model: RoofModel): ArrayBuffer[] {
  const r = model.reconstruction;
  return [r.positions, r.uvs, r.indices, r.cliffIndices, r.triangleFaces, r.wallPositions, r.fasciaPositions, r.creaseLines, r.eaveLines, r.roofPixels, r.pixelFaces].map(
    (array) => array.buffer as ArrayBuffer
  );
}
