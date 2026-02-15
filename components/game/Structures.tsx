'use client';

import { useGLTF } from '@react-three/drei';
import type { EntityState } from '../../lib/types';
import { useMemo } from 'react';
import { getTerrainHeight } from '../../lib/terrain';

// Preload
useGLTF.preload('/assets/models/environment/workbench.glb');
useGLTF.preload('/assets/models/environment/chest.glb');
useGLTF.preload('/assets/models/environment/barrel.glb');
useGLTF.preload('/assets/models/environment/fence.glb');

interface Props {
    entities: EntityState[];
}

export default function Structures({ entities }: Props) {
    return (
        <group>
            {entities.map(entity => {
                if (entity.type === 'WORKBENCH') {
                    return <Workbench key={entity.id} entity={entity} />;
                } else if (entity.type === 'LOOT') {
                    return <LootCrate key={entity.id} entity={entity} />;
                } else if (entity.type === 'BARRICADE') {
                    return <Barricade key={entity.id} entity={entity} />;
                }
                return null;
            })}
        </group>
    );
}

function Workbench({ entity }: { entity: EntityState }) {
    const { scene } = useGLTF('/assets/models/environment/workbench.glb');
    const clone = useMemo(() => {
        const c = scene.clone();
        c.scale.set(0.5, 0.5, 0.5);
        return c;
    }, [scene]);

    const y = getTerrainHeight(entity.position[0], entity.position[1]);
    return <primitive object={clone} position={[entity.position[0], y, entity.position[1]]} />;
}

function LootCrate({ entity }: { entity: EntityState }) {
    const modelPath = entity.subtype === 'barrel'
        ? '/assets/models/environment/barrel.glb'
        : '/assets/models/environment/chest.glb';
    const { scene } = useGLTF(modelPath);
    const clone = useMemo(() => {
        const c = scene.clone();
        const scale = entity.subtype === 'barrel' ? 0.35 : 0.4;
        c.scale.set(scale, scale, scale);
        return c;
    }, [scene, entity.subtype]);

    const y = getTerrainHeight(entity.position[0], entity.position[1]);
    const spin = ((entity.position[0] * 19 + entity.position[1] * 7) % 360) * (Math.PI / 180);
    return <primitive object={clone} position={[entity.position[0], y, entity.position[1]]} rotation={[0, spin, 0]} />;
}

function Barricade({ entity }: { entity: EntityState }) {
    const { scene } = useGLTF('/assets/models/environment/fence.glb');
    const clone = useMemo(() => {
        const c = scene.clone();
        c.scale.set(0.5, 0.5, 0.5);
        return c;
    }, [scene]);

    const y = getTerrainHeight(entity.position[0], entity.position[1]);
    return <primitive object={clone} position={[entity.position[0], y, entity.position[1]]} />;
}
