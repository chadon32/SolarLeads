"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Focus, Hand, Minus, Plus, RotateCcw, Square, Trees, X } from "lucide-react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Edges, Line } from "@react-three/drei";
import { SunlightLegend } from "@/components/sunlight-legend";
import { readGeoTiffRaster, SolarRasterLoadError } from "@/lib/geotiff-utils";
import { DEFAULT_MODULE_FACE, type ModuleFaceLayout } from "@/lib/module-face";
import { selectCohesiveSolarPanels } from "@/lib/panel-layout";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import { describeRoofFace, summarizeRoofFaces, type RoofFaceFacts } from "@/lib/roof-face-labels";
import { isRoofReconstructionEnabled, runRoofModel } from "@/lib/roof-model-runner";
import type { RoofObstruction } from "@/lib/roof-reconstruction";
import { CameraRig } from "./roof-scene/camera-rig";
import { ModuleOutlines, PanelArray, useModuleSkin } from "./roof-scene/panel-array";
import {
  buildRebuiltScene,
  buildSegmentScene,
  disposeScene,
  prepareScene,
  roofModelJobFor,
  type RebuiltShell,
  type SceneData,
  type SegmentShell,
} from "./roof-scene/scene-data";
import { GroundPlane, SceneLighting } from "./roof-scene/scene-environment";
import { Surroundings } from "./roof-scene/surroundings";
import { useCoarsePointer, usePrefersReducedMotion } from "./roof-scene/use-media-query";
import { useOverlaySafeInsets, VIEWER_OVERLAY_ATTRIBUTE } from "./roof-scene/use-overlay-safe-insets";
import { useRefreshShadows } from "./roof-scene/use-refresh-shadows";

type RoofScene3DProps = {
  dsmUrl: string | null;
  rgbUrl: string | null;
  fluxUrl: string | null;
  maskUrl: string | null;
  panelHeightMeters: number;
  panelWidthMeters: number;
  roofData: RoofAnalysis;
  selectedPanelCount: number;
  showSunlight: boolean;
  /** Datasheet face of the selected module (cell layout, colours). */
  moduleFace?: ModuleFaceLayout;
  /** Offered when the 3D view cannot be shown. */
  onRequestMapView?: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; retryable: boolean }
  | { status: "ready"; data: SceneData };

// Roof and walls separated in value, so planes read before lighting does.
const ROOF_COLOR = "#dcd6cb";
const WALL_COLOR = "#a9a194";
const FASCIA_COLOR = "#3a3f47";
const EDGE_COLOR = "#38475a";
const HIGHLIGHT_COLOR = "#67e8f9";

