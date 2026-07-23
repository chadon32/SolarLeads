"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { readGeoTiffRaster, type GeoTiffRaster } from "@/lib/geotiff-utils";
import type { RoofAnalysis, RoofGeoBounds } from "@/lib/roof-analysis";
import { selectCohesiveSolarPanels } from "@/lib/panel-layout";
import {
  boundsCenter,
  buildObstructionMarkerGeometry,
  buildRoofFaceGeometry,
  buildSegmentPlaneTransforms,
  estimateGroundElevationMeters,
  expandBoundsMeters,
  fitSegmentPlanes,
  latLngToLocalMeters,
  normalizedOutlineToLatLng,
  type LatLng,
} from "@/lib/roof-scene-geometry";

type RoofScene3DProps = {
  dsmUrl: string | null;
  rgbUrl: string | null;
  fluxUrl: string | null;
  maskUrl: string | null;
  roofData: RoofAnalysis;
  selectedPanelCount: number;
  showSunlight: boolean;
};

type FaceMesh = {
  key: number;
  roof: THREE.BufferGeometry;
  roofEdges: THREE.EdgesGeometry;
  wall: THREE.BufferGeometry;
};

type ObstructionMesh = {
  key: number;
  top: THREE.BufferGeometry;
  wall: THREE.BufferGeometry;
};

type SceneData = {
  faces: FaceMesh[];
  obstructions: ObstructionMesh[];
  fluxTexture: THREE.CanvasTexture | null;
  panels: Array<{
    key: number;
    position: [number, number, number];
    rotation: [number, number, number];
    alongMeters: number;
    acrossMeters: number;
  }>;
  extentMeters: number;
  roofTopMeters: number;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SceneData };

/** Padding around the roof so the model floats in a roomy workspace. */
const SCENE_PADDING_METERS = 14;
const PANEL_THICKNESS_METERS = 0.05;
/** Face/panel height when the elevation scan has no usable samples. */
const DEFAULT_FACE_HEIGHT_METERS = 3.2;
/** Neutral roof tone for the default (non-sunlight) material. */
const ROOF_COLOR = "#e8e4dc";
const WALL_COLOR = "#f3f2ef";

