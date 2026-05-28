"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RoofAnalysis, RoofSegment } from "@/lib/roof-analysis";

type RoofModel3DProps = {
  roofData: RoofAnalysis;
  address?: string;
  className?: string;
};

type RoofSurface = {
  key: string;
  width: number;
  depth: number;
  center: THREE.Vector3;
  rotationX: number;
};

type AnimatedPanel = {
  group: THREE.Group;
  targetY: number;
  startY: number;
  startMs: number;
  durationMs: number;
  materials: THREE.Material[];
};

export function RoofModel3D({
  roofData,
  address,
  className = "",
}: RoofModel3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = Math.max(mount.clientHeight, 420);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#07131f");
    scene.fog = new THREE.Fog("#07131f", 42, 96);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 220);
    camera.position.set(
      roofData.widthM * 1.8,
      roofData.widthM * 1.15,
      roofData.depthM * 2.2
    );
    camera.lookAt(0, roofData.widthM * 0.22, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 62;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    controls.target.set(0, 2.8, 0);

    addLights(scene);
    addGround(scene);

    const wallHeight = 3.3;
    const roofRise = Math.max(
      0.25,
      Math.tan((roofData.pitchDeg * Math.PI) / 180) * (roofData.depthM / 2)
    );

    addHouseBody(scene, roofData.widthM, roofData.depthM, wallHeight);
    const roofSurfaces = addRoof(scene, roofData, wallHeight, roofRise);
    const animatedPanels = addPanels(
      scene,
      roofData,
      roofSurfaces,
      wallHeight,
      roofRise
    );

    let frameId = 0;
    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      controls.update();
      updatePanels(animatedPanels, performance.now());
      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      if (!mount) return;
      const nextWidth = mount.clientWidth;
      const nextHeight = Math.max(mount.clientHeight, 420);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }

        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [roofData]);

  return (
    <div
      className={`relative h-[26rem] w-full overflow-hidden rounded-[1.6rem] border border-white/10 bg-slate-950/35 ${className}`.trim()}
    >
      <div ref={mountRef} className="h-full w-full" />
      {address ? (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-white backdrop-blur-md">
          {address}
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-md">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  );
}

function addLights(scene: THREE.Scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.42);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff3dc, 1.45);
  sun.position.set(24, 28, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8ab4f8, 0.55);
  fill.position.set(-16, 10, -12);
  scene.add(fill);
}

function addGround(scene: THREE.Scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshLambertMaterial({ color: "#173424" })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(72, 32, "#153a2d", "#153a2d");
  grid.position.y = 0.015;
  scene.add(grid);
}

function addHouseBody(
  scene: THREE.Scene,
  widthM: number,
  depthM: number,
  wallHeight: number
) {
  const wallMat = new THREE.MeshLambertMaterial({ color: "#d5c4a4" });
  const wallMesh = new THREE.Mesh(
    new THREE.BoxGeometry(widthM, wallHeight, depthM),
    wallMat
  );
  wallMesh.position.y = wallHeight / 2;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);

  const windowMat = new THREE.MeshStandardMaterial({
    color: "#8bd8ff",
    emissive: "#16384e",
    roughness: 0.18,
    metalness: 0.2,
  });

  const frontWindow = new THREE.Mesh(
    new THREE.BoxGeometry(widthM * 0.42, wallHeight * 0.38, 0.08),
    windowMat
  );
  frontWindow.position.set(0, wallHeight * 0.58, depthM / 2 + 0.05);
  scene.add(frontWindow);

  const garageDoor = new THREE.Mesh(
    new THREE.BoxGeometry(widthM * 0.28, wallHeight * 0.58, 0.08),
    new THREE.MeshLambertMaterial({ color: "#7a5232" })
  );
  garageDoor.position.set(widthM * 0.26, wallHeight * 0.38, depthM / 2 + 0.05);
  scene.add(garageDoor);
}

