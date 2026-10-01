/**
 * Turns rasters + the analysis into renderable scene data for the 3D roof:
 * the rebuilt single-shell roof when a roof model is available, otherwise
 * the per-segment faces (fallback / flag off / no rooftop mask).
 */
import * as THREE from "three";
import type { GeoTiffRaster } from "@/lib/geotiff-utils";
import type { RoofAnalysis, RoofGeoBounds } from "@/lib/roof-analysis";
import type { RoofContext } from "@/lib/roof-context";
import type { RoofModel, RoofModelJob } from "@/lib/roof-model";
import type { RoofObstruction } from "@/lib/roof-reconstruction";
import {
  boundsCenter,
  buildRoofFaceGeometry,
  buildSegmentPlaneTransforms,
  estimateGroundElevationMeters,
  expandBoundsMeters,
  fitSegmentPlanes,
  latLngToLocalMeters,
  liftRoofSegmentPlanes,
  normalizedOutlineToLatLng,
  type LatLng,
  type SegmentPlane,
} from "@/lib/roof-scene-geometry";
import type { ModelBounds } from "@/lib/roof-viewer";
import { colorRoofFlux, isValidFlux } from "@/lib/sunlight-heatmap";

/** Padding around the roof so the model floats in a roomy workspace. */
const SCENE_PADDING_METERS = 14;
/** Face/panel height when the elevation scan has no usable samples. */
const DEFAULT_FACE_HEIGHT_METERS = 3.2;
const FLUX_NEUTRAL = [232, 228, 220, 255] as const;

export type ScenePanel = {
  key: number;
  segmentIndex: number;
  position: [number, number, number];
  rotation: [number, number, number];
  alongMeters: number;
  acrossMeters: number;
};

export type SceneFace = {
  id: number;
  segmentIndex: number | null;
  pitchDeg: number;
  azimuthDeg: number;
  areaM2: number;
  /** Median annual flux ÷ the roof's best case, when known. */
  sunShare: number | null;
};

export type RebuiltShell = {
  roof: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  fascia: THREE.BufferGeometry;
  /** Steps between roof levels, drawn as wall. */
  cliffs: THREE.BufferGeometry | null;
  triangleFaces: Uint16Array;
  creaseLines: number[];
  eaveLines: number[];
};

export type SegmentShell = { faceId: number; roof: THREE.BufferGeometry; walls: THREE.BufferGeometry };

export type SceneData = {
  mode: "reconstructed" | "segments";
  shell: RebuiltShell | null;
  segmentShells: SegmentShell[];
  faces: SceneFace[];
  obstructions: RoofObstruction[];
  context: RoofContext | null;
  fluxTexture: THREE.CanvasTexture | null;
  panels: ScenePanel[];
  extentMeters: number;
  modelBounds: ModelBounds;
};

export type SceneInputs = {
  dsm: GeoTiffRaster;
  flux: GeoTiffRaster | null;
  mask: GeoTiffRaster | null;
  roofData: RoofAnalysis;
};

export type PreparedScene = {
  origin: LatLng;
  groundElevationMeters: number;
  planes: Map<number, SegmentPlane>;
  extentMeters: number;
};

/** Model-independent setup: scene origin, ground datum and panel-fitted planes. */
export function prepareScene({ dsm, roofData }: SceneInputs): PreparedScene {
  const cropBounds = expandBoundsMeters(resolveFocusBounds(roofData, dsm.bounds), SCENE_PADDING_METERS);
  const origin = boundsCenter(cropBounds);
  const groundElevationMeters = estimateGroundElevationMeters(dsm.raster);
  const planes = fitSegmentPlanes({
    panels: roofData.solarPanels,
    raster: dsm.raster,
    width: dsm.width,
    height: dsm.height,
    bounds: dsm.bounds,
    origin,
    groundElevationMeters,
    fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
  });
  const ne = latLngToLocalMeters(cropBounds.northeast, origin);
  const sw = latLngToLocalMeters(cropBounds.southwest, origin);
  return { origin, groundElevationMeters, planes, extentMeters: Math.max(Math.abs(ne.x - sw.x), Math.abs(ne.z - sw.z)) };
}

/** Worker input for the rebuilt roof; null when there is no rooftop mask. */
export function roofModelJobFor(inputs: SceneInputs, prepared: PreparedScene): RoofModelJob | null {
  if (!inputs.mask) return null;
  return {
    dsm: inputs.dsm,
    mask: inputs.mask,
    flux: inputs.flux,
    panels: inputs.roofData.solarPanels,
    segmentPlanes: prepared.planes,
    origin: prepared.origin,
    groundElevationMeters: prepared.groundElevationMeters,
  };
}

