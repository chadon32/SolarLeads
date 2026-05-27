"use client";

import { ContactShadows, Environment } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RoofAnalysis } from "@/lib/roof-analysis";

type HouseShowcaseProps = {
  selectedAddress?: string;
  analysis?: RoofAnalysis | null;
};

type ViewMode = "overview" | "scan" | "detail";

type RoofLayout = {
  main: RoofZone;
  garage: RoofZone;
};

type RoofZone = {
  id: string;
  width: number;
  depth: number;
  height: number;
  position: [number, number, number];
  panelCount: number;
  tilt: number;
};

type PanelPosition = {
  x: number;
  z: number;
};

const defaultAnalysis: RoofAnalysis = {
  zoom: 20,
  usableRoofPercent: 72,
  estimatedPanelCount: 22,
  estimatedSystemSizeKw: 9.2,
  estimatedAnnualSavings: 2346,
  estimatedMonthlySavings: 196,
  estimatedRoofAreaSqm: 60.1,
  estimatedUsableSolarAreaSqm: 43.3,
  estimatedRoofLengthMeters: 9.9,
  estimatedRoofWidthMeters: 6.1,
  roofPitchDegrees: 22,
  confidence: "medium",
};

const cameraPresets: Record<
  ViewMode,
  {
    position: [number, number, number];
    target: [number, number, number];
  }
> = {
  overview: {
    position: [15.5, 9.2, 15.5],
    target: [0.2, 2.4, 0.1],
  },
  scan: {
    position: [11.2, 7.4, 10.8],
    target: [0.8, 2.6, 0.5],
  },
  detail: {
    position: [7.6, 5.1, 7.2],
    target: [2.6, 2.5, 1.8],
  },
};

