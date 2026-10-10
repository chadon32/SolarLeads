"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useThree } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { useRefreshShadows } from "./use-refresh-shadows";

/**
 * Key light from the south-west, ~45° up. The default camera sits to the
 * south-east, so this side-lights the planes it sees instead of flattening
 * them with front light.
 */
const SUN_POSITION: [number, number, number] = [-30, 43, 29];

/** Render-target contents (PMREM, baked shadows) do not survive a lost WebGL context. */
export function useContextRestoreCount() {
  const gl = useThree((store) => store.gl);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const canvas = gl.domElement;
    const onRestored = () => setCount((value) => value + 1);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => canvas.removeEventListener("webglcontextrestored", onRestored);
  }, [gl]);
  return count;
}

export function SceneLighting({ shadowExtent }: { shadowExtent: number }) {
  const restored = useContextRestoreCount();
  const refreshShadows = useRefreshShadows();
  // Shadows only re-render on request: after a context restore or a new shadow frustum.
  useEffect(() => {
    refreshShadows();
  }, [refreshShadows, restored, shadowExtent]);
  return (
    <>
      <StudioEnvironment intensity={0.42} restoreKey={restored} />
      <directionalLight
        position={SUN_POSITION}
        intensity={2.6}
        color="#fff6e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={3}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        // Modules stand ~14 cm off their face; keep the bias small so their
        // shadows stay attached to the racking.
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
      />
    </>
  );
}

/** Image-based lighting with zero downloads: a procedural studio room → PMREM. */
function StudioEnvironment({ intensity, restoreKey }: { intensity: number; restoreKey: number }) {
  const gl = useThree((store) => store.gl);
  const target = useMemo(() => {
    void restoreKey; // regenerate after a WebGL context restore
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const filtered = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    return filtered;
  }, [gl, restoreKey]);
  useEffect(() => () => target.dispose(), [target]);
  return <Environment map={target.texture} environmentIntensity={intensity} />;
}

/** CAD workspace floor with a baked contact shadow that grounds the walls. */
export function GroundPlane({ extentMeters }: { extentMeters: number }) {
  const restored = useContextRestoreCount();
  const gridSize = Math.ceil(extentMeters * 3);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[gridSize * 2, gridSize * 2]} />
        <meshStandardMaterial color="#0e1729" roughness={1} metalness={0} />
      </mesh>
      <gridHelper args={[gridSize, Math.max(8, Math.round(gridSize / 2)), "#25364e", "#152137"]} />
      {/* frames={1}: rendered once, so it costs nothing per frame. */}
      <ContactShadows key={restored} frames={1} position={[0, 0.003, 0]} scale={extentMeters * 1.4} resolution={1024} blur={2.4} far={8} opacity={0.7} />
    </>
  );
}
