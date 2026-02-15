'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { EntityState } from '../../lib/types';
import { getTerrainHeight } from '../../lib/terrain';


const MODEL_BY_SUBTYPE: Record<string, string> = {
    tree: '/assets/models/environment/tree.glb',
    'tree-pine': '/assets/models/environment/tree-tall.glb',
    'tree-autumn': '/assets/models/environment/tree-autumn.glb',
    'tree-tall': '/assets/models/environment/tree-tall.glb',
    'rock-a': '/assets/models/environment/rock-a.glb',
    'rock-b': '/assets/models/environment/rock-b.glb',
    'rock-c': '/assets/models/environment/rock-c.glb',
};

const DECOR_MODELS = {
    grass: '/assets/models/environment/grass-large.glb',
    patch: '/assets/models/environment/patch-grass-large.glb',
    flatRock: '/assets/models/environment/rock-flat-grass.glb',
    log: '/assets/models/environment/tree-log-small.glb',
} as const;

Object.values(MODEL_BY_SUBTYPE).forEach(path => useGLTF.preload(path));
Object.values(DECOR_MODELS).forEach(path => useGLTF.preload(path));

interface Props {
    entities: EntityState[];
}

export default function Resources({ entities }: Props) {
    const grouped = useMemo(() => {
        const map = new Map<string, EntityState[]>();
        for (const entity of entities) {
            const subtype = entity.subtype || '';
            const modelPath = MODEL_BY_SUBTYPE[subtype] || (subtype.startsWith('tree')
                ? MODEL_BY_SUBTYPE.tree
                : MODEL_BY_SUBTYPE['rock-a']);
            if (!map.has(modelPath)) map.set(modelPath, []);
            map.get(modelPath)!.push(entity);
        }
        return Array.from(map.entries());
    }, [entities]);

    const decor = useMemo(() => {
        const grass: [number, number, number][] = [];
        const patch: [number, number, number][] = [];
        const flatRock: [number, number, number][] = [];
        const log: [number, number, number][] = [];

        for (const entity of entities) {
            const [x, z] = entity.position;
            const seed = hashNum(entity.id);
            const angleA = (seed % 628) / 100;
            const angleB = ((seed * 37) % 628) / 100;

            if ((entity.subtype || '').startsWith('tree')) {
                grass.push([x + Math.cos(angleA) * 0.9, z + Math.sin(angleA) * 0.9, 0.5 + (seed % 50) / 100]);
                patch.push([x + Math.cos(angleB) * 1.2, z + Math.sin(angleB) * 1.2, 0.45 + (seed % 40) / 100]);
                if (seed % 7 === 0) {
                    log.push([x + Math.cos(angleA + 1.2) * 1.5, z + Math.sin(angleA + 1.2) * 1.5, 0.35 + (seed % 20) / 100]);
                }
            } else if ((entity.subtype || '').startsWith('rock')) {
                flatRock.push([x + Math.cos(angleA) * 0.8, z + Math.sin(angleA) * 0.8, 0.35 + (seed % 20) / 100]);
                if (seed % 3 === 0) {
                    grass.push([x + Math.cos(angleB) * 1.0, z + Math.sin(angleB) * 1.0, 0.35 + (seed % 20) / 100]);
                }
            }
        }

        return { grass, patch, flatRock, log };
    }, [entities]);

    return (
        <>
            {grouped.map(([modelPath, items]) => (
                <InstancedByModel key={modelPath} modelPath={modelPath} entities={items} />
            ))}

            <DecorInstanced modelPath={DECOR_MODELS.grass} transforms={decor.grass} />
            <DecorInstanced modelPath={DECOR_MODELS.patch} transforms={decor.patch} />
            <DecorInstanced modelPath={DECOR_MODELS.flatRock} transforms={decor.flatRock} />
            <DecorInstanced modelPath={DECOR_MODELS.log} transforms={decor.log} />
        </>
    );
}

function InstancedByModel({ modelPath, entities }: { modelPath: string; entities: EntityState[] }) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const { scene } = useGLTF(modelPath);

    // Attempt to load colormap explicitly if needed, or use vertex colors
    // Kenney sometimes puts textures in a 'Textures' folder relative to the glb

    const { geometry, material } = useMemo(() => {
        let geo: THREE.BufferGeometry | null = null;
        let mat: THREE.Material | THREE.Material[] | null = null;
        scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && !geo) {
                geo = (child as THREE.Mesh).geometry;
                mat = (child as THREE.Mesh).material;

                if (mat instanceof THREE.MeshStandardMaterial) {
                    // If texture is missing/white, try to fix or set color
                }
            }
        });
        return { geometry: geo, material: mat };
    }, [scene]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useEffect(() => {
        if (!meshRef.current) return;
        entities.forEach((entity, i) => {
            const [x, z] = entity.position;
            const h = getTerrainHeight(x, z);
            const seed = hashNum(entity.id);

            dummy.position.set(x, h, z);
            dummy.rotation.y = (seed % 628) / 100;
            const scale = (entity.subtype || '').startsWith('tree')
                ? 0.45 + (seed % 30) / 100
                : 0.35 + (seed % 25) / 100;
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [entities, dummy]);

    if (entities.length === 0 || !geometry || !material) return null;

    return (
        <instancedMesh ref={meshRef} args={[geometry, material, entities.length]} castShadow receiveShadow>
        </instancedMesh>
    );
}

function DecorInstanced({
    modelPath,
    transforms,
}: {
    modelPath: string;
    transforms: [number, number, number][];
}) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const { scene } = useGLTF(modelPath);

    const { geometry, material } = useMemo(() => {
        let geo: THREE.BufferGeometry | null = null;
        let mat: THREE.Material | THREE.Material[] | null = null;
        scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && !geo) {
                geo = (child as THREE.Mesh).geometry;
                mat = (child as THREE.Mesh).material;
            }
        });
        return { geometry: geo, material: mat };
    }, [scene]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useEffect(() => {
        if (!meshRef.current) return;
        transforms.forEach(([x, z, scale], i) => {
            const h = getTerrainHeight(x, z);
            dummy.position.set(x, h + 0.02, z);
            dummy.rotation.y = (x * 1.7 + z * 2.1) % (Math.PI * 2);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [transforms, dummy]);

    if (transforms.length === 0 || !geometry || !material) return null;

    return (
        <instancedMesh ref={meshRef} args={[geometry, material, transforms.length]} castShadow receiveShadow>
        </instancedMesh>
    );
}

function hashNum(input: string) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}