export function HouseShowcase({ selectedAddress, analysis }: HouseShowcaseProps) {
  const activeAnalysis = analysis ?? defaultAnalysis;
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [sceneLoading, setSceneLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [sceneDpr, setSceneDpr] = useState(1.5);

  useEffect(() => {
    const updateQuality = () => {
      const isSmallScreen = window.matchMedia("(max-width: 768px)").matches;
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const nextDpr = prefersReducedMotion ? 1 : isSmallScreen ? 1.1 : 1.5;

      setSceneDpr((current) => (current === nextDpr ? current : nextDpr));
    };

    updateQuality();

    const smallScreenQuery = window.matchMedia("(max-width: 768px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    smallScreenQuery.addEventListener("change", updateQuality);
    motionQuery.addEventListener("change", updateQuality);

    return () => {
      smallScreenQuery.removeEventListener("change", updateQuality);
      motionQuery.removeEventListener("change", updateQuality);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let settle = 0;

    const warmup = window.setTimeout(() => {
      setSceneLoading(true);
      setProgress(0);

      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = Math.min((now - start) / 1250, 1);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        setProgress(Math.round(eased * 100));

        if (elapsed < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          setSceneLoading(false);
        }
      };

      raf = requestAnimationFrame(tick);
      settle = window.setTimeout(() => setSceneLoading(false), 1300);
    }, 0);

    return () => {
      window.clearTimeout(warmup);
      window.clearTimeout(settle);
      cancelAnimationFrame(raf);
    };
  }, [selectedAddress, activeAnalysis.zoom, activeAnalysis.estimatedPanelCount]);

  const summary = useMemo(
    () => [
      {
        label: "Estimated monthly savings",
        value: `$${activeAnalysis.estimatedMonthlySavings.toLocaleString()}`,
      },
      {
        label: "Estimated yearly savings",
        value: `$${activeAnalysis.estimatedAnnualSavings.toLocaleString()}`,
      },
      {
        label: "Usable roof area",
        value: `${activeAnalysis.estimatedUsableSolarAreaSqm.toFixed(1)} sq m`,
      },
      {
        label: "Panel count",
        value: `${activeAnalysis.estimatedPanelCount}`,
      },
    ],
    [activeAnalysis]
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 px-1">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            3D rooftop visualization
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            See a modeled roof layout, panel placement, and system size based on the selected property.
          </p>
        </div>

        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-300 backdrop-blur-md">
          {(["overview", "scan", "detail"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-full px-3 py-2 transition ${
                viewMode === mode
                  ? "bg-white text-slate-950 shadow-[0_14px_30px_rgba(255,255,255,0.12)]"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[1.9rem] border border-white/10 bg-[linear-gradient(180deg,rgba(3,7,15,0.95),rgba(5,10,18,0.98))] shadow-[0_28px_100px_rgba(2,8,20,0.55)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(103,232,249,0.16),transparent_26%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.12),transparent_22%)]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] [background-size:70px_70px]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(2,8,20,0.72),transparent)]" />

        <div className="relative h-[31rem] sm:h-[36rem] house-scene">
          <Canvas
            shadows
            dpr={sceneDpr}
            camera={{ position: cameraPresets.overview.position, fov: 38, near: 0.1, far: 120 }}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          >
            <color attach="background" args={["#05080d"]} />
            <fog attach="fog" args={["#05080d", 20, 52]} />
            <ambientLight intensity={0.78} />
            <hemisphereLight intensity={1.05} groundColor="#07111d" color="#d8f4ff" />
            <directionalLight
              position={[11, 16, 8]}
              intensity={3.4}
              color="#fff4df"
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
            />
            <directionalLight position={[-8, 8, -10]} intensity={0.55} color="#67e8f9" />

            <Suspense fallback={null}>
              <RooftopScene analysis={activeAnalysis} viewMode={viewMode} />
              <Environment preset="sunset" />
              <ContactShadows
                position={[0, -0.01, 0]}
                opacity={0.38}
                scale={24}
                blur={2.6}
                far={12}
              />
            </Suspense>
          </Canvas>

          <div className="pointer-events-none absolute left-5 top-5 rounded-full border border-white/12 bg-slate-950/72 px-4 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-100 shadow-[0_14px_34px_rgba(2,8,23,0.35)] backdrop-blur-md">
            Estimated roof model
          </div>

          <div className="pointer-events-none absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-3">
            <div className="rounded-[1.2rem] border border-white/10 bg-slate-950/72 px-4 py-3 shadow-[0_18px_50px_rgba(2,8,20,0.38)] backdrop-blur-xl">
              <p className="text-[0.56rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Address
              </p>
              <p className="mt-1 text-sm leading-6 text-white">
                {selectedAddress || "Waiting for a property"}
              </p>
            </div>

            <div className="rounded-[1.2rem] border border-white/10 bg-slate-950/72 px-4 py-3 text-right shadow-[0_18px_50px_rgba(2,8,20,0.38)] backdrop-blur-xl">
              <p className="text-[0.56rem] font-semibold uppercase tracking-[0.34em] text-slate-400">
                Estimated size
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {activeAnalysis.estimatedSystemSizeKw.toFixed(1)} kW system
              </p>
            </div>
          </div>

          {sceneLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35 backdrop-blur-[2px]">
              <div className="w-[18rem] rounded-[1.4rem] border border-white/10 bg-slate-950/80 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.35)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                      Preparing preview
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      Loading the rooftop model and panel layout.
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tracking-tight text-white">{progress}%</p>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#67e8f9,#38bdf8,#e0f2fe)] transition-[width] duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => (
          <div
            key={item.label}
            className="glass-panel rounded-[1.4rem] p-4 shadow-[0_18px_50px_rgba(2,8,20,0.32)]"
          >
            <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-white">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RooftopScene({
  analysis,
  viewMode,
}: {
  analysis: RoofAnalysis;
  viewMode: ViewMode;
}) {
  const groupRef = useRef<THREE.Group | null>(null);
  const targetRef = useRef(new THREE.Vector3());
  const layout = useMemo(() => buildRoofLayout(analysis), [analysis]);

  useFrame(({ camera }, delta) => {
    const preset = cameraPresets[viewMode];
    const ease = 1 - Math.exp(-delta * 2.8);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, preset.position[0], ease);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, preset.position[1], ease);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, preset.position[2], ease);

    targetRef.current.lerp(
      new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]),
      ease
    );
    camera.lookAt(targetRef.current);

    if (groupRef.current) {
      const targetRotation =
        viewMode === "overview" ? -0.16 : viewMode === "scan" ? 0.08 : -0.3;
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        targetRotation,
        0.04
      );
    }
  });

  return (
    <group ref={groupRef}>
      <ArizonaBackdrop />
      <ModernHouse layout={layout} />
      <SolarArray layout={layout} />
      <ScanBeam layout={layout} />
    </group>
  );
}

