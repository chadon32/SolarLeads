import { Matrix4, Vector3 } from "three";

export type ModelBounds = { min: [number, number, number]; max: [number, number, number] };
export type ViewerPanel = {
  position: [number, number, number];
  rotation: [number, number, number];
  alongMeters: number;
  acrossMeters: number;
};

export const PANEL_THICKNESS_METERS = 0.05;

export function buildPanelInstanceMatrices(panel: ViewerPanel) {
  // Preserve heading-then-local-tilt from the original nested scene groups.
  const mount = new Matrix4().makeTranslation(...panel.position)
    .multiply(new Matrix4().makeRotationY(panel.rotation[1]))
    .multiply(new Matrix4().makeRotationX(panel.rotation[0]));
  return {
    frame: mount.clone().scale(new Vector3(panel.acrossMeters, PANEL_THICKNESS_METERS, panel.alongMeters)),
    glass: mount.clone()
      .multiply(new Matrix4().makeTranslation(0, PANEL_THICKNESS_METERS / 2 + 0.002, 0))
      .multiply(new Matrix4().makeRotationX(-Math.PI / 2))
      .scale(new Vector3(Math.max(0.001, panel.acrossMeters - 0.024), Math.max(0.001, panel.alongMeters - 0.024), 1)),
    rails: [-1, 1].map((side) => mount.clone()
      .multiply(new Matrix4().makeTranslation(0, -0.08, side * panel.alongMeters * 0.28))
      .scale(new Vector3(panel.acrossMeters * 0.9, 0.04, 0.04))),
  };
}

const OUTLINE_LIFT_METERS = 0.004;
const GLASS_CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const;

/**
 * Line-segment pairs (xyz, xyz) tracing each module's glass edge, lifted
 * just above the glass. Module frames are sub-pixel at overview zoom, so the
 * viewer draws these as one batched fat-line call to keep arrays countable.
 */
export function buildPanelOutlineSegments(panels: ViewerPanel[]): Float32Array {
  const segments = new Float32Array(panels.length * 24);
  const point = new Vector3();
  panels.forEach((panel, index) => {
    const { glass } = buildPanelInstanceMatrices(panel);
    for (let edge = 0; edge < 4; edge++) {
      const ends = [GLASS_CORNERS[edge], GLASS_CORNERS[(edge + 1) % 4]];
      ends.forEach(([x, y], end) => {
        point.set(x, y, OUTLINE_LIFT_METERS).applyMatrix4(glass);
        segments.set([point.x, point.y, point.z], index * 24 + edge * 6 + end * 3);
      });
    }
  });
  return segments;
}

/** Share of the available half-width/height the framed model may use. */
const FRAMING_MARGIN = 0.9;

/**
 * Camera pose that fits the model in the viewport, or in an overlay-free part
 * of it: `aspect` is that area's width ÷ height and `heightFraction` its share
 * of the canvas height (the projection is shifted onto it with setViewOffset).
 */
export function getRoofCameraPose(bounds: ModelBounds, aspect: number, top = false, heightFraction = 1) {
  const min = new Vector3(...bounds.min);
  const max = new Vector3(...bounds.max);
  const target = new Vector3().addVectors(min, max).multiplyScalar(0.5);
  const fraction = Number.isFinite(heightFraction) && heightFraction > 0 ? Math.min(1, heightFraction) : 1;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // Local -Z is north. Keep north at the top of the overhead view.
  const direction = (top ? new Vector3(0, 1, 0.001) : new Vector3(0.65, 0.9, 0.85)).normalize();
  // Camera basis as lookAt builds it (world up = +Y).
  const right = new Vector3().crossVectors(direction.clone().negate(), new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, direction.clone().negate());
  // Fit the box corners themselves, with a margin: a bounding sphere leaves a low, wide house small.
  const tanVertical = Math.tan((21 * Math.PI) / 180) * fraction * FRAMING_MARGIN;
  const tanHorizontal = tanVertical * safeAspect;
  let distance = 0;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const offset = new Vector3(x, y, z).sub(target);
    const toward = offset.dot(direction);
    distance = Math.max(distance, toward + Math.abs(offset.dot(right)) / tanHorizontal, toward + Math.abs(offset.dot(up)) / tanVertical);
  }
  return { target, position: target.clone().addScaledVector(direction, distance), distance };
}

/** Presets reframe the roof; zooms and turns leave the visitor's own view in place. */
export function cameraCommandKeepsFraming(action: string) {
  return action === "fit" || action === "top" || action === "perspective";
}

/**
 * What the camera does when a command arrives or the layout changes. A new
 * model is framed at once; commands ease (unless motion is reduced); layout
 * changes (resize, overlays appearing) re-frame only a view nobody has moved,
 * in the preset it was left in.
 */
export function planCameraUpdate({
  command,
  newModel,
  userMoved,
  reducedMotion,
  preset,
}: {
  command: string | null;
  newModel: boolean;
  userMoved: boolean;
  reducedMotion: boolean;
  /** The last framing preset applied ("fit", "top" or "perspective"). */
  preset: string;
}): { action: string; animate: boolean } | null {
  if (newModel) return { action: "fit", animate: false };
  if (command) return { action: command, animate: !reducedMotion };
  return userMoved ? null : { action: preset, animate: false };
}
