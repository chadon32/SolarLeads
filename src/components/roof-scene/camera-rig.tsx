"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { NO_INSETS, type SafeInsets } from "@/lib/overlay-safe-area";
import { cameraCommandKeepsFraming, getRoofCameraPose, planCameraUpdate, type ModelBounds } from "@/lib/roof-viewer";
import { usePrefersReducedMotion } from "./use-media-query";

/**
 * Eased camera presets (instant under prefers-reduced-motion), framed in the
 * part of the canvas the overlay UI leaves uncovered. Orbiting still pivots
 * on the roof.
 */
export function CameraRig({
  bounds,
  command,
  safeInsets = NO_INSETS,
}: {
  bounds: ModelBounds;
  command: { action: string; sequence: number };
  safeInsets?: SafeInsets;
}) {
  const controls = useRef<ComponentRef<typeof CameraControls>>(null);
  const camera = useThree((store) => store.camera);
  const width = useThree((store) => store.size.width);
  const height = useThree((store) => store.size.height);
  const invalidate = useThree((store) => store.invalidate);
  const reducedMotion = usePrefersReducedMotion();
  const { top, right, bottom, left } = safeInsets;

  // Shift the projection window so the orbit target sits at the centre of the uncovered area.
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.setViewOffset(width, height, (right - left) / 2, (bottom - top) / 2, width, height);
    camera.updateProjectionMatrix();
    invalidate();
    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, width, height, top, right, bottom, left, invalidate]);

  const lastSequence = useRef(-1);
  const lastBounds = useRef<ModelBounds | null>(null);
  // Set once the visitor drags, pinches or zooms; layout changes then leave their view alone.
  const userMoved = useRef(false);
  const preset = useRef("fit");
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const plan = planCameraUpdate({
      command: lastSequence.current !== command.sequence ? command.action : null,
      newModel: lastBounds.current !== bounds,
      userMoved: userMoved.current,
      reducedMotion,
      preset: preset.current,
    });
    lastSequence.current = command.sequence;
    lastBounds.current = bounds;
    if (!plan) return;
    const { action, animate } = plan;
    userMoved.current = !cameraCommandKeepsFraming(action);
    if (!userMoved.current) preset.current = action;
    const freeWidth = Math.max(1, width - left - right);
    const freeHeight = Math.max(1, height - top - bottom);
    const pose = getRoofCameraPose(bounds, freeWidth / freeHeight, action === "top", freeHeight / Math.max(1, height));
    rig.minDistance = Math.max(3, pose.distance * 0.12);
    rig.maxDistance = Math.max(120, pose.distance * 3);
    if (action === "fit" || action === "top" || action === "perspective") {
      void rig.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, animate);
    } else if (action === "zoom-in" || action === "zoom-out") {
      void rig.dolly(rig.distance * (action === "zoom-in" ? 0.2 : -0.25), animate);
    } else if (action === "left" || action === "right") {
      void rig.rotate(action === "left" ? -0.15 : 0.15, 0, animate);
    } else if (action === "up" || action === "down") {
      void rig.rotate(0, action === "up" ? -0.1 : 0.1, animate);
    }
  }, [bounds, command, reducedMotion, width, height, top, right, bottom, left]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.3}
      maxPolarAngle={Math.PI * 0.47}
      dollyToCursor
      onStart={() => {
        userMoved.current = true;
      }}
    />
  );
}
