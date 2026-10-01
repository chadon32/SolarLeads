"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ContextBuilding, RoofContext } from "@/lib/roof-context";
import { useRefreshShadows } from "./use-refresh-shadows";

/**
 * Trees and neighbouring roofs from the elevation scan, in muted colours so
 * they read as context. Trees cast shadows — they are the shade sources the
 * sunlight layer already accounts for.
 */
export function Surroundings({ context }: { context: RoofContext }) {
  const canopies = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const refreshShadows = useRefreshShadows();
  const { trees } = context;
  const buildings = useMemo(() => neighbourGeometry(context.buildings), [context.buildings]);
  useEffect(() => () => buildings?.dispose(), [buildings]);

  useLayoutEffect(() => {
    if (!canopies.current || !trunks.current) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    trees.forEach((tree, index) => {
      const crown = Math.max(0.5, (tree.topM - tree.canopyBaseM) / 2);
      canopies.current!.setMatrixAt(index, matrix.compose(position.set(tree.x, tree.canopyBaseM + crown, tree.z), rotation, scale.set(tree.radiusM, crown, tree.radiusM)));
      trunks.current!.setMatrixAt(index, matrix.compose(position.set(tree.x, tree.canopyBaseM / 2, tree.z), rotation, scale.set(1, Math.max(0.3, tree.canopyBaseM), 1)));
    });
    for (const mesh of [canopies.current, trunks.current]) {
      mesh.count = trees.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    refreshShadows();
  }, [trees, refreshShadows]);

  return (
    <group>
      {trees.length ? (
        <>
          <instancedMesh ref={canopies} args={[undefined, undefined, trees.length]} castShadow>
            <icosahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color="#5d7558" roughness={1} flatShading />
          </instancedMesh>
          <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
            <cylinderGeometry args={[0.12, 0.17, 1, 6]} />
            <meshStandardMaterial color="#5a4636" roughness={1} />
          </instancedMesh>
        </>
      ) : null}
      {buildings ? (
        <mesh geometry={buildings} castShadow receiveShadow>
          <meshStandardMaterial color="#3b4657" roughness={0.9} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

/** All neighbouring roofs as flat-topped prisms in one geometry (one draw call). */
function neighbourGeometry(buildings: ContextBuilding[]) {
  if (!buildings.length) return null;
  const positions: number[] = [];
  for (const { outline, heightM } of buildings) {
    const contour = outline.map((point) => new THREE.Vector2(point.x, point.z));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      positions.push(outline[a].x, heightM, outline[a].z, outline[b].x, heightM, outline[b].z, outline[c].x, heightM, outline[c].z);
    }
    outline.forEach((start, index) => {
      const end = outline[(index + 1) % outline.length];
      positions.push(
        start.x, heightM, start.z, end.x, heightM, end.z, end.x, 0, end.z,
        start.x, heightM, start.z, end.x, 0, end.z, start.x, 0, start.z
      );
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
