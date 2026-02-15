'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../../lib/constants';
import type { ZoneState } from '../../lib/types';

interface Props {
    zone: ZoneState;
}

export default function Zone({ zone }: Props) {
    const wallRef = useRef<THREE.Mesh>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const animatedRadius = useRef(zone.radius);

    if (zone.radius !== animatedRadius.current) {
        // target handled in frame loop by reading zone.radius
    }

    useFrame((state, delta) => {
        animatedRadius.current = THREE.MathUtils.lerp(animatedRadius.current, zone.radius, delta * 3);

        if (wallRef.current) {
            wallRef.current.scale.x = animatedRadius.current;
            wallRef.current.scale.z = animatedRadius.current;
        }

        if (ringRef.current) {
            ringRef.current.scale.x = animatedRadius.current;
            ringRef.current.scale.y = animatedRadius.current;
        }
    });

    return (
        <group position={[zone.center[0], 0, zone.center[1]]}>
            {/* Zone Warning Cylinder */}
            <mesh ref={wallRef} position={[0, 10, 0]} scale={[zone.radius, 20, zone.radius]}>
                <cylinderGeometry args={[1, 1, 1, 64, 1, true]} />
                <meshBasicMaterial
                    color={COLORS.zone}
                    transparent
                    opacity={0.3}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                />
            </mesh>

            {/* Floor Warning Ring */}
            <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <ringGeometry args={[0.96, 1, 64]} />
                <meshBasicMaterial color={COLORS.zoneEdge} />
            </mesh>
        </group>
    );
}