// rgbUrl stays in the props contract but the CAD view no longer needs the
// aerial photo — only the DSM (plane fits) and flux (heatmap).
export default function RoofScene3D({
  dsmUrl,
  fluxUrl,
  maskUrl,
  roofData,
  selectedPanelCount,
  showSunlight,
}: RoofScene3DProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Reset to the loading state when the data-layer inputs change
  // (React's "adjust state during render" pattern).
  const inputsKey = `${dsmUrl}|${fluxUrl}|${maskUrl}`;
  const [lastInputsKey, setLastInputsKey] = useState(inputsKey);

  if (lastInputsKey !== inputsKey) {
    setLastInputsKey(inputsKey);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!dsmUrl) {
        setState({
          status: "error",
          message: "3D model data is not available for this address.",
        });
        return;
      }

      if (!isWebGlAvailable()) {
        setState({
          status: "error",
          message: "This device does not support the 3D roof view.",
        });
        return;
      }

      try {
        const fallbackBounds = roofData.roofBounds ?? null;
        const [dsm, flux, mask] = await Promise.all([
          readGeoTiffRaster(dsmUrl, fallbackBounds),
          fluxUrl
            ? readGeoTiffRaster(fluxUrl, fallbackBounds).catch(() => null)
            : Promise.resolve(null),
          maskUrl
            ? readGeoTiffRaster(maskUrl, fallbackBounds).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        if (!dsm) {
          setState({
            status: "error",
            message: "3D model data is not available for this address.",
          });
          return;
        }

        const data = buildSceneData({ dsm, flux, mask, roofData });

        if (!data) {
          setState({
            status: "error",
            message: "The 3D model could not be built for this address.",
          });
          return;
        }

        if (!cancelled) {
          setState({ status: "ready", data });
        }
      } catch (error) {
        console.warn("[roof-scene-3d:error]", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        if (!cancelled) {
          setState({
            status: "error",
            message: "The 3D model could not be loaded. Please try again.",
          });
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [dsmUrl, fluxUrl, maskUrl, roofData]);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    const { faces, obstructions, fluxTexture } = state.data;

    return () => {
      for (const face of faces) {
        face.roof.dispose();
        face.roofEdges.dispose();
        face.wall.dispose();
      }
      for (const obstruction of obstructions) {
        obstruction.top.dispose();
        obstruction.wall.dispose();
      }
      fluxTexture?.dispose();
    };
  }, [state]);

  // The Canvas mounts after the async GeoTIFF load, and fiber's initial
  // container measurement can miss that late mount, leaving the default
  // 300x150 canvas. A resize event forces a correct re-measure.
  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    const handle = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 60);

    return () => window.clearTimeout(handle);
  }, [state.status]);

  if (state.status === "loading") {
    return (
      <SceneMessage>
        <span className="inline-flex h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/70 border-t-transparent" />
        <p className="text-sm text-slate-200">Building the 3D roof model…</p>
      </SceneMessage>
    );
  }

  if (state.status === "error") {
    return (
      <SceneMessage>
        <p className="text-sm font-semibold text-slate-100">
          3D view unavailable
        </p>
        <p className="max-w-xs text-xs text-slate-300">{state.message}</p>
      </SceneMessage>
    );
  }

  const { data } = state;
  const cameraDistance = Math.max(24, data.extentMeters * 0.85);
  const gridSize = Math.ceil(data.extentMeters * 3);
  const showFlux = showSunlight && data.fluxTexture !== null;
  const selectedPanels = new Set(
    selectCohesiveSolarPanels({
      panels: roofData.solarPanels,
      targetCount: selectedPanelCount,
      panelWidthMeters: roofData.panelWidthMeters,
      panelHeightMeters: roofData.panelHeightMeters,
    })
  );
  const selectedPanelIndices = new Set(
    roofData.solarPanels.flatMap((panel, index) =>
      selectedPanels.has(panel) ? [index] : []
    )
  );
  const visiblePanels = data.panels.filter((panel) =>
    selectedPanelIndices.has(panel.key)
  );

  return (
    <div className="absolute inset-0" data-testid="roof-scene-3d">
      <Canvas
        dpr={[1, 2]}
        // Flat (no tone mapping) keeps the heatmap ramp's true colors.
        flat
        camera={{
          fov: 42,
          near: 0.5,
          far: 2000,
          position: [
            cameraDistance * 0.5,
            cameraDistance * 0.85,
            cameraDistance * 0.55,
          ],
        }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={(created) => {
          // Paint the first frame immediately so the model shows even before
          // the animation loop's first tick (e.g. throttled background tabs).
          created.gl.render(created.scene, created.camera);
        }}
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, #131c2e 0%, #0b1322 55%, #060b16 100%)",
        }}
      >
        <hemisphereLight args={["#ffffff", "#475569", 0.85]} />
        <directionalLight position={[20, 46, 24]} intensity={0.7} />
        <directionalLight position={[-26, 20, -22]} intensity={0.22} />

        {/* CAD workspace floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <planeGeometry args={[gridSize * 2, gridSize * 2]} />
          <meshStandardMaterial color="#0c1424" roughness={1} metalness={0} />
        </mesh>
        <gridHelper
          args={[gridSize, Math.max(8, Math.round(gridSize / 2)), "#31445f", "#1d2a40"]}
          position={[0, 0, 0]}
        />

        {/* Extruded house: flat roof faces + wall skirts */}
        {data.faces.map((face) => (
          <group key={face.key}>
            <mesh geometry={face.roof}>
              {/* Distinct keys force a fresh material on swap — mutating
                  `map` on a live material skips the shader recompile and
                  the texture silently never shows. */}
              {showFlux ? (
                <meshStandardMaterial
                  key="flux"
                  map={data.fluxTexture}
                  roughness={0.85}
                  metalness={0}
                  side={THREE.DoubleSide}
                />
              ) : (
                <meshStandardMaterial
                  key="plain"
                  color={ROOF_COLOR}
                  roughness={0.9}
                  metalness={0}
                  side={THREE.DoubleSide}
                />
              )}
            </mesh>
            <lineSegments geometry={face.roofEdges}>
              <lineBasicMaterial color="#64748b" transparent opacity={0.65} />
            </lineSegments>
            <mesh geometry={face.wall}>
              <meshStandardMaterial
                color={WALL_COLOR}
                roughness={0.95}
                metalness={0}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ))}

        {/* Detected shading obstruction markers */}
        {data.obstructions.map((obstruction) => (
          <group key={`obstruction-${obstruction.key}`}>
            <mesh geometry={obstruction.top}>
              <meshStandardMaterial
                color="#64748b"
                roughness={0.85}
                metalness={0}
                transparent
                opacity={0.72}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh geometry={obstruction.wall}>
              <meshStandardMaterial
                color="#475569"
                roughness={0.9}
                metalness={0}
                transparent
                opacity={0.6}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ))}

        {visiblePanels.map((panel) => (
          // Heading and tilt MUST compose as heading-then-tilt (tilt about
          // the module's own across-axis). A single Euler with the default
          // XYZ order tilts about the WORLD x-axis instead, which rolls
          // east/west-facing modules onto their sides — nested groups make
          // the composition explicit and order-proof.
          <group
            key={panel.key}
            position={panel.position}
            rotation-y={panel.rotation[1]}
          >
            <group rotation-x={panel.rotation[0]}>
              {/* Aluminum frame */}
              <mesh>
                <boxGeometry
                  args={[
                    panel.acrossMeters,
                    PANEL_THICKNESS_METERS,
                    panel.alongMeters,
                  ]}
                />
                <meshStandardMaterial
                  color="#c7ced6"
                  roughness={0.4}
                  metalness={0.6}
                />
              </mesh>
              {/* Crystalline glass face */}
              <mesh position={[0, PANEL_THICKNESS_METERS / 2 + 0.002, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <planeGeometry
                  args={[panel.acrossMeters - 0.045, panel.alongMeters - 0.045]}
                />
                <meshStandardMaterial
                  color="#10192b"
                  roughness={0.35}
                  metalness={0.3}
                />
              </mesh>
            </group>
          </group>
        ))}

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={Math.max(80, data.extentMeters * 2)}
          maxPolarAngle={Math.PI * 0.47}
          target={[0, Math.min(3, data.roofTopMeters * 0.5), 0]}
        />
        <ForceRender trigger={`${showFlux}|${visiblePanels.length}`} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-[0.6rem] uppercase tracking-[0.18em] text-slate-300 backdrop-blur">
        Drag to orbit · Scroll to zoom
      </div>
      {data.obstructions.length > 0 ? (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-[0.6rem] font-medium tracking-[0.06em] text-slate-300 backdrop-blur">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400/80" />
          Shading obstruction (detected)
        </div>
      ) : null}
    </div>
  );
}