function addRoof(
  scene: THREE.Scene,
  roofData: RoofAnalysis,
  wallHeight: number,
  roofRise: number
) {
  const roofMat = new THREE.MeshLambertMaterial({
    color: roofData.roofShape === "flat" ? "#b68f6d" : "#835236",
    side: THREE.DoubleSide,
  });

  const roofSurfaces: RoofSurface[] = [];
  const pitchRad = (roofData.pitchDeg * Math.PI) / 180;
  const roofWidth = Math.max(roofData.widthM - 0.4, 2);
  const roofDepth = Math.max(roofData.depthM - 0.4, 2);

  if (roofData.roofShape === "flat") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(roofWidth, 0.22, roofDepth),
      roofMat
    );
    roof.position.set(0, wallHeight + 0.11, 0);
    roof.castShadow = true;
    roof.receiveShadow = true;
    scene.add(roof);

    roofSurfaces.push({
      key: "flat",
      width: roofWidth - 0.9,
      depth: roofDepth - 0.9,
      center: new THREE.Vector3(0, wallHeight + 0.22, 0),
      rotationX: -0.18,
    });

    return roofSurfaces;
  }

  if (roofData.roofShape === "shed") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(roofWidth, 0.2, roofDepth),
      roofMat
    );
    roof.rotation.x = -pitchRad;
    roof.position.set(0, wallHeight + roofRise * 0.48, 0);
    roof.castShadow = true;
    roof.receiveShadow = true;
    scene.add(roof);

    roofSurfaces.push({
      key: "shed",
      width: roofWidth - 0.8,
      depth: roofDepth - 1.1,
      center: new THREE.Vector3(0, wallHeight + roofRise * 0.5 + 0.14, 0),
      rotationX: -pitchRad,
    });

    return roofSurfaces;
  }

  const slopeLength = Math.sqrt((roofData.depthM / 2) ** 2 + roofRise ** 2);
  const leftRoof = new THREE.Mesh(
    new THREE.PlaneGeometry(roofWidth, slopeLength),
    roofMat
  );
  leftRoof.rotation.x = Math.PI / 2 - pitchRad;
  leftRoof.position.set(0, wallHeight + roofRise / 2, -roofData.depthM / 4);
  leftRoof.castShadow = true;
  leftRoof.receiveShadow = true;
  scene.add(leftRoof);

  const rightRoof = new THREE.Mesh(
    new THREE.PlaneGeometry(roofWidth, slopeLength),
    roofMat
  );
  rightRoof.rotation.x = -(Math.PI / 2 - pitchRad);
  rightRoof.position.set(0, wallHeight + roofRise / 2, roofData.depthM / 4);
  rightRoof.castShadow = true;
  rightRoof.receiveShadow = true;
  scene.add(rightRoof);

  const leftSurface: RoofSurface = {
    key: "left",
    width: roofWidth - 0.8,
    depth: slopeLength - 0.7,
    center: new THREE.Vector3(0, wallHeight + roofRise / 2 + 0.12, -roofData.depthM / 4),
    rotationX: -(Math.PI / 2 - pitchRad),
  };
  const rightSurface: RoofSurface = {
    key: "right",
    width: roofWidth - 0.8,
    depth: slopeLength - 0.7,
    center: new THREE.Vector3(0, wallHeight + roofRise / 2 + 0.12, roofData.depthM / 4),
    rotationX: Math.PI / 2 - pitchRad,
  };
  roofSurfaces.push(leftSurface, rightSurface);

  if (roofData.roofShape === "hip") {
    const hipAccent = new THREE.Mesh(
      new THREE.BoxGeometry(roofWidth * 0.42, 0.16, 0.3),
      new THREE.MeshLambertMaterial({ color: "#6d4126" })
    );
    hipAccent.position.set(0, wallHeight + roofRise - 0.05, 0);
    hipAccent.castShadow = true;
    scene.add(hipAccent);
  }

  return roofSurfaces;
}

