'use client';

import type { InterpolatedPlayer } from '../../lib/types';

interface Props {
    players: InterpolatedPlayer[];
    followId: string | null;
    onFollow: (id: string | null) => void;
}

export default function Leaderboard({ players, followId, onFollow }: Props) {
    // Sort: Alive first, then by HP desc, then dead
    const sorted = [...players].sort((a, b) => {
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        if (a.alive && b.alive) return b.hp - a.hp;
        return b.kills - a.kills; // Among dead, sort by kills
    });

    return (
        <div className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white w-64 border border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2 text-gray-400">Agents Online ({players.filter(p => p.alive).length})</h3>
            <div className="space-y-1">
                {sorted.map(player => (
                    <div
                        key={player.id}
                        onClick={() => onFollow(player.id === followId ? null : player.id)}
                        className={`
                flex items-center justify-between text-xs p-1 rounded cursor-pointer transition-colors
                ${player.id === followId ? 'bg-blue-500/30 ring-1 ring-blue-400' : 'hover:bg-white/10'}
                ${!player.alive ? 'opacity-50 grayscale' : ''}
            `}
                    >
                        <div className="flex items-center gap-2 overflow-hidden">
                            <div className={`w-2 h-2 rounded-full ${player.alive ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]' : 'bg-red-500'}`} />
                            <span className="truncate font-mono">{player.display_name}</span>
                            {player.holding && (
                                <span className="text-[10px] text-gray-300" title={player.holding}>🗡️</span>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1" title="Kills">
                                <span className="text-red-400">☠</span>
                                <span>{player.kills}</span>
                            </div>
                            <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${player.hp > 50 ? 'bg-green-500' : player.hp > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                    style={{ width: `${player.hp}%` }}
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