function ArizonaBackdrop() {
  const hills = [
    { x: -12, y: 0, z: -16, s: 5.8 },
    { x: -7, y: 0, z: -17, s: 6.6 },
    { x: 0, y: 0, z: -18, s: 7.4 },
    { x: 8, y: 0, z: -17, s: 6.2 },
    { x: 15, y: 0, z: -16, s: 5.4 },
  ];

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[40, 32]} />
        <meshStandardMaterial color="#07111d" roughness={1} metalness={0} />
      </mesh>

      {hills.map((hill) => (
        <mesh
          key={`${hill.x}-${hill.z}`}
          position={[hill.x, hill.s * 0.4 - 0.3, hill.z]}
          rotation={[0, (hill.x / 8) * 0.12, 0]}
          castShadow
        >
          <coneGeometry args={[hill.s * 0.85, hill.s, 4]} />
          <meshStandardMaterial color="#0b1625" roughness={1} metalness={0} />
        </mesh>
      ))}

      <mesh position={[10, 10, -12]} castShadow>
        <sphereGeometry args={[1.1, 32, 32]} />
        <meshStandardMaterial
          color="#fcd34d"
          emissive="#f59e0b"
          emissiveIntensity={1.2}
          roughness={0.2}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
}

function ModernHouse({ layout }: { layout: RoofLayout }) {
  const main = layout.main;
  const garage = layout.garage;

  return (
    <group position={[0, 0, 0]}>
      <mesh castShadow receiveShadow position={[-0.35, main.height / 2, -0.15]}>
        <boxGeometry args={[main.width, main.height, main.depth]} />
        <meshStandardMaterial color="#d7dde6" roughness={0.9} metalness={0.04} />
      </mesh>

      <mesh
        castShadow
        receiveShadow
        position={[garage.position[0], garage.height / 2, garage.position[2]]}
      >
        <boxGeometry args={[garage.width, garage.height, garage.depth]} />
        <meshStandardMaterial color="#b8bec9" roughness={0.93} metalness={0.02} />
      </mesh>

      <mesh castShadow receiveShadow position={[0.25, main.height / 2 + 0.02, main.depth * 0.26]}>
        <boxGeometry args={[main.width * 0.28, main.height * 0.82, main.depth * 0.36]} />
        <meshStandardMaterial color="#8f6f5a" roughness={0.86} metalness={0.02} />
      </mesh>

      <mesh position={[-main.width * 0.26, main.height * 0.55, main.depth * 0.08]}>
        <boxGeometry args={[0.08, main.height * 0.7, main.depth * 0.55]} />
        <meshStandardMaterial color="#9ea8b4" roughness={0.92} metalness={0.02} />
      </mesh>

      <mesh position={[main.width * 0.12, main.height * 0.54, -main.depth * 0.06]}>
        <boxGeometry args={[main.width * 0.55, main.height * 0.66, 0.06]} />
        <meshStandardMaterial
          color="#121822"
          roughness={0.18}
          metalness={0.32}
          emissive="#13263a"
          emissiveIntensity={0.2}
        />
      </mesh>

      <mesh
        position={[garage.position[0], garage.height * 0.62, garage.position[2] + garage.depth * 0.32]}
      >
        <boxGeometry args={[garage.width * 0.72, garage.height * 0.48, 0.08]} />
        <meshStandardMaterial
          color="#0f172a"
          roughness={0.18}
          metalness={0.2}
          emissive="#183048"
          emissiveIntensity={0.12}
        />
      </mesh>

      <RoofDeck zone={main} />
      <RoofDeck zone={garage} />

      <mesh position={[-main.width * 0.42, 0.48, main.depth * 0.4]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 1.2, 7]} />
        <meshStandardMaterial color="#4c7f39" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[-main.width * 0.48, 0.22, main.depth * 0.28]} castShadow>
        <sphereGeometry args={[0.38, 18, 18]} />
        <meshStandardMaterial color="#5b8a44" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[-main.width * 0.38, 0.24, main.depth * 0.42]} castShadow>
        <sphereGeometry args={[0.34, 18, 18]} />
        <meshStandardMaterial color="#6b9c50" roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

