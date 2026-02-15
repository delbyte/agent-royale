'use client';

import GameCanvas from '../../components/game/GameCanvas';
import HUD from '../../components/hud/HUD';
import { useGameState } from '../../hooks/useGameState';

const LOBBY_TARGET_PLAYERS = 10;

export default function GamePage() {
    const state = useGameState();
    const joinedPlayers = Math.min(state.players.length, LOBBY_TARGET_PLAYERS);
    const showLobbyOverlay = state.gameState === 'CONNECTING' || state.gameState === 'LOBBY_OPEN';
    const showHud = state.gameState === 'GAME_ACTIVE' || state.gameState === 'GAME_OVER';

    return (
        <main className="relative w-full h-screen overflow-hidden bg-black">
            <GameCanvas state={state} />
            {showHud && <HUD state={state} />}

            {showLobbyOverlay && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 2000,
                        background: 'rgba(4, 6, 12, 0.96)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 24,
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            maxWidth: 560,
                            borderRadius: 18,
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: 'rgba(10, 14, 26, 0.95)',
                            padding: '28px 24px',
                            textAlign: 'center',
                            color: '#fff',
                            fontFamily: 'var(--font-sans), Geist Sans, Geist, system-ui, sans-serif',
                        }}
                    >
                        <div
                            style={{
                                fontSize: 13,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: 'rgba(255,255,255,0.65)',
                                marginBottom: 10,
                            }}
                        >
                            In Lobby
                        </div>

                        <h1
                            style={{
                                margin: 0,
                                fontSize: 'clamp(1.8rem, 4vw, 2.4rem)',
                                lineHeight: 1.1,
                                letterSpacing: '-0.02em',
                            }}
                        >
                            Waiting for other players to join
                        </h1>

                        <div
                            style={{
                                marginTop: 18,
                                fontSize: 30,
                                fontWeight: 700,
                                color: '#60a5fa',
                            }}
                        >
                            {joinedPlayers}/{LOBBY_TARGET_PLAYERS}
                        </div>

                        <div
                            style={{
                                marginTop: 8,
                                fontSize: 14,
                                color: 'rgba(255,255,255,0.72)',
                            }}
                        >
                            Game starts automatically when the lobby fills and server starts the match.
                        </div>

                        <div
                            style={{
                                marginTop: 14,
                                fontSize: 12,
                                color: state.connected ? '#86efac' : '#fca5a5',
                            }}
                        >
                            {state.connected ? 'Connected to server' : 'Reconnecting to server...'}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
