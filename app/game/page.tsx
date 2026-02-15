'use client';

import GameCanvas from '../../components/game/GameCanvas';
import HUD from '../../components/hud/HUD';
import { useGameState } from '../../hooks/useGameState';

export default function GamePage() {
    const state = useGameState();

    return (
        <main className="relative w-full h-screen overflow-hidden bg-black">
            <GameCanvas state={state} />
            <HUD state={state} />
        </main>
    );
}
