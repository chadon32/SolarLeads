import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import { buildPanelInstanceMatrices, getRoofCameraPose, PANEL_THICKNESS_METERS } from "../src/lib/roof-viewer";

test("instancing preserves every original frame and glass transform", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    for (const tilt of [0, Math.PI / 8, Math.PI / 4]) {
      for (const [acrossMeters, alongMeters] of [[1.045, 1.879], [1.879, 1.045]]) {
        const panel = { position: [12, 6, -8] as [number, number, number], rotation: [tilt, heading, 0] as [number, number, number], acrossMeters, alongMeters };
        const outer = new Group(); outer.position.set(...panel.position); outer.rotation.y = heading;
        const inner = new Group(); inner.rotation.x = tilt; outer.add(inner);
        const frame = new Mesh(); frame.scale.set(acrossMeters, PANEL_THICKNESS_METERS, alongMeters); inner.add(frame);
        const glass = new Mesh(); glass.position.y = PANEL_THICKNESS_METERS / 2 + 0.002; glass.rotation.x = -Math.PI / 2;
        glass.scale.set(acrossMeters - 0.024, alongMeters - 0.024, 1); inner.add(glass);
        outer.updateMatrixWorld(true);
        const actual = buildPanelInstanceMatrices(panel);
        for (const [expected, result] of [[frame.matrixWorld, actual.frame], [glass.matrixWorld, actual.glass]]) {
          expected.elements.forEach((value, i) => assert.ok(Math.abs(value - result.elements[i]) < 1e-10));
        }
        assert.equal(actual.rails.length, 2);
        for (const rail of actual.rails) assert.ok(rail.elements.every(Number.isFinite));
      }
    }
  }
});

test("camera framing contains the complete building on desktop and narrow phones", () => {
  const bounds = { min: [-18, 0, -10] as [number, number, number], max: [18, 9, 10] as [number, number, number] };
  for (const aspect of [0.45, 0.8, 1, 1.8, 2.4]) {
    for (const top of [true, false]) {
      const pose = getRoofCameraPose(bounds, aspect, top);
      const camera = new PerspectiveCamera(42, aspect, 0.1, 2000);
      camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
      for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = new Vector3(x, y, z).project(camera);
        assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z > -1 && point.z < 1);
      }
    }
  }
  assert.ok(getRoofCameraPose(bounds, Number.NaN).position.toArray().every(Number.isFinite));
});

test("overhead camera keeps geographic north above the building", () => {
  const bounds = { min: [-10, 0, -10] as [number, number, number], max: [10, 8, 10] as [number, number, number] };
  const pose = getRoofCameraPose(bounds, 1, true);
  const camera = new PerspectiveCamera(42, 1, 0.1, 1000);
  camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
  const north = new Vector3(0, 4, -5).project(camera), south = new Vector3(0, 4, 5).project(camera);
  assert.ok(north.y > south.y);
});
