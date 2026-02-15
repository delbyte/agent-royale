'use client';

import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Lerp a mesh position from previous to current grid position.
 * Call this inside R3F components.
 * 
 * @param meshRef - ref to the Three.js object
 * @param currentPos - current server position [x, y]
 * @param previousPos - previous server position [x, y]
 * @param tickTimeRef - ref to timestamp of last tick
 * @param tickRateMs - milliseconds between ticks (1000)
 */
export function useInterpolation(
    meshRef: React.RefObject<THREE.Object3D | null>,
    currentPos: [number, number],
    previousPos: [number, number],
    tickTimeRef: React.MutableRefObject<number>,
    tickRateMs: number = 1000
) {
    useFrame(() => {
        if (!meshRef.current) return;

        const elapsed = Date.now() - tickTimeRef.current;
        const t = Math.min(elapsed / tickRateMs, 1); // 0 → 1 over tickRateMs

        // Smooth step for nicer easing
        const smooth = t * t * (3 - 2 * t); // smoothstep

        const x = THREE.MathUtils.lerp(previousPos[0], currentPos[0], smooth);
        const z = THREE.MathUtils.lerp(previousPos[1], currentPos[1], smooth);

        meshRef.current.position.x = x;
        meshRef.current.position.z = z;
    });
}

/**
 * Simple standalone lerp for a Vector3.
 */
export function lerpPosition(
    from: [number, number],
    to: [number, number],
    t: number
): [number, number] {
    return [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
    ];
}