// rgbUrl stays in the props contract but the CAD view does not need the aerial photo.
export default function RoofScene3D({
  dsmUrl,
  fluxUrl,
  maskUrl,
  panelHeightMeters,
  panelWidthMeters,
  roofData,
  selectedPanelCount,
  showSunlight,
  moduleFace = DEFAULT_MODULE_FACE,
  onRequestMapView,
}: RoofScene3DProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const instructionsId = useId();
  const summaryId = useId();
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const [cameraCommand, setCameraCommand] = useState({ action: "fit", sequence: 0 });
  const [modelKey, setModelKey] = useState(0);
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  const [showSurroundings, setShowSurroundings] = useState(true);
  const [exploring, setExploring] = useState(false);
  const coarsePointer = useCoarsePointer();
  const reducedMotion = usePrefersReducedMotion();
  const safeInsets = useOverlaySafeInsets(region);
  const sendCameraCommand = (action: string) => setCameraCommand((previous) => ({ action, sequence: previous.sequence + 1 }));

  // Reset to loading when the data-layer inputs change ("adjust state during render").
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
        setState({ status: "error", message: "3D model data is not available for this address.", retryable: true });
        return;
      }
      if (!isWebGlAvailable()) {
        setState({ status: "error", message: "This device does not support the 3D roof view.", retryable: false });
        return;
      }
      try {
        const fallbackBounds = roofData.roofBounds ?? null;
        const [dsm, flux, mask] = await Promise.all([
          readGeoTiffRaster(dsmUrl, fallbackBounds),
          fluxUrl ? readGeoTiffRaster(fluxUrl, fallbackBounds).catch(() => null) : Promise.resolve(null),
          maskUrl ? readGeoTiffRaster(maskUrl, fallbackBounds).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (!dsm) {
          setState({ status: "error", message: "3D model data is not available for this address.", retryable: true });
          return;
        }
        const inputs = { dsm, flux, mask, roofData };
        const prepared = prepareScene(inputs);
        // The rebuilt single-shell roof runs in a worker; without a rooftop
        // mask, with the flag off, or on timeout the per-segment model is used.
        const job = isRoofReconstructionEnabled() ? roofModelJobFor(inputs, prepared) : null;
        const model = job ? await runRoofModel(job, { cacheKey: modelCacheKey(dsmUrl, maskUrl, fluxUrl, roofData) }) : null;
        if (cancelled) return;
        const data = model ? buildRebuiltScene(inputs, prepared, model) : buildSegmentScene(inputs, prepared);
        if (!data) {
          setState({ status: "error", message: "The 3D model could not be built for this address.", retryable: true });
          return;
        }
        setState({ status: "ready", data });
      } catch (error) {
        console.warn("[roof-scene-3d:error]", { errorType: error instanceof Error ? error.name : "unknown" });
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof SolarRasterLoadError ? error.message : "The 3D model could not be loaded. Please try again.",
            retryable: true,
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dsmUrl, fluxUrl, maskUrl, roofData, modelKey]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { data } = state;
    return () => disposeScene(data);
  }, [state]);

  // Fiber can miss the late mount after the async load; force a re-measure.
  useEffect(() => {
    if (state.status !== "ready") return;
    const handle = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => window.clearTimeout(handle);
  }, [state.status]);

  const skin = useModuleSkin(moduleFace, panelHeightMeters / panelWidthMeters);
  const readyData = state.status === "ready" ? state.data : null;

  // A new scene clears any face selection ("adjust state during render").
  const [selectionScope, setSelectionScope] = useState<SceneData | null>(readyData);
  if (selectionScope !== readyData) {
    setSelectionScope(readyData);
    setSelectedFace(null);
  }

  // Cohesive-subset selection walks every candidate module; keep it off unrelated rerenders.
  const visiblePanels = useMemo(() => {
    if (!readyData) return [];
    const selected = new Set(
      selectCohesiveSolarPanels({ panels: roofData.solarPanels, targetCount: selectedPanelCount, panelWidthMeters, panelHeightMeters })
    );
    const selectedIndices = new Set(roofData.solarPanels.flatMap((panel, index) => (selected.has(panel) ? [index] : [])));
    return readyData.panels.flatMap((panel) => {
      if (!selectedIndices.has(panel.key)) return [];
      const landscape = roofData.solarPanels[panel.key]?.orientation === "LANDSCAPE";
      return [{ ...panel, alongMeters: landscape ? panelWidthMeters : panelHeightMeters, acrossMeters: landscape ? panelHeightMeters : panelWidthMeters }];
    });
  }, [panelHeightMeters, panelWidthMeters, readyData, roofData, selectedPanelCount]);

  const faceFacts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const panel of visiblePanels) counts.set(panel.segmentIndex, (counts.get(panel.segmentIndex) ?? 0) + 1);
    return new Map(
      (readyData?.faces ?? []).map((face): [number, RoofFaceFacts] => [
        face.id,
        { ...face, moduleCount: face.segmentIndex === null ? 0 : counts.get(face.segmentIndex) ?? 0 },
      ])
    );
  }, [readyData, visiblePanels]);

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
        <p className="text-sm font-semibold text-slate-100">3D view unavailable</p>
        <p className="max-w-xs text-xs text-slate-300">{state.message}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {state.retryable ? (
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setModelKey((value) => value + 1);
              }}
              className="min-h-11 rounded-full border border-cyan-200/30 px-5 text-sm text-cyan-100 focus-visible:outline-2 focus-visible:outline-cyan-200"
            >
              Retry 3D model
            </button>
          ) : null}
          {onRequestMapView ? (
            <button type="button" onClick={onRequestMapView} className="min-h-11 rounded-full border border-white/20 px-5 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-200">
              Switch to map view
            </button>
          ) : null}
        </div>
      </SceneMessage>
    );
  }

  const { data } = state;
  const cameraDistance = Math.max(24, data.extentMeters * 0.85);
  const showFlux = showSunlight && data.fluxTexture !== null;
  // The shadow frustum has to enclose the model and nearby trees.
  const shadowExtent = Math.max(20, data.extentMeters * 0.75);
  const hasSurroundings = Boolean(data.context && (data.context.trees.length || data.context.buildings.length));
  const locked = coarsePointer && !exploring;
  const selected = selectedFace !== null ? faceFacts.get(selectedFace) : undefined;
  const selectedText = selected ? describeRoofFace(selected) : null;
  const summary = [
    summarizeRoofFaces([...faceFacts.values()]),
    data.obstructions.length ? `${data.obstructions.length} raised rooftop feature${data.obstructions.length === 1 ? "" : "s"} from the elevation scan.` : "",
    hasSurroundings ? `${data.context!.trees.length} trees and ${data.context!.buildings.length} neighbouring roofs from the elevation scan.` : "",
  ].filter(Boolean).join(" ");

  const surroundingsToggle = (
    <button
      type="button"
      aria-label="Trees and nearby roofs"
      aria-pressed={showSurroundings}
      title="Trees and nearby roofs from the elevation scan"
      onClick={() => setShowSurroundings((value) => !value)}
      className={`flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-xl focus-visible:outline-2 focus-visible:outline-cyan-200 ${showSurroundings ? "bg-white/10" : "hover:bg-white/10"}`}
    >
      <Trees className="h-4 w-4" aria-hidden="true" />
      <span aria-hidden="true" className="text-[9px] font-medium">Trees</span>
    </button>
  );
  const doneButton = (
    <button
      type="button"
      aria-label="Stop exploring the 3D model"
      onClick={() => setExploring(false)}
      className="min-h-11 rounded-xl px-3 text-xs font-semibold text-cyan-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200"
    >
      Done
    </button>
  );

  return (
    <div
      ref={setRegion}
      className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-200"
      data-panel-height-meters={panelHeightMeters}
      data-panel-width-meters={panelWidthMeters}
      data-rendered-panel-count={visiblePanels.length}
      data-roof-model={data.mode}
      data-face-count={data.faces.length}
      data-tree-count={data.context?.trees.length ?? 0}
      data-neighbor-count={data.context?.buildings.length ?? 0}
      data-testid="roof-scene-3d"
      role="region"
      aria-label="Interactive preliminary 3D roof model"
      aria-describedby={`${instructionsId} ${summaryId}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const actions: Record<string, string> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", Home: "fit" };
        if (actions[event.key]) {
          event.preventDefault();
          sendCameraCommand(actions[event.key]);
        }
        if (event.key === "Escape") setSelectedFace(null);
      }}
    >
      <p id={instructionsId} className="sr-only">
        Arrow keys rotate; plus and minus zoom; Home resets. Elevation-based roof model. Mounting hardware is illustrative, not an installation design.
      </p>
      <p id={summaryId} className="sr-only">{summary}</p>
      <Canvas
        dpr={[1, 2]}
        frameloop="demand"
        // The light and the roof are static: shadows are re-rendered when content changes, not on every orbit frame.
        shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
        camera={{ fov: 42, near: 0.5, far: 2000, position: [cameraDistance * 0.5, cameraDistance * 0.85, cameraDistance * 0.55] }}
        // Khronos PBR Neutral tone mapping: highlights roll off instead of
        // clipping, and base colours stay true. The heatmap opts out per material.
        gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 0.9 }}
        onCreated={(created) => {
          // Paint the first frame immediately (e.g. throttled background tabs).
          created.gl.render(created.scene, created.camera);
        }}
        onPointerMissed={() => setSelectedFace(null)}
        style={{ background: "radial-gradient(120% 90% at 50% 0%, #131c2e 0%, #0b1322 55%, #060b16 100%)" }}
      >
        <SceneLighting shadowExtent={shadowExtent} />
        <GroundPlane extentMeters={data.extentMeters} />
        {data.shell ? (
          <RebuiltRoof shell={data.shell} fluxTexture={showFlux ? data.fluxTexture : null} selectedFace={selectedFace} onSelectFace={setSelectedFace} />
        ) : null}
        {data.segmentShells.map((shell) => (
          <SegmentRoof
            key={shell.faceId}
            shell={shell}
            fluxTexture={showFlux ? data.fluxTexture : null}
            selected={selectedFace === shell.faceId}
            onSelectFace={setSelectedFace}
          />
        ))}
        {data.obstructions.length ? <RooftopFeatures obstructions={data.obstructions} /> : null}
        {data.context && showSurroundings ? <Surroundings context={data.context} /> : null}
        <PanelArray panels={visiblePanels} skin={skin} capacity={roofData.solarPanels.length} animate={!reducedMotion} />
        <ModuleOutlines panels={visiblePanels} />
        <CameraRig bounds={data.modelBounds} command={cameraCommand} safeInsets={safeInsets} />
        <ForceRender trigger={`${showFlux}|${visiblePanels.length}|${panelHeightMeters}|${panelWidthMeters}|${showSurroundings}|${selectedFace}`} />
      </Canvas>

      {locked ? (
        // Touch devices: one-finger swipes keep scrolling the page until the visitor opts in.
        <button
          type="button"
          onClick={() => setExploring(true)}
          aria-label="Explore the 3D model"
          className="absolute inset-0 z-10 flex items-end justify-center bg-transparent pb-[5.25rem] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-200"
        >
          <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-slate-950/80 px-4 text-sm font-medium text-slate-100 shadow-lg backdrop-blur">
            <Hand className="h-4 w-4" aria-hidden="true" />
            Tap to explore in 3D
          </span>
        </button>
      ) : null}

      {selected && selectedText ? (
        // Centred at the top of the overlay-free area the camera frames into, so it never lands on a panel.
        <div
          role="status"
          className="absolute z-20 mx-auto max-w-[20rem] rounded-2xl border border-white/15 bg-slate-950/90 px-3.5 py-2.5 text-slate-100 shadow-lg backdrop-blur"
          style={{ top: safeInsets.top + 8, left: safeInsets.left + 12, right: safeInsets.right + 12 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{selectedText.title}</p>
              <p className="mt-0.5 text-xs text-slate-300">{selectedText.details.join(" · ")}</p>
            </div>
            <button
              type="button"
              aria-label="Close roof face details"
              onClick={() => setSelectedFace(null)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Phones: secondary controls sit in the free top-right corner so the camera row stays on one line. */}
      {hasSurroundings || (coarsePointer && exploring) ? (
        <div {...{ [VIEWER_OVERLAY_ATTRIBUTE]: "" }} className="absolute right-3 top-3 z-20 flex gap-1 rounded-2xl border border-white/15 bg-slate-950/90 p-1 text-slate-100 shadow-lg backdrop-blur sm:hidden">
          {coarsePointer && exploring ? doneButton : null}
          {hasSurroundings ? surroundingsToggle : null}
        </div>
      ) : null}

      <div
        {...{ [VIEWER_OVERLAY_ATTRIBUTE]: "" }}
        className="absolute bottom-3 left-3 z-20 max-w-[calc(100%-1.5rem)] rounded-2xl border border-white/15 bg-slate-950/90 p-1.5 text-slate-100 shadow-lg backdrop-blur"
      >
        {showFlux ? (
          // On phones the legend lives in the map controls panel below the canvas.
          <div className="hidden px-1.5 pb-2 pt-1 sm:block">
            <SunlightLegend />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          <div role="toolbar" aria-label="3D camera controls" className="flex flex-wrap gap-1">
            {[
              { action: "fit", label: "Reset 3D view", caption: "Reset", Icon: RotateCcw },
              { action: "top", label: "View roof from above", caption: "Top", Icon: Square },
              { action: "perspective", label: "View roof in perspective", caption: "3D", Icon: Focus },
              { action: "zoom-out", label: "Zoom out of roof", caption: "", Icon: Minus },
              { action: "zoom-in", label: "Zoom into roof", caption: "", Icon: Plus },
            ].map(({ action, label, caption, Icon }) => (
              <button
                key={action}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => sendCameraCommand(action)}
                className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {caption ? <span aria-hidden="true" className="text-[9px] font-medium">{caption}</span> : null}
              </button>
            ))}
          </div>
          {hasSurroundings ? <div className="hidden sm:flex">{surroundingsToggle}</div> : null}
          {coarsePointer && exploring ? <div className="hidden sm:flex">{doneButton}</div> : null}
        </div>
        {/* w-0 + min-w-full: the hint wraps to the controls' width instead of widening the card under neighbouring panels. */}
        <p className="hidden w-0 min-w-full px-1.5 pb-0.5 pt-1 text-[10px] leading-snug text-slate-300 sm:block">
          {locked ? "Swipe to scroll. Tap the model to explore." : "Drag to orbit. Pinch or use + / - to zoom. Tap a roof face for details."}
          {data.obstructions.length ? " Grey blocks are raised features in the elevation scan." : ""}
        </p>
      </div>
    </div>
  );
}

function RebuiltRoof({
  shell,
  fluxTexture,
  selectedFace,
  onSelectFace,
}: {
  shell: RebuiltShell;
  fluxTexture: THREE.CanvasTexture | null;
  selectedFace: number | null;
  onSelectFace: (face: number | null) => void;
}) {
  const highlight = useMemo(() => faceHighlightGeometry(shell, selectedFace), [shell, selectedFace]);
  useEffect(() => () => highlight?.dispose(), [highlight]);
  const select = (event: ThreeEvent<MouseEvent>) => {
    // Ignore the click that ends an orbit drag.
    if (event.delta > 6 || event.faceIndex === undefined || event.faceIndex === null) return;
    event.stopPropagation();
    onSelectFace(shell.triangleFaces[event.faceIndex] ?? null);
  };
  return (
    <group>
      <mesh geometry={shell.roof} castShadow receiveShadow onClick={select}>
        <RoofMaterial fluxTexture={fluxTexture} flatShading />
      </mesh>
      <mesh geometry={shell.walls} castShadow receiveShadow>
        <meshStandardMaterial color={WALL_COLOR} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {shell.cliffs ? (
        <mesh geometry={shell.cliffs} castShadow receiveShadow>
          <meshStandardMaterial color={WALL_COLOR} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      <mesh geometry={shell.fascia} castShadow>
        <meshStandardMaterial color={FASCIA_COLOR} roughness={0.8} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* Ridges, hips and valleys are exact plane intersections; resolution-independent 1.25 px CAD lines. */}
      {shell.creaseLines.length ? <Line segments points={shell.creaseLines} color={EDGE_COLOR} lineWidth={1.25} /> : null}
      {shell.eaveLines.length ? <Line segments points={shell.eaveLines} color={EDGE_COLOR} lineWidth={1.25} /> : null}
      {highlight ? (
        <mesh geometry={highlight} renderOrder={2}>
          <HighlightMaterial />
        </mesh>
      ) : null}
    </group>
  );
}

function SegmentRoof({
  shell,
  fluxTexture,
  selected,
  onSelectFace,
}: {
  shell: SegmentShell;
  fluxTexture: THREE.CanvasTexture | null;
  selected: boolean;
  onSelectFace: (face: number | null) => void;
}) {
  return (
    <group>
      <mesh
        geometry={shell.roof}
        castShadow
        receiveShadow
        onClick={(event) => {
          if (event.delta > 6) return;
          event.stopPropagation();
          onSelectFace(shell.faceId);
        }}
      >
        <RoofMaterial fluxTexture={fluxTexture} />
        <Edges threshold={14} color={EDGE_COLOR} lineWidth={1.25} />
      </mesh>
      <mesh geometry={shell.walls} castShadow receiveShadow>
        <meshStandardMaterial color={WALL_COLOR} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {selected ? (
        <mesh geometry={shell.roof} renderOrder={2}>
          <HighlightMaterial />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Distinct keys force a fresh material on swap — mutating `map` on a live
 * material skips the shader recompile and the texture silently never shows.
 * The heatmap is data, not a surface: unlit and outside tone mapping, so
 * every face shows exactly the legend colour; the edges carry the form.
 */
function RoofMaterial({ fluxTexture, flatShading = false }: { fluxTexture: THREE.CanvasTexture | null; flatShading?: boolean }) {
  return fluxTexture ? (
    <meshBasicMaterial key="flux" map={fluxTexture} toneMapped={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
  ) : (
    <meshStandardMaterial key="plain" color={ROOF_COLOR} roughness={0.85} metalness={0} flatShading={flatShading} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
  );
}

function HighlightMaterial() {
  return (
    <meshBasicMaterial
      color={HIGHLIGHT_COLOR}
      transparent
      opacity={0.32}
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
      polygonOffset
      polygonOffsetFactor={-2}
      polygonOffsetUnits={-2}
    />
  );
}

/** Raised rooftop features detected in the elevation scan (units, vents, chimneys). */
function RooftopFeatures({ obstructions }: { obstructions: RoofObstruction[] }) {
  return (
    <group>
      {obstructions.map((feature, index) => (
        <mesh key={index} position={[feature.x, (feature.baseM + feature.topM) / 2, feature.z]} castShadow receiveShadow>
          <boxGeometry args={[Math.max(0.3, feature.widthM), Math.max(0.2, feature.topM - feature.baseM), Math.max(0.3, feature.depthM)]} />
          <meshStandardMaterial color="#8b95a3" roughness={0.7} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

/** The selected face's triangles as their own small geometry (never shares buffers with the roof). */
function faceHighlightGeometry(shell: RebuiltShell, face: number | null) {
  if (face === null || !shell.roof.index) return null;
  const index = shell.roof.index.array;
  const positions = shell.roof.getAttribute("position").array;
  const out: number[] = [];
  for (let triangle = 0; triangle < shell.triangleFaces.length; triangle++) {
    if (shell.triangleFaces[triangle] !== face) continue;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index[triangle * 3 + corner];
      out.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    }
  }
  if (!out.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return geometry;
}

/** Request a frame and a shadow-map refresh for changed content; the idle scene needs no animation loop. */
function ForceRender({ trigger }: { trigger: string }) {
  const refreshShadows = useRefreshShadows();
  useEffect(() => {
    refreshShadows();
  }, [refreshShadows, trigger]);
  return null;
}

function SceneMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(120%_90%_at_50%_0%,#131c2e_0%,#0b1322_55%,#060b16_100%)] text-center">
      {children}
    </div>
  );
}

function modelCacheKey(dsmUrl: string, maskUrl: string | null, fluxUrl: string | null, roofData: RoofAnalysis) {
  const first = roofData.solarPanels[0]?.center;
  return [dsmUrl, maskUrl, fluxUrl, roofData.solarPanels.length, first?.lat, first?.lng, roofData.annualSunlightHours].join("|");
}

function isWebGlAvailable() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