function addPanels(
  scene: THREE.Scene,
  roofData: RoofAnalysis,
  roofSurfaces: RoofSurface[],
  wallHeight: number,
  roofRise: number
) {
  const panels: AnimatedPanel[] = [];
  const panelBodyMat = new THREE.MeshLambertMaterial({ color: "#1a3b6d" });
  const panelFrameMat = new THREE.MeshLambertMaterial({ color: "#b7c6d9" });
  const usableSegments = roofData.roofSegments.filter((segment) => segment.usable);
  const panelGoal = Math.max(roofData.panelCount, 1);
  const plannedSegments = usableSegments.length
    ? usableSegments
    : [
        {
          label: "primary",
          pitchDeg: roofData.pitchDeg,
          azimuthDeg: roofData.primaryRoofAzimuth,
          areaM2: roofData.widthM * roofData.depthM * 0.5,
          panelsFit: roofData.panelCount,
          usable: true,
        } satisfies RoofSegment,
      ];

  let placed = 0;
  plannedSegments.forEach((segment, index) => {
    if (placed >= panelGoal) {
      return;
    }

    const surface = roofSurfaces[index % roofSurfaces.length];
    const panelsForSegment = Math.min(segment.panelsFit || panelGoal, panelGoal - placed);
    const segmentPanels = buildPanelGrid(
      surface,
      panelsForSegment,
      panelBodyMat,
      panelFrameMat,
      wallHeight,
      roofRise
    );
    segmentPanels.forEach((panel, panelIndex) => {
      panel.startMs += index * 200 + panelIndex * 110;
      panels.push(panel);
      scene.add(panel.group);
    });
    placed += segmentPanels.length;
  });

  return panels;
}

function buildPanelGrid(
  surface: RoofSurface,
  panelCount: number,
  panelBodyMat: THREE.Material,
  panelFrameMat: THREE.Material,
  wallHeight: number,
  roofRise: number
) {
  const panels: AnimatedPanel[] = [];
  const panelWidth = 1.05;
  const panelDepth = 1.82;
  const spacing = 0.12;
  const usableWidth = Math.max(surface.width, panelWidth + 0.3);
  const cols = Math.max(1, Math.floor(usableWidth / (panelWidth + spacing)));
  const rows = Math.max(1, Math.ceil(panelCount / cols));
  const xStart = -((cols - 1) * (panelWidth + spacing)) / 2;
  const zStart = -((rows - 1) * (panelDepth + spacing)) / 2;

  let placed = 0;
  for (let row = 0; row < rows && placed < panelCount; row += 1) {
    for (let col = 0; col < cols && placed < panelCount; col += 1) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(panelWidth, 0.035, panelDepth),
        panelBodyMat.clone()
      );
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(panelWidth + 0.05, 0.04, panelDepth + 0.05),
        panelFrameMat.clone()
      );
      frame.position.y = -0.004;
      frame.castShadow = true;
      group.add(frame);

      group.rotation.x = surface.rotationX;
      group.position.set(
        surface.center.x + xStart + col * (panelWidth + spacing),
        surface.center.y,
        surface.center.z + zStart + row * (panelDepth + spacing)
      );

      const targetY = group.position.y;
      group.position.y += Math.max(6, wallHeight + roofRise * 0.9);
      setMaterialsOpacity([body.material, frame.material], 0);

      panels.push({
        group,
        targetY,
        startY: group.position.y,
        startMs: 700,
        durationMs: 650,
        materials: [body.material, frame.material],
      });

      placed += 1;
    }
  }

  return panels;
}

function updatePanels(panels: AnimatedPanel[], now: number) {
  panels.forEach((panel) => {
    const elapsed = now - panel.startMs;
    if (elapsed <= 0) {
      return;
    }

    const t = Math.min(elapsed / panel.durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    panel.group.position.y =
      panel.startY + (panel.targetY - panel.startY) * eased;
    setMaterialsOpacity(panel.materials, eased);

    if (t >= 1) {
      panel.materials.forEach((material) => {
        material.transparent = false;
        material.needsUpdate = true;
      });
    }
  });
}

function setMaterialsOpacity(materials: THREE.Material[], opacity: number) {
  materials.forEach((material) => {
    const nextMaterial = material as THREE.Material & { opacity: number; transparent: boolean };
    nextMaterial.opacity = opacity;
    nextMaterial.transparent = opacity < 1;
    nextMaterial.needsUpdate = true;
  });
}
