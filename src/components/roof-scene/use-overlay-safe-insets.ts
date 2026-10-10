"use client";

import { useEffect, useState } from "react";
import { computeSafeInsets, NO_INSETS, type SafeInsets } from "@/lib/overlay-safe-area";

/** Elements marked with this attribute (inside the viewer's container) are avoided when framing. */
export const VIEWER_OVERLAY_ATTRIBUTE = "data-viewer-overlay";

/**
 * Measures overlay UI sitting on top of the 3D canvas (layer toggles,
 * module panel, toolbar) and returns insets that keep the roof clear of it.
 * Takes the element itself (from a callback ref): the region mounts only
 * once the model has loaded, after the first render.
 */
export function useOverlaySafeInsets(region: HTMLElement | null) {
  const [insets, setInsets] = useState<SafeInsets>(NO_INSETS);

  useEffect(() => {
    const container = region?.parentElement;
    if (!region || !container) return;
    let frame = 0;
    const overlays = () => [...container.querySelectorAll<HTMLElement>(`[${VIEWER_OVERLAY_ATTRIBUTE}]`)];
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = region.getBoundingClientRect();
        const obstacles = overlays()
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({ left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top }));
        const next = computeSafeInsets({ width: box.width, height: box.height }, obstacles);
        setInsets((current) =>
          current.top === next.top && current.right === next.right && current.bottom === next.bottom && current.left === next.left ? current : next
        );
      });
    };
    const resizes = new ResizeObserver(measure);
    const observeAll = () => {
      resizes.disconnect();
      resizes.observe(region);
      for (const overlay of overlays()) resizes.observe(overlay);
      measure();
    };
    // Overlays mount and unmount with view state and breakpoints. Ignore the
    // rest of the container's churn (map tiles, canvas internals).
    const touchesOverlay = (node: Node) =>
      node instanceof Element && (node.hasAttribute(VIEWER_OVERLAY_ATTRIBUTE) || node.querySelector(`[${VIEWER_OVERLAY_ATTRIBUTE}]`) !== null);
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(touchesOverlay))) observeAll();
    });
    mutations.observe(container, { childList: true, subtree: true });
    observeAll();
    return () => {
      cancelAnimationFrame(frame);
      resizes.disconnect();
      mutations.disconnect();
    };
  }, [region]);

  return insets;
}
