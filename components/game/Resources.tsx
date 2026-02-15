'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { EntityState } from '../../lib/types';
import { getTerrainHeight } from '../../lib/terrain';


// Preload models
useGLTF.preload('/assets/models/environment/tree.glb');
useGLTF.preload('/assets/models/environment/rock-a.glb');

interface Props {
    entities: EntityState[];
}

export default function Resources({ entities }: Props) {
    const trees = entities.filter(e => e.subtype === 'tree' || e.subtype === 'tree-pine');
    const rocks = entities.filter(e => e.subtype === 'rock-a' || e.subtype === 'rock-b');

    return (
        <>
            <InstancedTrees trees={trees} />
            <InstancedRocks rocks={rocks} />
        </>
    );
}

function InstancedTrees({ trees }: { trees: EntityState[] }) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const { scene } = useGLTF('/assets/models/environment/tree.glb');

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
        trees.forEach((tree, i) => {
            const h = getTerrainHeight(tree.position[0], tree.position[1]);
            dummy.position.set(tree.position[0], h, tree.position[1]);
            dummy.rotation.y = tree.position[0] * 1.5;
            const scale = 0.5 + (tree.position[1] % 5) * 0.05;
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [trees, dummy]);

    if (trees.length === 0 || !geometry || !material) return null;

    return (
        <instancedMesh ref={meshRef} args={[geometry, material, trees.length]} castShadow receiveShadow>
        </instancedMesh>
    );
}

function InstancedRocks({ rocks }: { rocks: EntityState[] }) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const { scene } = useGLTF('/assets/models/environment/rock-a.glb');

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
        rocks.forEach((rock, i) => {
            const h = getTerrainHeight(rock.position[0], rock.position[1]);
            dummy.position.set(rock.position[0], h, rock.position[1]);
            dummy.rotation.y = rock.position[1];
            const scale = 0.4 + (rock.position[0] % 3) * 0.1;
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [rocks, dummy]);

    if (rocks.length === 0 || !geometry || !material) return null;

    return (
        <instancedMesh ref={meshRef} args={[geometry, material, rocks.length]} castShadow receiveShadow>
        </instancedMesh>
    );
}
