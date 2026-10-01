"use client";

import { useCallback } from "react";
import { useThree } from "@react-three/fiber";

/**
 * The viewer's shadow map does not auto-update (light and roof are static), so
 * anything that moves a shadow caster asks for one refresh on the next frame.
 */
export function useRefreshShadows() {
  const get = useThree((store) => store.get);
  return useCallback(() => {
    const { gl, invalidate } = get();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [get]);
}
