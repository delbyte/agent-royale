'use client';

import { useGLTF } from '@react-three/drei';
import type { EntityState } from '../../lib/types';
import { useMemo } from 'react';
import { getTerrainHeight } from '../../lib/terrain';

// Preload
useGLTF.preload('/assets/models/environment/workbench.glb');
useGLTF.preload('/assets/models/environment/chest.glb');
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
    const { scene } = useGLTF('/assets/models/environment/chest.glb');
    const clone = useMemo(() => {
        const c = scene.clone();
        c.scale.set(0.4, 0.4, 0.4);
        return c;
    }, [scene]);

    const y = getTerrainHeight(entity.position[0], entity.position[1]);
    return <primitive object={clone} position={[entity.position[0], y, entity.position[1]]} rotation={[0, Math.PI / 4, 0]} />;
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