export function buildRebuiltScene(inputs: SceneInputs, prepared: PreparedScene, model: RoofModel): SceneData {
  const r = model.reconstruction;
  const roof = new THREE.BufferGeometry();
  roof.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
  roof.setAttribute("uv", new THREE.BufferAttribute(r.uvs, 2));
  roof.setIndex(new THREE.BufferAttribute(r.indices, 1));
  roof.computeVertexNormals();
  const walls = nonIndexed(r.wallPositions);
  const fascia = nonIndexed(r.fasciaPositions);
  let cliffs: THREE.BufferGeometry | null = null;
  if (r.cliffIndices.length) {
    // Own attribute (same typed array), so disposing either geometry never frees the other's buffers.
    cliffs = new THREE.BufferGeometry();
    cliffs.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
    cliffs.setIndex(new THREE.BufferAttribute(r.cliffIndices, 1));
    cliffs.computeVertexNormals();
  }

  const bestCase = bestCaseFlux(inputs);
  const sunByFace = new Map(model.faceSunlight);
  const faces: SceneFace[] = r.faces.map((face) => ({
    id: face.id,
    segmentIndex: face.segmentIndex,
    pitchDeg: face.pitchDeg,
    azimuthDeg: face.azimuthDeg,
    areaM2: face.areaM2,
    sunShare: sunByFace.has(face.id) && bestCase > 0 ? sunByFace.get(face.id)! / bestCase : null,
  }));
  const sameGrid = inputs.flux && inputs.flux.width === inputs.dsm.width && inputs.flux.height === inputs.dsm.height;
  const fluxTexture = inputs.flux
    ? makeFluxTexture(inputs.flux, sameGrid ? (i) => r.roofPixels[i] === 1 : maskPredicate(inputs), bestCase)
    : null;
  const panels = panelsOn(inputs, prepared.planes, prepared.groundElevationMeters, prepared.origin);

  return {
    mode: "reconstructed",
    shell: { roof, walls, fascia, cliffs, triangleFaces: r.triangleFaces, creaseLines: Array.from(r.creaseLines), eaveLines: Array.from(r.eaveLines) },
    segmentShells: [],
    faces,
    obstructions: r.obstructions,
    context: model.context,
    fluxTexture,
    panels,
    extentMeters: prepared.extentMeters,
    modelBounds: boundsOf([roof], panels),
  };
}

/** The per-segment model: one flat face per Solar API segment over wall skirts. */
export function buildSegmentScene(inputs: SceneInputs, prepared: PreparedScene): SceneData | null {
  const { dsm, flux, roofData } = inputs;
  // A cropped scan may contain roof pixels but no ground; shift the display datum.
  const { planes, liftMeters } = liftRoofSegmentPlanes({
    planes: prepared.planes,
    origin: prepared.origin,
    outlines: roofData.roofSegments.map((segment) => ({
      segmentIndex: segment.segmentIndex ?? -1,
      points: roofData.roofBounds ? normalizedOutlineToLatLng(segment.outline, roofData.roofBounds) : [],
    })),
  });
  const ground = prepared.groundElevationMeters - liftMeters;

  const segmentShells: SegmentShell[] = [];
  const faces: SceneFace[] = [];
  if (roofData.roofBounds) {
    roofData.roofSegments.forEach((segment, index) => {
      const geometry = buildRoofFaceGeometry({
        outline: normalizedOutlineToLatLng(segment.outline, roofData.roofBounds!),
        pitchDeg: segment.pitchDeg,
        azimuthDeg: segment.azimuthDeg,
        origin: prepared.origin,
        raster: dsm.raster,
        width: dsm.width,
        height: dsm.height,
        bounds: dsm.bounds,
        groundElevationMeters: ground,
        fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
        textureBounds: flux?.bounds ?? null,
        plane: segment.segmentIndex !== undefined ? planes.get(segment.segmentIndex) : undefined,
      });
      if (!geometry) return;
      const roof = new THREE.BufferGeometry();
      roof.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
      roof.setAttribute("uv", new THREE.BufferAttribute(geometry.uvs, 2));
      roof.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
      roof.computeVertexNormals();
      const walls = new THREE.BufferGeometry();
      walls.setAttribute("position", new THREE.BufferAttribute(geometry.wallPositions, 3));
      walls.setIndex(new THREE.BufferAttribute(geometry.wallIndices, 1));
      walls.computeVertexNormals();
      segmentShells.push({ faceId: index, roof, walls });
      faces.push({
        id: index,
        segmentIndex: segment.segmentIndex ?? null,
        pitchDeg: segment.pitchDeg,
        azimuthDeg: segment.azimuthDeg,
        areaM2: segment.areaM2,
        sunShare: null,
      });
    });
  }

  if (!segmentShells.length && !roofData.solarPanels.length) return null;
  const panels = panelsOn(inputs, planes, ground, prepared.origin);
  return {
    mode: "segments",
    shell: null,
    segmentShells,
    faces,
    obstructions: [],
    context: null,
    fluxTexture: flux ? makeFluxTexture(flux, maskPredicate(inputs), bestCaseFlux(inputs)) : null,
    panels,
    extentMeters: prepared.extentMeters,
    modelBounds: boundsOf(segmentShells.map((shell) => shell.roof), panels),
  };
}