/**
 * Paint a frame whenever `trigger` changes. The animation loop normally
 * handles this, but throttled tabs suspend requestAnimationFrame — this
 * keeps toggles (sunlight, panel count) visible there too.
 */
function ForceRender({ trigger }: { trigger: string }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    gl.render(scene, camera);
  }, [gl, scene, camera, trigger]);

  return null;
}

function SceneMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(120%_90%_at_50%_0%,#131c2e_0%,#0b1322_55%,#060b16_100%)] text-center">
      {children}
    </div>
  );
}

function isWebGlAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    );
  } catch {
    return false;
  }
}

function buildSceneData({
  dsm,
  flux,
  mask,
  roofData,
}: {
  dsm: GeoTiffRaster;
  flux: GeoTiffRaster | null;
  mask: GeoTiffRaster | null;
  roofData: RoofAnalysis;
}): SceneData | null {
  const focusBounds = resolveFocusBounds(roofData, dsm.bounds);
  const cropBounds = expandBoundsMeters(focusBounds, SCENE_PADDING_METERS);
  const origin = boundsCenter(cropBounds);
  const groundElevationMeters = estimateGroundElevationMeters(dsm.raster);

  const fluxCanvas = flux ? buildFluxCanvas(flux, mask) : null;
  const fluxTexture = fluxCanvas ? makeCanvasTexture(fluxCanvas) : null;

  // One fitted plane per segment (from panel-center DSM samples) — the
  // shared surface for BOTH the roof faces and the panel arrays, so
  // modules always sit flush on their face.
  const segmentPlanes = fitSegmentPlanes({
    panels: roofData.solarPanels,
    raster: dsm.raster,
    width: dsm.width,
    height: dsm.height,
    bounds: dsm.bounds,
    origin,
    groundElevationMeters,
    fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
  });

  // Extruded roof faces: one crisp plane per segment outline.
  const faces: FaceMesh[] = [];
  let roofTopMeters = 0;

  if (roofData.roofBounds) {
    roofData.roofSegments.forEach((segment, index) => {
      const outline = normalizedOutlineToLatLng(
        segment.outline,
        roofData.roofBounds!
      );
      const geometry = buildRoofFaceGeometry({
        outline,
        pitchDeg: segment.pitchDeg,
        azimuthDeg: segment.azimuthDeg,
        origin,
        raster: dsm.raster,
        width: dsm.width,
        height: dsm.height,
        bounds: dsm.bounds,
        groundElevationMeters,
        fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
        textureBounds: flux?.bounds ?? null,
        plane:
          segment.segmentIndex !== undefined
            ? segmentPlanes.get(segment.segmentIndex)
            : undefined,
      });

      if (!geometry) {
        return;
      }

      const roof = new THREE.BufferGeometry();
      roof.setAttribute(
        "position",
        new THREE.BufferAttribute(geometry.positions, 3)
      );
      roof.setAttribute("uv", new THREE.BufferAttribute(geometry.uvs, 2));
      roof.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
      roof.computeVertexNormals();

      const wall = new THREE.BufferGeometry();
      wall.setAttribute(
        "position",
        new THREE.BufferAttribute(geometry.wallPositions, 3)
      );
      wall.setIndex(new THREE.BufferAttribute(geometry.wallIndices, 1));
      wall.computeVertexNormals();

      faces.push({
        key: index,
        roof,
        roofEdges: new THREE.EdgesGeometry(roof, 12),
        wall,
      });
      roofTopMeters = Math.max(roofTopMeters, geometry.maxHeightMeters);
    });
  }

  if (!faces.length && !roofData.solarPanels.length) {
    fluxTexture?.dispose();
    return null;
  }

  // Detected shading obstructions as low roof-mounted marker prisms.
  const obstructions: ObstructionMesh[] = [];

  if (roofData.roofBounds) {
    roofData.obstructionOutlines.forEach((rawOutline, index) => {
      const outline = normalizedOutlineToLatLng(
        rawOutline,
        roofData.roofBounds!
      );
      const geometry = buildObstructionMarkerGeometry({
        outline,
        origin,
        raster: dsm.raster,
        width: dsm.width,
        height: dsm.height,
        bounds: dsm.bounds,
        groundElevationMeters,
        fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
      });

      if (!geometry) {
        return;
      }

      const top = new THREE.BufferGeometry();
      top.setAttribute(
        "position",
        new THREE.BufferAttribute(geometry.positions, 3)
      );
      top.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
      top.computeVertexNormals();

      const wall = new THREE.BufferGeometry();
      wall.setAttribute(
        "position",
        new THREE.BufferAttribute(geometry.wallPositions, 3)
      );
      wall.setIndex(new THREE.BufferAttribute(geometry.wallIndices, 1));
      wall.computeVertexNormals();

      obstructions.push({ key: index, top, wall });
    });
  }

  // One fitted plane per roof segment: modules mount coplanar like a real
  // racked array instead of following per-sample DSM noise.
  const transforms = buildSegmentPlaneTransforms({
    panels: roofData.solarPanels,
    raster: dsm.raster,
    width: dsm.width,
    height: dsm.height,
    bounds: dsm.bounds,
    origin,
    groundElevationMeters,
    panelWidthMeters: roofData.panelWidthMeters,
    panelHeightMeters: roofData.panelHeightMeters,
    fallbackElevationMeters: DEFAULT_FACE_HEIGHT_METERS,
  });

  const panels = transforms.flatMap((transform, index) => {
    if (!transform) {
      return [];
    }

    roofTopMeters = Math.max(roofTopMeters, transform.position.y);

    return [
      {
        key: index,
        position: [
          transform.position.x,
          transform.position.y,
          transform.position.z,
        ] as [number, number, number],
        rotation: [transform.tiltRad, transform.headingRad, 0] as [
          number,
          number,
          number,
        ],
        alongMeters: transform.alongMeters,
        acrossMeters: transform.acrossMeters,
      },
    ];
  });

  const northeastLocal = latLngToLocalMeters(cropBounds.northeast, origin);
  const southwestLocal = latLngToLocalMeters(cropBounds.southwest, origin);
  const extentMeters = Math.max(
    Math.abs(northeastLocal.x - southwestLocal.x),
    Math.abs(northeastLocal.z - southwestLocal.z)
  );

  return {
    faces,
    obstructions,
    fluxTexture,
    panels,
    extentMeters,
    roofTopMeters: roofTopMeters || DEFAULT_FACE_HEIGHT_METERS,
  };
}

