'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getTerrainHeight } from '../../lib/terrain';

const SIZE = 250;
const SEGMENTS = 700;

export default function Ground() {
    const meshRef = useRef<THREE.Mesh>(null);

    const geometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
        geo.rotateX(-Math.PI / 2);

        const posAttribute = geo.attributes.position;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < posAttribute.count; i++) {
            vertex.fromBufferAttribute(posAttribute, i);
            // vertex.x, vertex.z are world coords
            const h = getTerrainHeight(vertex.x, vertex.z);
            posAttribute.setY(i, h);
        }

        geo.computeVertexNormals();
        return geo;
    }, []);

    return (
        <mesh ref={meshRef} geometry={geometry} receiveShadow>
            <meshStandardMaterial
                color="#5c9c54" // Slightly varying green
                roughness={0.9}
                metalness={0.1}
                flatShading={false}
            />
        </mesh>
    );
}
