/**
 * Where to frame the 3D roof when UI overlays sit on top of the canvas.
 *
 * Finds the largest overlay-free rectangle (scored by how big the model can
 * be drawn in it) and returns it as insets from the viewport edges. The
 * camera then shifts its projection into that rectangle.
 */

export type Rect = { left: number; top: number; right: number; bottom: number };
export type SafeInsets = { top: number; right: number; bottom: number; left: number };

export const NO_INSETS: SafeInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export function computeSafeInsets(
  viewport: { width: number; height: number },
  obstacles: Rect[],
  {
    /** Width ÷ height of the model's on-screen footprint. */
    modelAspect = 1.3,
    margin = 8,
    /** Below this share of either viewport side, overlap beats shrinking. */
    minFraction = 0.45,
  }: { modelAspect?: number; margin?: number; minFraction?: number } = {}
): SafeInsets {
  const { width, height } = viewport;
  if (!(width > 0 && height > 0)) return NO_INSETS;

  const blocks = obstacles
    .map((rect) => ({
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(width, rect.right),
      bottom: Math.min(height, rect.bottom),
    }))
    .filter((rect) => rect.right - rect.left > 0 && rect.bottom - rect.top > 0)
    .map((rect) => ({ left: rect.left - margin, top: rect.top - margin, right: rect.right + margin, bottom: rect.bottom + margin }));
  if (!blocks.length) return NO_INSETS;

  const clampX = (value: number) => Math.min(width, Math.max(0, value));
  const clampY = (value: number) => Math.min(height, Math.max(0, value));
  const xs = [...new Set([0, width, ...blocks.flatMap((rect) => [clampX(rect.left), clampX(rect.right)])])].sort((a, b) => a - b);
  const ys = [...new Set([0, height, ...blocks.flatMap((rect) => [clampY(rect.top), clampY(rect.bottom)])])].sort((a, b) => a - b);

  let best: { rect: Rect; score: number; area: number } | null = null;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      const rect = { left: xs[i], right: xs[j], top: ys[k], bottom: ys[l] };
      const blocked = blocks.some((block) => rect.left < block.right && rect.right > block.left && rect.top < block.bottom && rect.bottom > block.top);
      if (blocked) continue;
      const w = rect.right - rect.left, h = rect.bottom - rect.top;
      const score = Math.min(w / modelAspect, h);
      const area = w * h;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && area > best.area)) {
        best = { rect, score, area };
      }
    }
  }

  if (!best) return NO_INSETS;
  const { rect } = best;
  if (rect.right - rect.left < width * minFraction || rect.bottom - rect.top < height * minFraction) return NO_INSETS;
  return {
    top: Math.round(rect.top),
    right: Math.round(width - rect.right),
    bottom: Math.round(height - rect.bottom),
    left: Math.round(rect.left),
  };
}