function RoofDeck({ zone }: { zone: RoofZone }) {
  return (
    <group position={[zone.position[0], zone.height + 0.08, zone.position[2]]}>
      <mesh castShadow receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[zone.width * 0.96, 0.16, zone.depth * 0.96]} />
        <meshStandardMaterial color="#e5e9f0" roughness={0.92} metalness={0.02} />
      </mesh>
      <Parapet width={zone.width * 0.96} depth={zone.depth * 0.96} />
      <mesh position={[0, 0.15, 0]}>
        <planeGeometry args={[zone.width * 0.76, zone.depth * 0.72]} />
        <meshStandardMaterial color="#4ade80" transparent opacity={0.13} roughness={1} />
      </mesh>
      <DividingLines width={zone.width * 0.76} depth={zone.depth * 0.72} />
    </group>
  );
}

function Parapet({ width, depth }: { width: number; depth: number }) {
  const wallHeight = 0.36;
  const thickness = 0.14;

  return (
    <group>
      <mesh position={[0, wallHeight / 2 + 0.08, depth / 2 - thickness / 2]}>
        <boxGeometry args={[width, wallHeight, thickness]} />
        <meshStandardMaterial color="#d2d9e3" roughness={0.96} metalness={0.02} />
      </mesh>
      <mesh position={[0, wallHeight / 2 + 0.08, -depth / 2 + thickness / 2]}>
        <boxGeometry args={[width, wallHeight, thickness]} />
        <meshStandardMaterial color="#d2d9e3" roughness={0.96} metalness={0.02} />
      </mesh>
      <mesh position={[width / 2 - thickness / 2, wallHeight / 2 + 0.08, 0]}>
        <boxGeometry args={[thickness, wallHeight, depth]} />
        <meshStandardMaterial color="#d2d9e3" roughness={0.96} metalness={0.02} />
      </mesh>
      <mesh position={[-width / 2 + thickness / 2, wallHeight / 2 + 0.08, 0]}>
        <boxGeometry args={[thickness, wallHeight, depth]} />
        <meshStandardMaterial color="#d2d9e3" roughness={0.96} metalness={0.02} />
      </mesh>
    </group>
  );
}

function DividingLines({ width, depth }: { width: number; depth: number }) {
  return (
    <group position={[0, 0.171, 0]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[width, 0.01, 0.02]} />
        <meshBasicMaterial color="#8fd7ff" transparent opacity={0.12} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.02, 0.01, depth]} />
        <meshBasicMaterial color="#8fd7ff" transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function SolarArray({ layout }: { layout: RoofLayout }) {
  return (
    <group>
      <ZonePanels zone={layout.main} />
      <ZonePanels zone={layout.garage} />
    </group>
  );
}

function ZonePanels({ zone }: { zone: RoofZone }) {
  const positions = useMemo(
    () => buildPanelLayout(zone.width * 0.74, zone.depth * 0.66, zone.panelCount),
    [zone.width, zone.depth, zone.panelCount]
  );

  return (
    <group
      position={[zone.position[0], zone.height + 0.27, zone.position[2]]}
      rotation={[-zone.tilt, 0, 0]}
    >
      {positions.map((panel, index) => (
        <SolarPanel key={`${zone.id}-${index}`} position={panel} />
      ))}
    </group>
  );
}

