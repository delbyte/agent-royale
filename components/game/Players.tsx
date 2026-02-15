'use client';

import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { InterpolatedPlayer } from '../../lib/types';
import { getTerrainHeight } from '../../lib/terrain';

// List of available character models
const CHARACTERS = [
    'character-male-a', 'character-male-b', 'character-male-c', 'character-male-d', 'character-male-e', 'character-male-f',
    'character-female-a', 'character-female-b', 'character-female-c', 'character-female-d', 'character-female-e', 'character-female-f'
];

// Preload all models
CHARACTERS.forEach(char => {
    useGLTF.preload(`/assets/models/characters/${char}.glb`);
});

interface Props {
    players: InterpolatedPlayer[];
    followId: string | null;
}

export default function Players({ players, followId }: Props) {
    return (
        <group>
            {players.filter(p => p.alive).map(player => (
                <PlayerMesh key={player.id} player={player} isFollowed={player.id === followId} />
            ))}
        </group>
    );
}

function PlayerMesh({ player, isFollowed }: { player: InterpolatedPlayer; isFollowed: boolean }) {
    const groupRef = useRef<THREE.Group>(null);
    const modelRootRef = useRef<THREE.Group>(null);
    const slashRef = useRef<THREE.Mesh>(null);
    const sparkRef = useRef<THREE.Mesh>(null);
    const hitFlashRef = useRef<THREE.Mesh>(null);
    const prevPos = useRef<[number, number]>(player.position);
    const lastTickTime = useRef(Date.now());
    const actionPulseStart = useRef<number>(-1);
    const lastActionTickRef = useRef<number | null>(null);
    const lastDamageStart = useRef<number>(-1);

    const [floatingDamage, setFloatingDamage] = useState<{ amount: number } | null>(null);

    // Deterministically choose a model based on player ID
    const modelName = useMemo(() => {
        let hash = 0;
        for (let i = 0; i < player.id.length; i++) {
            hash = player.id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % CHARACTERS.length;
        return CHARACTERS[index];
    }, [player.id]);

    // Load the model
    const { scene } = useGLTF(`/assets/models/characters/${modelName}.glb`);

    // Clone the scene for this instance
    const clone = useMemo(() => {
        const cloned = SkeletonUtils.clone(scene);
        cloned.scale.set(0.4, 0.4, 0.4);

        cloned.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                if (mat.map) {
                    mat.map.colorSpace = THREE.SRGBColorSpace;
                    mat.needsUpdate = true;
                }
            }
        });
        return cloned;
    }, [scene]);

    useEffect(() => {
        if (player.last_action_tick == null) return;
        if (lastActionTickRef.current === player.last_action_tick) return;
        lastActionTickRef.current = player.last_action_tick;
        actionPulseStart.current = Date.now();
    }, [player.last_action_tick]);

    useEffect(() => {
        if (!player.recent_damage || player.recent_damage <= 0) return;
        lastDamageStart.current = Date.now();
        setFloatingDamage({ amount: player.recent_damage });
    }, [player.recent_damage]);

    useEffect(() => {
        if (!floatingDamage) return;
        const timer = setTimeout(() => setFloatingDamage(null), 900);
        return () => clearTimeout(timer);
    }, [floatingDamage]);

    // Detect position change
    const posChanged = player.position[0] !== prevPos.current[0] || player.position[1] !== prevPos.current[1];
    if (posChanged) {
        prevPos.current = player.prevPosition;
        lastTickTime.current = Date.now();
    }

    useFrame(() => {
        if (!groupRef.current || !modelRootRef.current) return;

        const elapsed = Date.now() - lastTickTime.current;
        const t = Math.min(elapsed / 1000, 1);
        const smooth = t * t * (3 - 2 * t);

        const x = THREE.MathUtils.lerp(prevPos.current[0], player.position[0], smooth);
        const z = THREE.MathUtils.lerp(prevPos.current[1], player.position[1], smooth);

        // Get Terrain Height for Y
        const y = getTerrainHeight(x, z);

        groupRef.current.position.set(x, y, z);

        // Rotate
        if (Math.abs(player.position[0] - prevPos.current[0]) > 0.01 || Math.abs(player.position[1] - prevPos.current[1]) > 0.01) {
            const angle = Math.atan2(player.position[0] - prevPos.current[0], player.position[1] - prevPos.current[1]);
            groupRef.current.rotation.y = angle;
        }

        const now = Date.now();
        const isMoving = Math.abs(player.position[0] - prevPos.current[0]) > 0.01 || Math.abs(player.position[1] - prevPos.current[1]) > 0.01;
        const baseBob = isMoving ? Math.sin(now * 0.015) * 0.035 : Math.sin(now * 0.003) * 0.01;

        modelRootRef.current.position.y = baseBob;
        modelRootRef.current.rotation.x = 0;
        modelRootRef.current.rotation.z = 0;
        modelRootRef.current.scale.set(1, 1, 1);

        const actionType = player.last_action || null;
        const actionAge = actionPulseStart.current > 0 ? now - actionPulseStart.current : Infinity;

        const actionNorm = Math.max(0, Math.min(1, 1 - actionAge / 550));
        const attackWave = Math.sin((1 - actionNorm) * Math.PI * 2.2);
        const craftWave = Math.sin((1 - actionNorm) * Math.PI * 4.0);

        if (actionType === 'ATTACK' && actionNorm > 0) {
            modelRootRef.current.rotation.x = -Math.max(0, attackWave) * 0.55;
            modelRootRef.current.position.z = -Math.max(0, attackWave) * 0.2;
        } else if (actionType === 'HARVEST' && actionNorm > 0) {
            modelRootRef.current.rotation.x = -Math.abs(craftWave) * 0.65;
            modelRootRef.current.rotation.z = Math.sin((1 - actionNorm) * Math.PI * 2.0) * 0.12;
        } else if (actionType === 'CRAFT' && actionNorm > 0) {
            modelRootRef.current.rotation.x = -Math.abs(craftWave) * 0.35;
            modelRootRef.current.position.y = baseBob + Math.abs(craftWave) * 0.02;
        } else if (actionType === 'USE' && actionNorm > 0) {
            modelRootRef.current.rotation.z = Math.sin((1 - actionNorm) * Math.PI * 2.5) * 0.2;
        } else if (actionType === 'TALK' && actionNorm > 0) {
            modelRootRef.current.rotation.y = Math.sin((1 - actionNorm) * Math.PI * 2.5) * 0.1;
        }

        if (slashRef.current) {
            const showSlash = actionType === 'ATTACK' && actionNorm > 0;
            slashRef.current.visible = showSlash;
            if (showSlash) {
                slashRef.current.material.opacity = actionNorm * 0.85;
                slashRef.current.rotation.y = (1 - actionNorm) * Math.PI * 1.6;
            }
        }

        if (sparkRef.current) {
            const showSpark = (actionType === 'HARVEST' || actionType === 'CRAFT') && actionNorm > 0;
            sparkRef.current.visible = showSpark;
            if (showSpark) {
                const size = 0.12 + (1 - actionNorm) * 0.2;
                sparkRef.current.scale.set(size, size, size);
                (sparkRef.current.material as THREE.MeshBasicMaterial).opacity = actionNorm * 0.9;
            }
        }

        if (hitFlashRef.current) {
            const hitAge = lastDamageStart.current > 0 ? now - lastDamageStart.current : Infinity;
            const hitNorm = Math.max(0, Math.min(1, 1 - hitAge / 450));
            hitFlashRef.current.visible = hitNorm > 0;
            if (hitNorm > 0) {
                const mat = hitFlashRef.current.material as THREE.MeshBasicMaterial;
                mat.opacity = hitNorm * 0.45;
                const s = 0.9 + (1 - hitNorm) * 0.6;
                hitFlashRef.current.scale.set(s, s, s);
            }
        }
    });

    const hpRatio = player.hp / 100;

    return (
        <group ref={groupRef}>
            <group ref={modelRootRef}>
                <primitive object={clone} />
            </group>

            <mesh ref={slashRef} position={[0, 1.05, 0.45]} visible={false}>
                <torusGeometry args={[0.28, 0.03, 8, 24, Math.PI * 1.1]} />
                <meshBasicMaterial color="#ff8844" transparent opacity={0} />
            </mesh>

            <mesh ref={sparkRef} position={[0, 0.95, 0.28]} visible={false}>
                <icosahedronGeometry args={[0.2, 0]} />
                <meshBasicMaterial color="#ffd166" transparent opacity={0} />
            </mesh>

            <mesh ref={hitFlashRef} position={[0, 1.0, 0]} visible={false}>
                <sphereGeometry args={[0.45, 10, 10]} />
                <meshBasicMaterial color="#ff3b3b" transparent opacity={0} wireframe />
            </mesh>

            {isFollowed && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
                    <ringGeometry args={[0.5, 0.6, 32]} />
                    <meshBasicMaterial color="#00ffff" transparent opacity={0.8} />
                </mesh>
            )}

            {floatingDamage && (
                <Html
                    position={[0, 2.75, 0]}
                    center
                    distanceFactor={18}
                    zIndexRange={[120, 0]}
                >
                    <div style={{
                        color: '#ff6b6b',
                        fontSize: '14px',
                        fontWeight: 800,
                        fontFamily: 'monospace',
                        textShadow: '0 0 6px rgba(0,0,0,0.8)',
                        pointerEvents: 'none',
                    }}>
                        -{floatingDamage.amount}
                    </div>
                </Html>
            )}

            <Html position={[0, 1.8, 0]} center distanceFactor={15} zIndexRange={[100, 0]}>
                <div style={{
                    background: 'rgba(0,0,0,0.7)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    color: 'white',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                    userSelect: 'none',
                    pointerEvents: 'none',
                }}>
                    <div style={{ fontWeight: 'bold' }}>{player.display_name}</div>
                    <div style={{
                        width: '50px',
                        height: '3px',
                        background: '#333',
                        borderRadius: '2px',
                        marginTop: '2px',
                    }}>
                        <div style={{
                            width: `${player.hp}%`,
                            height: '100%',
                            background: hpRatio > 0.5 ? '#00ff88' : hpRatio > 0.25 ? '#ffaa00' : '#ff4444',
                            borderRadius: '2px',
                            transition: 'width 0.3s',
                        }} />
                    </div>
                    <div style={{ fontSize: '9px', color: '#ddd', marginTop: '1px' }}>
                        HP {player.hp}
                    </div>
                    {player.holding && (
                        <div style={{ fontSize: '9px', color: '#aaa', marginTop: '1px' }}>
                            🗡️ {player.holding}
                        </div>
                    )}
                </div>
            </Html>
        </group>
    );
}
