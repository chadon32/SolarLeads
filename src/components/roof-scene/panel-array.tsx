"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { DEFAULT_MODULE_FACE, paintModuleFace, planModuleFace, type ModuleFaceLayout } from "@/lib/module-face";
import { buildPanelInstanceMatrices, buildPanelOutlineSegments, type ViewerPanel } from "@/lib/roof-viewer";
import { useRefreshShadows } from "./use-refresh-shadows";

const DROP_HEIGHT_METERS = 0.6;
const DROP_MS = 240;

export type ModuleSkin = {
  frame: THREE.Material;
  rails: THREE.Material;
  glassPortrait: THREE.Material;
  glassLandscape: THREE.Material;
};

/**
 * Physically based module materials: coated glass (clearcoat) over the
 * datasheet cell layout, and the catalog frame finish.
 */
export function useModuleSkin(face: ModuleFaceLayout = DEFAULT_MODULE_FACE, alongToAcrossRatio: number): ModuleSkin {
  const ratio = Math.round((Number.isFinite(alongToAcrossRatio) && alongToAcrossRatio > 0 ? alongToAcrossRatio : 1.8) * 100) / 100;
  const skin = useMemo(() => {
    const portrait = moduleFaceTexture(face, ratio, false);
    const landscape = moduleFaceTexture(face, ratio, true);
    const glass = (map: THREE.Texture | null) =>
      new THREE.MeshPhysicalMaterial({
        map,
        color: map ? "#ffffff" : "#0d1118",
        roughness: 0.42,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        envMapIntensity: 0.85,
      });
    return {
      frame: new THREE.MeshStandardMaterial({ color: face.frame === "silver" ? "#a9b3bf" : "#1b1e23", roughness: 0.38, metalness: 0.6 }),
      rails: new THREE.MeshStandardMaterial({ color: "#2a2e35", roughness: 0.5, metalness: 0.5 }),
      glassPortrait: glass(portrait),
      glassLandscape: glass(landscape),
      textures: [portrait, landscape],
    };
  }, [face, ratio]);
  useEffect(
    () => () => {
      skin.frame.dispose();
      skin.rails.dispose();
      skin.glassPortrait.dispose();
      skin.glassLandscape.dispose();
      for (const texture of skin.textures) texture?.dispose();
    },
    [skin]
  );
  return skin;
}

function moduleFaceTexture(face: ModuleFaceLayout, ratio: number, landscape: boolean) {
  if (typeof document === "undefined") return null;
  const plan = planModuleFace(face, { alongToAcrossRatio: ratio, landscape });
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  paintModuleFace(context, plan);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

type PanelWithKey = ViewerPanel & { key: number };
type Slot = { frame: number; glass: "portrait" | "landscape"; glassIndex: number; base: ReturnType<typeof buildPanelInstanceMatrices> };

/**
 * One instanced draw per part (frame, portrait glass, landscape glass,
 * rails). Modules added after the first render drop in over ~0.24 s.
 */
export function PanelArray({ panels, skin, capacity, animate }: { panels: PanelWithKey[]; skin: ModuleSkin; capacity: number; animate: boolean }) {
  const frames = useRef<THREE.InstancedMesh>(null);
  const portrait = useRef<THREE.InstancedMesh>(null);
  const landscape = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);
  const refreshShadows = useRefreshShadows();
  const slots = useRef(new Map<number, Slot>());
  const drops = useRef(new Map<number, number>());
  const rendered = useRef(false);

  const write = useCallback((slot: Slot, lift: number) => {
    const offset = lift ? new THREE.Matrix4().makeTranslation(0, lift, 0) : null;
    const place = (matrix: THREE.Matrix4) => (offset ? offset.clone().multiply(matrix) : matrix);
    frames.current!.setMatrixAt(slot.frame, place(slot.base.frame));
    (slot.glass === "landscape" ? landscape : portrait).current!.setMatrixAt(slot.glassIndex, place(slot.base.glass));
    slot.base.rails.forEach((matrix, rail) => rails.current!.setMatrixAt(slot.frame * 2 + rail, place(matrix)));
  }, []);

  useLayoutEffect(() => {
    if (!frames.current || !portrait.current || !landscape.current || !rails.current) return;
    const previous = slots.current;
    const next = new Map<number, Slot>();
    const now = performance.now();
    let portraits = 0, landscapes = 0;
    panels.forEach((panel, index) => {
      const isLandscape = panel.acrossMeters >= panel.alongMeters;
      const slot: Slot = {
        frame: index,
        glass: isLandscape ? "landscape" : "portrait",
        glassIndex: isLandscape ? landscapes++ : portraits++,
        base: buildPanelInstanceMatrices(panel),
      };
      next.set(panel.key, slot);
      if (animate && rendered.current && !previous.has(panel.key)) drops.current.set(panel.key, now);
      write(slot, drops.current.has(panel.key) ? DROP_HEIGHT_METERS : 0);
    });
    for (const key of drops.current.keys()) if (!next.has(key)) drops.current.delete(key);
    slots.current = next;
    rendered.current = true;
    for (const [mesh, count] of [[frames.current, panels.length], [portrait.current, portraits], [landscape.current, landscapes], [rails.current, panels.length * 2]] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
    refreshShadows();
  }, [panels, animate, refreshShadows, write]);

  useFrame(() => {
    if (!drops.current.size || !frames.current || !portrait.current || !landscape.current || !rails.current) return;
    const now = performance.now();
    for (const [key, start] of drops.current) {
      const slot = slots.current.get(key);
      const t = Math.min(1, (now - start) / DROP_MS);
      // Ease-out cubic: the remaining lift shrinks as (1 − t)³.
      if (slot) write(slot, (1 - t) ** 3 * DROP_HEIGHT_METERS);
      if (t >= 1) drops.current.delete(key);
    }
    for (const mesh of [frames.current, portrait.current, landscape.current, rails.current]) mesh.instanceMatrix.needsUpdate = true;
    // Shadows follow modules while they drop in.
    refreshShadows();
  });

  const count = Math.max(1, capacity);
  return (
    <group>
      <instancedMesh ref={frames} args={[undefined, undefined, count]} material={skin.frame} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={portrait} args={[undefined, undefined, count]} material={skin.glassPortrait}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
      <instancedMesh ref={landscape} args={[undefined, undefined, count]} material={skin.glassLandscape}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
      {/* Racking is illustrative; surveyed mounting hardware is not available. */}
      <instancedMesh ref={rails} args={[undefined, undefined, count * 2]} material={skin.rails} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </group>
  );
}

/**
 * Module outlines as one fat-line draw. Frames are sub-pixel at overview
 * zoom; without these, a dark array reads as a single slab (or a hole).
 */
export function ModuleOutlines({ panels }: { panels: ViewerPanel[] }) {
  const points = useMemo(() => Array.from(buildPanelOutlineSegments(panels)), [panels]);
  if (!points.length) return null;
  return <Line segments points={points} color="#9fb2c9" lineWidth={1} transparent opacity={0.6} />;
}