export function disposeScene(data: SceneData) {
  data.shell?.roof.dispose();
  data.shell?.walls.dispose();
  data.shell?.fascia.dispose();
  data.shell?.cliffs?.dispose();
  for (const shell of data.segmentShells) {
    shell.roof.dispose();
    shell.walls.dispose();
  }
  data.fluxTexture?.dispose();
}

function panelsOn(inputs: SceneInputs, planes: Map<number, SegmentPlane>, ground: number, origin: LatLng): ScenePanel[] {
  const { dsm, roofData } = inputs;
  const transforms = buildSegmentPlaneTransforms({
    planes,
    panels: roofData.solarPanels,
    raster: dsm.raster,
    width: dsm.width,
    height: dsm.height,
    bounds: dsm.bounds,
    origin,
    groundElevationMeters: ground,
    panelWidthMeters: roofData.panelWidthMeters,
    panelHeightMeters: roofData.panelHeightMeters,
    fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
  });
  return transforms.flatMap((transform, index) =>
    transform
      ? [{
          key: index,
          segmentIndex: roofData.solarPanels[index].segmentIndex,
          position: [transform.position.x, transform.position.y, transform.position.z] as [number, number, number],
          rotation: [transform.tiltRad, transform.headingRad, 0] as [number, number, number],
          alongMeters: transform.alongMeters,
          acrossMeters: transform.acrossMeters,
        }]
      : []
  );
}

function nonIndexed(positions: Float32Array) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function boundsOf(geometries: THREE.BufferGeometry[], panels: ScenePanel[]): ModelBounds {
  const box = new THREE.Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
  }
  for (const panel of panels) box.expandByPoint(new THREE.Vector3(...panel.position));
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(10, 6, 10));
  box.min.y = Math.min(0, box.min.y);
  box.expandByScalar(0.6);
  return { min: box.min.toArray(), max: box.max.toArray() };
}

function maskPredicate({ flux, mask }: SceneInputs) {
  if (flux && mask && mask.width === flux.width && mask.height === flux.height) {
    return (i: number) => Number(mask.raster[i] ?? 0) > 0;
  }
  return (i: number) => (flux ? isValidFlux(Number(flux.raster[i])) : false);
}

/** Solar API maxSunshineHoursPerYear (same kWh/kW/yr unit as the flux layer). */
function bestCaseFlux({ roofData, flux }: SceneInputs) {
  if (roofData.annualSunlightHours > 0) return roofData.annualSunlightHours;
  if (!flux) return 0;
  const values = Array.from(flux.raster as ArrayLike<number>).filter((value) => isValidFlux(value)).sort((left, right) => left - right);
  return values.length ? values[Math.floor(values.length * 0.98)] : 0;
}

function makeFluxTexture(flux: GeoTiffRaster, isRoofPixel: (index: number) => boolean, bestCase: number) {
  if (typeof document === "undefined" || !flux.width || !flux.height) return null;
  const pixelMeters = ((flux.bounds.northeast.lat - flux.bounds.southwest.lat) * 111_320) / flux.height;
  const pixels = colorRoofFlux({
    flux: flux.raster,
    width: flux.width,
    height: flux.height,
    isRoofPixel,
    bestCaseFlux: bestCase,
    // Eave pixels blend roof and ground over ~0.5 m; colour from further in.
    interiorRadiusPx: pixelMeters > 0 ? Math.max(1, Math.round(0.5 / pixelMeters)) : 1,
    // Bleed roof colours outward so texture filtering never samples non-roof pixels.
    outsideBleedPx: 4,
    outsideRgba: FLUX_NEUTRAL,
  });
  const canvas = document.createElement("canvas");
  canvas.width = flux.width;
  canvas.height = flux.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(flux.width, flux.height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function resolveFocusBounds(roofData: RoofAnalysis, dsmBounds: RoofGeoBounds): RoofGeoBounds {
  if (roofData.roofBounds) return roofData.roofBounds;
  const centers = roofData.solarPanels
    .map((panel) => panel.center)
    .filter((center): center is LatLng => Number.isFinite(center?.lat) && Number.isFinite(center?.lng));
  if (centers.length >= 2) {
    return {
      northeast: { lat: Math.max(...centers.map((c) => c.lat)), lng: Math.max(...centers.map((c) => c.lng)) },
      southwest: { lat: Math.min(...centers.map((c) => c.lat)), lng: Math.min(...centers.map((c) => c.lng)) },
    };
  }
  // Last resort: a small box around the DSM center.
  const center = boundsCenter(dsmBounds);
  return expandBoundsMeters({ northeast: { ...center }, southwest: { ...center } }, 12);
}
