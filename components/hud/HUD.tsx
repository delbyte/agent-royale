'use client';

import type { GameStateHook } from '../../hooks/useGameState';
import MiniMap from './MiniMap';
import GameOverScreen from './GameOverScreen';

interface Props {
    state: GameStateHook;
}

export default function HUD({ state }: Props) {
    if (state.gameState === 'GAME_OVER' && state.gameOver) {
        return <GameOverScreen data={state.gameOver} />;
    }

    const minutes = Math.floor(state.tick / 60);
    const seconds = state.tick % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const sortedPlayers = [...state.players].sort((a, b) => {
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        if (a.alive && b.alive) return b.hp - a.hp;
        return b.kills - a.kills;
    });

    return (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000, color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Top Left: timer/state */}
            <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(0,0,0,0.62)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '10px 12px', minWidth: 170 }}>
                <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase' }}>{state.gameState.replace('_', ' ')}</div>
                <div style={{ fontSize: 28, fontFamily: 'monospace', fontWeight: 700 }}>{timeStr}</div>
                {typeof state.zone?.next_shrink_tick === 'number' && state.zone.next_shrink_tick >= state.tick && (
                    <div style={{ marginTop: 4, fontSize: 12, color: '#ffd27d' }}>
                        Next shrink in {state.zone.next_shrink_tick - state.tick}s
                    </div>
                )}
            </div>

            {/* Top right: kill feed */}
            <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
                {state.killFeed.slice(0, 6).map((event) => (
                    <div key={`${event.tick}-${event.victim_id}`} style={{ background: 'rgba(0,0,0,0.62)', border: '1px solid rgba(255,90,90,0.55)', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                        {event.killer_name
                            ? `${event.killer_name} eliminated ${event.victim_name}`
                            : `${event.victim_name} died to ${event.cause}`}
                    </div>
                ))}
            </div>

            {/* Top center: announcements */}
            <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                {state.announcements.map((a) => (
                    <div key={a.id} style={{ background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 700 }}>
                        {a.text}
                    </div>
                ))}
            </div>

            {/* Bottom-left: alive + leaderboard */}
            <div style={{ position: 'absolute', left: 16, bottom: 44, width: 270, background: 'rgba(0,0,0,0.58)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: 10, pointerEvents: 'auto', maxHeight: '42vh', overflowY: 'auto' }}>
                <div style={{ fontSize: 12, opacity: 0.95, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Agents</span>
                    <span style={{ color: '#86efac', fontWeight: 700 }}>{state.aliveCount} alive</span>
                </div>
                {sortedPlayers.map((player) => (
                    <button
                        key={player.id}
                        onClick={() => state.setFollowPlayer(player.id === state.followPlayer ? null : player.id)}
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            border: player.id === state.followPlayer ? '1px solid #60a5fa' : '1px solid transparent',
                            borderRadius: 6,
                            padding: '5px 6px',
                            marginBottom: 4,
                            background: player.id === state.followPlayer ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.04)',
                            color: '#fff',
                            opacity: player.alive ? 1 : 0.5,
                            cursor: 'pointer',
                            fontSize: 12,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: player.alive ? '#34d399' : '#ef4444', flex: '0 0 auto' }} />
                            {player.display_name}
                        </span>
                        <span style={{ fontFamily: 'monospace' }}>{player.hp} HP | {player.kills} K</span>
                    </button>
                ))}
            </div>

            {/* Bottom right: minimap */}
            <div style={{ position: 'absolute', right: 16, bottom: 16, pointerEvents: 'auto' }}>
                <MiniMap players={state.players} zone={state.zone} />
            </div>

        </div>
    );
}
