'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import Scene from './Scene';
import Ground from './Ground';
import Players from './Players';
import Resources from './Resources';
import Structures from './Structures';
import Zone from './Zone';
import ChatBubbles from './ChatBubbles';
import CameraController from './CameraController';
import Effects from './Effects';
import type { GameStateHook } from '../../hooks/useGameState';

interface Props {
    state: GameStateHook;
}

export default function GameCanvas({ state }: Props) {
    return (
        <Canvas
            camera={{ position: [25, 45, 40], fov: 50 }}
            shadows
            gl={{ antialias: true, alpha: false }}
            style={{ width: '100vw', height: '100vh', background: '#87CEEB' }}
        >
            <Suspense fallback={null}>
                <Scene />
                <Ground />
                <Players
                    players={state.players}
                    followId={state.followPlayer}
                />
                <Resources entities={state.entities.filter(e => e.type === 'RESOURCE')} />
                <Structures entities={state.entities.filter(e => ['WORKBENCH', 'BARRICADE', 'LOOT'].includes(e.type))} />
                {state.zone && <Zone zone={state.zone} />}
                <ChatBubbles chatLog={state.chatLog} players={state.players} />
                <CameraController
                    followId={state.followPlayer}
                    players={state.players}
                />
                <Effects />
            </Suspense>
        </Canvas>
    );
}
