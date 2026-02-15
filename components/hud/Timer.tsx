'use client';

import { useEffect, useState } from 'react';
import type { GameStateHook } from '../../hooks/useGameState';

interface Props {
    tick: number;
    aliveCount: number;
    gameState: GameStateHook['gameState'];
    nextShrinkTick?: number | null;
}

export default function Timer({ tick, aliveCount, gameState, nextShrinkTick }: Props) {
    // tick is 1s
    const minutes = Math.floor(tick / 60);
    const seconds = tick % 60;

    return (
        <div className="flex flex-col gap-2">
            {/* Main Timer */}
            <div className="bg-black/60 backdrop-blur text-white px-4 py-2 rounded-lg border-t-2 border-yellow-500 shadow-lg text-center">
                <div className="text-xs text-gray-400 font-bold uppercase tracking-widest">{gameState.replace('_', ' ')}</div>
                <div className="text-3xl font-mono font-bold tabular-nums">
                    {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
                </div>
            </div>

            {/* Alive Counter */}
            <div className="bg-black/60 backdrop-blur text-white px-4 py-1.5 rounded-lg flex items-center justify-between border-l-2 border-green-500">
                <span className="text-xs uppercase text-gray-400 font-bold mr-3">Alive</span>
                <span className="text-xl font-bold text-green-400">{aliveCount}</span>
            </div>

            {typeof nextShrinkTick === 'number' && nextShrinkTick >= tick && (
                <div className="bg-black/60 backdrop-blur text-white px-4 py-1.5 rounded-lg border-l-2 border-orange-400">
                    <span className="text-xs uppercase text-gray-400 font-bold mr-2">Next Shrink</span>
                    <span className="font-mono text-orange-300 font-bold">in {nextShrinkTick - tick}s</span>
                </div>
            )}
        </div>
    );
}
