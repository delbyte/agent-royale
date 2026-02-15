'use client';

import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getScrollProgress } from '@/lib/scrollStore';

/*
  4 scene centres:
    Scene 1 (Camp)    → [0, 0, 0]
    Scene 2 (Forge)   → [14, 0, 0]
    Scene 3 (Battle)  → [28, 0, 0]
    Scene 4 (Outpost) → [42, 0, 0]

  Camera path: close orbit around each island, then transit to next.
  Scroll progress 0→1 maps to the full curve.
*/

const SCENE_CENTRES = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(14, 0, 0),
  new THREE.Vector3(28, 0, 0),
  new THREE.Vector3(42, 0, 0),
];

export default function ScrollCamera() {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3());

  const { posCurve, lookCurve } = useMemo(() => {
    const posPoints: THREE.Vector3[] = [];
    const lookPoints: THREE.Vector3[] = [];

    const R = 7.5;
    const H = 3.8;
    const TH = 6.0;

    SCENE_CENTRES.forEach((c, i) => {
      const a0 = (i * 0.6);
      for (let j = 0; j < 3; j++) {
        const angle = a0 + (j * Math.PI * 2) / 3;
        posPoints.push(new THREE.Vector3(
          c.x + Math.cos(angle) * R,
          H,
          c.z + Math.sin(angle) * R,
        ));
        lookPoints.push(c.clone().setY(0.5));
      }

      if (i < SCENE_CENTRES.length - 1) {
        const next = SCENE_CENTRES[i + 1];
        const mid = new THREE.Vector3().lerpVectors(c, next, 0.5);
        posPoints.push(new THREE.Vector3(mid.x, TH, mid.z + 5));
        lookPoints.push(mid.clone().setY(0.5));
      }
    });

    return {
      posCurve: new THREE.CatmullRomCurve3(posPoints, false, 'centripetal', 0.5),
      lookCurve: new THREE.CatmullRomCurve3(lookPoints, false, 'centripetal', 0.5),
    };
  }, []);

  useFrame(() => {
    const t = Math.max(0, Math.min(getScrollProgress(), 0.999));

    const pos = posCurve.getPoint(t);
    const look = lookCurve.getPoint(t);

    camera.position.lerp(pos, 0.08);
    lookTarget.current.lerp(look, 0.08);
    camera.lookAt(lookTarget.current);
  });

  return null;
}
