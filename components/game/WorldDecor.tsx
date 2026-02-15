'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getTerrainHeight } from '../../lib/terrain';

const DECOR = {
    tent: '/assets/models/environment/tent-canvas.glb',
    bedroll: '/assets/models/environment/bedroll.glb',
    sign: '/assets/models/environment/signpost-single.glb',
    campfire: '/assets/models/environment/campfire-pit.glb',
};

Object.values(DECOR).forEach(path => useGLTF.preload(path));

const CAMPS: Array<{ x: number; z: number; rot: number }> = [
    { x: 7, z: 9, rot: 0.6 },
    { x: 12, z: 42, rot: 1.8 },
    { x: 41, z: 11, rot: 3.2 },
    { x: 39, z: 39, rot: 4.1 },
    { x: 25, z: 6, rot: 2.5 },
    { x: 6, z: 25, rot: 1.1 },
];

export default function WorldDecor() {
    return (
        <group>
            {CAMPS.map((camp, i) => (
                <CampCluster key={`camp_${i}`} x={camp.x} z={camp.z} rot={camp.rot} />
            ))}
        </group>
    );
}

function CampCluster({ x, z, rot }: { x: number; z: number; rot: number }) {
    const tent = useDecorClone(DECOR.tent, 0.46);
    const bedroll = useDecorClone(DECOR.bedroll, 0.38);
    const sign = useDecorClone(DECOR.sign, 0.35);

    const baseY = getTerrainHeight(x, z);

    return (
        <group position={[x, baseY, z]} rotation={[0, rot, 0]}>
            {tent && <primitive object={tent} position={[0, 0.03, 0]} />}
            {bedroll && <primitive object={bedroll} position={[-0.95, 0.03, 0.8]} rotation={[0, 0.8, 0]} />}
            {sign && <primitive object={sign} position={[1.1, 0.03, -0.85]} />}
            <Campfire x={0.55} z={0.95} />
        </group>
    );
}

function Campfire({ x, z }: { x: number; z: number }) {
    const lightRef = useRef<THREE.PointLight>(null);
    const fireRef = useRef<THREE.Group>(null);
    const fire = useDecorClone(DECOR.campfire, 0.36);

    useFrame(({ clock }) => {
        const t = clock.getElapsedTime();
        if (lightRef.current) {
            lightRef.current.intensity = 1.1 + Math.sin(t * 8.5) * 0.2 + Math.sin(t * 13.2) * 0.1;
        }
        if (fireRef.current) {
            const s = 1 + Math.sin(t * 6.2) * 0.02;
            fireRef.current.scale.set(s, s, s);
        }
    });

    return (
        <group ref={fireRef} position={[x, 0.02, z]}>
            {fire && <primitive object={fire} />}
            <pointLight ref={lightRef} color="#ff9f43" intensity={1.15} distance={5.2} decay={2} position={[0, 1.2, 0]} />
        </group>
    );
}

function useDecorClone(path: string, scale: number) {
    const { scene } = useGLTF(path);
    return useMemo(() => {
        const clone = scene.clone();
        clone.scale.set(scale, scale, scale);
        clone.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).castShadow = true;
                (child as THREE.Mesh).receiveShadow = true;
            }
        });
        return clone;
    }, [scene, scale]);
}
