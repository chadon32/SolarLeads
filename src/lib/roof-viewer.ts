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

export function getRoofCameraPose(bounds: ModelBounds, aspect: number, top = false) {
  const target = new Vector3().addVectors(new Vector3(...bounds.min), new Vector3(...bounds.max)).multiplyScalar(0.5);
  const radius = Math.max(2, new Vector3(...bounds.max).distanceTo(new Vector3(...bounds.min)) / 2);
  const verticalFov = 42 * Math.PI / 180;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.12;
  // Local -Z is north. Keep north at the top of the overhead view.
  const direction = top ? new Vector3(0, 1, 0.001) : new Vector3(0.65, 0.9, 0.85).normalize();
  return { target, position: target.clone().addScaledVector(direction, distance), distance };
}