function resolveFocusBounds(
  roofData: RoofAnalysis,
  dsmBounds: RoofGeoBounds
): RoofGeoBounds {
  if (roofData.roofBounds) {
    return roofData.roofBounds;
  }

  const centers = roofData.solarPanels
    .map((panel) => panel.center)
    .filter(
      (center): center is LatLng =>
        Number.isFinite(center?.lat) && Number.isFinite(center?.lng)
    );

  if (centers.length >= 2) {
    return {
      northeast: {
        lat: Math.max(...centers.map((center) => center.lat)),
        lng: Math.max(...centers.map((center) => center.lng)),
      },
      southwest: {
        lat: Math.min(...centers.map((center) => center.lat)),
        lng: Math.min(...centers.map((center) => center.lng)),
      },
    };
  }

  // Last resort: a small box around the DSM center.
  const center = boundsCenter(dsmBounds);
  return expandBoundsMeters(
    { northeast: { ...center }, southwest: { ...center } },
    12
  );
}

/**
 * Continuous irradiance gradient canvas from the annual-flux GeoTIFF —
 * the Aurora-style heatmap draped over the clean roof faces. Pixels
 * without usable flux (or off the roof mask) fall back to the neutral
 * roof tone so untextured spots blend with the default material.
 */
function buildFluxCanvas(
  flux: GeoTiffRaster,
  mask: GeoTiffRaster | null
): HTMLCanvasElement | null {
  const fluxPixelCount = flux.width * flux.height;

  if (!fluxPixelCount) {
    return null;
  }

  const validValues: number[] = [];

  for (let index = 0; index < fluxPixelCount; index += 1) {
    const value = Number(flux.raster[index]);
    if (
      Number.isFinite(value) &&
      value > -9990 &&
      (!mask || isMaskedRoofPixel(flux, mask, index))
    ) {
      validValues.push(value);
    }
  }

  if (!validValues.length) {
    return null;
  }

  validValues.sort((left, right) => left - right);
  const low = percentileValue(validValues, 0.08);
  const high = percentileValue(validValues, 0.92);
  const range = Math.max(high - low, 1);

  const canvas = document.createElement("canvas");
  canvas.width = flux.width;
  canvas.height = flux.height;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const imageData = context.createImageData(flux.width, flux.height);
  const pixels = imageData.data;
  const neutral = { r: 232, g: 228, b: 220 };

  for (let index = 0; index < fluxPixelCount; index += 1) {
    const value = Number(flux.raster[index]);
    const target = index * 4;
    const valid = Number.isFinite(value) && value > -9990;

    const color = valid
      ? fluxRampColor(Math.max(0, Math.min(1, (value - low) / range)))
      : neutral;

    pixels[target] = color.r;
    pixels[target + 1] = color.g;
    pixels[target + 2] = color.b;
    pixels[target + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

/** Nearest-neighbor mask lookup by geographic position of a flux pixel. */
function isMaskedRoofPixel(
  flux: GeoTiffRaster,
  mask: GeoTiffRaster,
  fluxIndex: number
) {
  const column = fluxIndex % flux.width;
  const row = Math.floor(fluxIndex / flux.width);
  const lat =
    flux.bounds.northeast.lat -
    ((row + 0.5) / flux.height) *
      (flux.bounds.northeast.lat - flux.bounds.southwest.lat);
  const lng =
    flux.bounds.southwest.lng +
    ((column + 0.5) / flux.width) *
      (flux.bounds.northeast.lng - flux.bounds.southwest.lng);

  const maskLatSpan = mask.bounds.northeast.lat - mask.bounds.southwest.lat;
  const maskLngSpan = mask.bounds.northeast.lng - mask.bounds.southwest.lng;

  if (maskLatSpan <= 0 || maskLngSpan <= 0) {
    return true;
  }

  const maskColumn = Math.floor(
    ((lng - mask.bounds.southwest.lng) / maskLngSpan) * mask.width
  );
  const maskRow = Math.floor(
    ((mask.bounds.northeast.lat - lat) / maskLatSpan) * mask.height
  );

  if (
    maskColumn < 0 ||
    maskRow < 0 ||
    maskColumn >= mask.width ||
    maskRow >= mask.height
  ) {
    return false;
  }

  return Number(mask.raster[maskRow * mask.width + maskColumn] ?? 0) > 0;
}

/** Same ramp as the 2D Sunlight view: shade blue -> warm amber -> sunny orange. */
function fluxRampColor(value: number) {
  const shade = { r: 30, g: 64, b: 175 };
  const warm = { r: 251, g: 191, b: 36 };
  const sunny = { r: 249, g: 115, b: 22 };
  const mix = (
    left: { r: number; g: number; b: number },
    right: { r: number; g: number; b: number },
    amount: number
  ) => ({
    r: Math.round(left.r + (right.r - left.r) * amount),
    g: Math.round(left.g + (right.g - left.g) * amount),
    b: Math.round(left.b + (right.b - left.b) * amount),
  });

  return value <= 0.5
    ? mix(shade, warm, value / 0.5)
    : mix(warm, sunny, (value - 0.5) / 0.5);
}

function percentileValue(sorted: number[], ratio: number) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * ratio))
  );
  return sorted[index] ?? 0;
}

function makeCanvasTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
