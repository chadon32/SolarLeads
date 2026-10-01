import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import {
  buildPanelInstanceMatrices,
  buildPanelOutlineSegments,
  cameraCommandKeepsFraming,
  getRoofCameraPose,
  PANEL_THICKNESS_METERS,
  planCameraUpdate,
} from "../src/lib/roof-viewer";

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

test("framing in the overlay-free part of the canvas keeps the whole building inside it", () => {
  const bounds = { min: [-18, 0, -10] as [number, number, number], max: [18, 9, 10] as [number, number, number] };
  const layouts = [
    { width: 630, height: 480, insets: { top: 86, right: 260, bottom: 125, left: 0 } },
    { width: 630, height: 480, insets: { top: 136, right: 0, bottom: 0, left: 318 } },
    { width: 393, height: 480, insets: { top: 60, right: 0, bottom: 120, left: 0 } },
  ];
  for (const { width, height, insets } of layouts) {
    const freeWidth = width - insets.left - insets.right, freeHeight = height - insets.top - insets.bottom;
    for (const top of [true, false]) {
      const pose = getRoofCameraPose(bounds, freeWidth / freeHeight, top, freeHeight / height);
      // The same camera the viewer builds: full-canvas aspect, projection shifted onto the free area.
      const camera = new PerspectiveCamera(42, width / height, 0.1, 2000);
      camera.setViewOffset(width, height, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, width, height);
      camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
      for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = new Vector3(x, y, z).project(camera);
        const px = ((point.x + 1) / 2) * width, py = ((1 - point.y) / 2) * height;
        assert.ok(px >= insets.left && px <= width - insets.right, `x ${px.toFixed(0)} outside ${insets.left}..${width - insets.right}`);
        assert.ok(py >= insets.top && py <= height - insets.bottom, `y ${py.toFixed(0)} outside ${insets.top}..${height - insets.bottom}`);
      }
    }
  }
});

test("framing fills the available area instead of leaving a low, wide house small", () => {
  const houses = [
    { min: [-6.6, 0, -10.6] as [number, number, number], max: [6.6, 5.8, 10.6] as [number, number, number] },
    { min: [-18, 0, -10] as [number, number, number], max: [18, 9, 10] as [number, number, number] },
  ];
  for (const bounds of houses) {
    for (const aspect of [0.6, 1.375, 2]) {
      for (const top of [true, false]) {
        const pose = getRoofCameraPose(bounds, aspect, top);
        const camera = new PerspectiveCamera(42, aspect, 0.1, 2000);
        camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
        const xs: number[] = [], ys: number[] = [];
        for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
          const point = new Vector3(x, y, z).project(camera);
          xs.push(point.x); ys.push(point.y);
        }
        // Share of the view the building spans in its limiting direction. Perspective leaves some
        // slack on the far side because the orbit pivot stays at the building's centre.
        const used = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2);
        assert.ok(used >= 0.7, `only ${(used * 100).toFixed(0)}% of the view used (aspect ${aspect}, top ${top})`);
      }
    }
  }
});

test("overhead camera keeps geographic north above the building", () => {
  const bounds = { min: [-10, 0, -10] as [number, number, number], max: [10, 8, 10] as [number, number, number] };
  const pose = getRoofCameraPose(bounds, 1, true);
  const camera = new PerspectiveCamera(42, 1, 0.1, 1000);
  camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
  const north = new Vector3(0, 4, -5).project(camera), south = new Vector3(0, 4, 5).project(camera);
  assert.ok(north.y > south.y);
});

test("module outlines trace each glass edge just above the glass", () => {
  const panel = { position: [2, 3, -1] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], acrossMeters: 1, alongMeters: 2 };
  const segments = buildPanelOutlineSegments([panel]);
  assert.equal(segments.length, 4 * 2 * 3, "four segments, two xyz endpoints each");
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < segments.length; i += 3) { xs.push(segments[i]); ys.push(segments[i + 1]); zs.push(segments[i + 2]); }
  // Glass is inset 12 mm per side and sits 2 mm above the frame top; the outline floats 4 mm above it.
  const glassTop = 3 + PANEL_THICKNESS_METERS / 2 + 0.002;
  for (const y of ys) assert.ok(Math.abs(y - (glassTop + 0.004)) < 1e-6);
  assert.ok(Math.abs(Math.min(...xs) - 1.512) < 1e-6 && Math.abs(Math.max(...xs) - 2.488) < 1e-6);
  assert.ok(Math.abs(Math.min(...zs) - -1.988) < 1e-6 && Math.abs(Math.max(...zs) - -0.012) < 1e-6);
});

test("module outlines are empty without panels", () => {
  assert.equal(buildPanelOutlineSegments([]).length, 0);
});

test("a new model is framed at once, without an animated settle", () => {
  assert.deepEqual(planCameraUpdate({ command: null, newModel: true, userMoved: false, reducedMotion: false, preset: "fit" }), { action: "fit", animate: false });
  assert.deepEqual(planCameraUpdate({ command: "top", newModel: true, userMoved: true, reducedMotion: false, preset: "fit" }), { action: "fit", animate: false });
});

test("toolbar and keyboard commands ease unless motion is reduced", () => {
  assert.deepEqual(planCameraUpdate({ command: "top", newModel: false, userMoved: true, reducedMotion: false, preset: "fit" }), { action: "top", animate: true });
  assert.deepEqual(planCameraUpdate({ command: "zoom-in", newModel: false, userMoved: false, reducedMotion: true, preset: "fit" }), { action: "zoom-in", animate: false });
});

test("layout changes re-frame an untouched view in its preset but keep the visitor's own view", () => {
  // Overlays resizing (e.g. the sunlight legend appearing) or a window resize.
  assert.deepEqual(planCameraUpdate({ command: null, newModel: false, userMoved: false, reducedMotion: false, preset: "fit" }), { action: "fit", animate: false });
  assert.deepEqual(planCameraUpdate({ command: null, newModel: false, userMoved: false, reducedMotion: false, preset: "top" }), { action: "top", animate: false });
  assert.equal(planCameraUpdate({ command: null, newModel: false, userMoved: true, reducedMotion: false, preset: "top" }), null);
});

test("presets hand the view back to the framing; zooms and turns make it the visitor's", () => {
  for (const action of ["fit", "top", "perspective"]) assert.equal(cameraCommandKeepsFraming(action), true);
  for (const action of ["zoom-in", "zoom-out", "left", "right", "up", "down"]) assert.equal(cameraCommandKeepsFraming(action), false);
});