function SolarPanel({ position }: { position: PanelPosition }) {
  return (
    <group position={[position.x, 0, position.z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.96, 0.08, 1.72]} />
        <meshStandardMaterial color="#0d1320" roughness={0.26} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.052, 0]}>
        <boxGeometry args={[0.88, 0.018, 1.62]} />
        <meshStandardMaterial
          color="#16324f"
          roughness={0.18}
          metalness={0.22}
          emissive="#0d2a43"
          emissiveIntensity={0.13}
        />
      </mesh>
      <mesh position={[0, 0.06, 0.63]}>
        <boxGeometry args={[0.84, 0.004, 0.06]} />
        <meshStandardMaterial color="#67e8f9" transparent opacity={0.16} />
      </mesh>
      <mesh position={[0, 0.06, -0.63]}>
        <boxGeometry args={[0.84, 0.004, 0.06]} />
        <meshStandardMaterial color="#67e8f9" transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

function ScanBeam({ layout }: { layout: RoofLayout }) {
  const beamRef = useRef<THREE.Mesh | null>(null);

  useFrame(({ clock }) => {
    if (!beamRef.current) return;

    const t = (Math.sin(clock.getElapsedTime() * 0.75) + 1) / 2;
    beamRef.current.position.x = THREE.MathUtils.lerp(
      layout.garage.position[0] - layout.garage.width * 0.28,
      layout.main.position[0] + layout.main.width * 0.15,
      t
    );
    beamRef.current.rotation.y = THREE.MathUtils.lerp(-0.08, 0.08, t);
    const material = beamRef.current.material as THREE.MeshBasicMaterial;
    material.opacity = 0.08 + t * 0.08;
  });

  return (
    <mesh ref={beamRef} position={[layout.main.position[0], layout.main.height + 0.56, 0]}>
      <planeGeometry args={[1.6, 7.8]} />
      <meshBasicMaterial color="#67e8f9" transparent opacity={0.12} />
    </mesh>
  );
}

function buildRoofLayout(analysis: RoofAnalysis): RoofLayout {
  const mainWidth = clamp(analysis.estimatedRoofLengthMeters * 0.92 + 2.8, 10, 14.2);
  const mainDepth = clamp(analysis.estimatedRoofWidthMeters * 0.82 + 1.8, 6.4, 9.2);
  const garageWidth = clamp(mainWidth * 0.5, 4.8, 6.5);
  const garageDepth = clamp(mainDepth * 0.58, 3.6, 5.2);

  const totalPanelCount = analysis.estimatedPanelCount;
  const mainPanelCount = Math.max(8, Math.round(totalPanelCount * 0.7));
  const garagePanelCount = Math.max(2, totalPanelCount - mainPanelCount);

  return {
    main: {
      id: "main",
      width: mainWidth,
      depth: mainDepth,
      height: 4.1,
      position: [-0.42, 0, -0.14],
      panelCount: mainPanelCount,
      tilt: 0.12,
    },
    garage: {
      id: "garage",
      width: garageWidth,
      depth: garageDepth,
      height: 3.15,
      position: [mainWidth * 0.36, 0, mainDepth * 0.26],
      panelCount: garagePanelCount,
      tilt: 0.1,
    },
  };
}

function buildPanelLayout(width: number, depth: number, count: number): PanelPosition[] {
  const panelWidth = 0.96;
  const panelDepth = 1.72;
  const gapX = 0.16;
  const gapZ = 0.2;
  const marginX = 0.34;
  const marginZ = 0.28;
  const usableWidth = Math.max(width - marginX * 2, panelWidth);
  const usableDepth = Math.max(depth - marginZ * 2, panelDepth);
  const columns = Math.max(1, Math.floor((usableWidth + gapX) / (panelWidth + gapX)));
  const rows = Math.max(1, Math.floor((usableDepth + gapZ) / (panelDepth + gapZ)));
  const capacity = Math.max(1, columns * rows);
  const total = Math.min(count, capacity);
  const items: PanelPosition[] = [];
  const xOffset = ((columns - 1) * (panelWidth + gapX)) / 2;
  const zOffset = ((rows - 1) * (panelDepth + gapZ)) / 2;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (items.length >= total) {
        return items;
      }

      items.push({
        x: column * (panelWidth + gapX) - xOffset,
        z: row * (panelDepth + gapZ) - zOffset,
      });
    }
  }

  return items;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
