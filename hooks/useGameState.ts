'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket, disconnectSocket } from '../lib/socket';
import type {
    GameTick, PlayerState, EntityState, ZoneState,
    KillEvent, ChatEvent, GameOverData, InterpolatedPlayer
} from '../lib/types';

export interface GameStateHook {
    connected: boolean;
    gameState: 'LOBBY_OPEN' | 'GAME_ACTIVE' | 'GAME_OVER' | 'CONNECTING';
    tick: number;
    players: InterpolatedPlayer[];
    entities: EntityState[];
    zone: ZoneState | null;
    aliveCount: number;
    killFeed: KillEvent[];
    chatLog: ChatEvent[];
    gameOver: GameOverData | null;
    followPlayer: string | null;
    setFollowPlayer: (id: string | null) => void;
    announcements: { id: string; text: string; level: 'kill' | 'zone' | 'warning' }[];
}

export function useGameState(): GameStateHook {
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState<GameStateHook['gameState']>('CONNECTING');
    const [tick, setTick] = useState(0);
    const [rawPlayers, setRawPlayers] = useState<PlayerState[]>([]);
    const [entities, setEntities] = useState<EntityState[]>([]);
    const [zone, setZone] = useState<ZoneState | null>(null);
    const [aliveCount, setAliveCount] = useState(0);
    const [killFeed, setKillFeed] = useState<KillEvent[]>([]);
    const [chatLog, setChatLog] = useState<ChatEvent[]>([]);
    const [gameOver, setGameOver] = useState<GameOverData | null>(null);
    const [followPlayer, setFollowPlayer] = useState<string | null>(null);
    const [announcements, setAnnouncements] = useState<{ id: string; text: string; level: 'kill' | 'zone' | 'warning' }[]>([]);

    // Refs to hold latest state for event listeners (avoids stale closures)
    const rawPlayersRef = useRef<PlayerState[]>([]);
    const prevPositions = useRef<Map<string, [number, number]>>(new Map());
    const recentDamageRef = useRef<Map<string, number>>(new Map());
    const lastTickTime = useRef<number>(Date.now());

    // Update ref whenever state changes
    useEffect(() => {
        rawPlayersRef.current = rawPlayers;
    }, [rawPlayers]);

    const handleTick = useCallback((data: GameTick) => {
        // Store previous positions for interpolation using the LATEST rawPlayers from ref
        const newPrevPositions = new Map<string, [number, number]>();

        // We use rawPlayersRef.current here to get the players from the PREVIOUS tick
        // before we overwrite them with data.players
        for (const player of rawPlayersRef.current) {
            newPrevPositions.set(player.id, player.position);
        }

        // If a player is new in this tick (data.players), they won't be in rawPlayersRef
        // In that case, their "prev" position is just their current position (no interpolation for spawn)

        // Track HP drops for hit feedback animations
        const hpById = new Map<string, number>();
        for (const oldPlayer of rawPlayersRef.current) {
            hpById.set(oldPlayer.id, oldPlayer.hp);
        }
        const damageThisTick = new Map<string, number>();
        for (const nextPlayer of data.players) {
            const oldHp = hpById.get(nextPlayer.id);
            if (typeof oldHp === 'number' && oldHp > nextPlayer.hp) {
                damageThisTick.set(nextPlayer.id, oldHp - nextPlayer.hp);
            }
        }
        recentDamageRef.current = damageThisTick;

        prevPositions.current = newPrevPositions;
        lastTickTime.current = Date.now();

        setTick(data.tick);
        setGameState(data.game_state);
        setRawPlayers(data.players); // This triggers the useEffect above to update ref for NEXT tick
        setEntities(data.entities);
        setZone(data.zone);
        setAliveCount(data.alive_count);

        if (data.kill_log) {
            setKillFeed(data.kill_log.slice(-10).reverse());
        }
        if (data.chat_log) {
            setChatLog(data.chat_log.slice(-20).reverse());
        }
    }, []); // No dependencies needed now!

    useEffect(() => {
        const socket = getSocket();

        const pushAnnouncement = (text: string, level: 'kill' | 'zone' | 'warning') => {
            const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            setAnnouncements(prev => [
                ...prev,
                { id, text, level },
            ].slice(-4));

            setTimeout(() => {
                setAnnouncements(prev => prev.filter(a => a.id !== id));
            }, 3200);
        };

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on('sync', handleTick);
        socket.on('tick', handleTick);

        socket.on('kill', (event: KillEvent) => {
            setKillFeed(prev => [event, ...prev].slice(0, 10));
            const msg = event.killer_name
                ? `${event.killer_name} eliminated ${event.victim_name}`
                : `${event.victim_name} died to ${event.cause}`;
            pushAnnouncement(msg, 'kill');
        });

        socket.on('chat', (event: ChatEvent) => {
            setChatLog(prev => [event, ...prev].slice(0, 20));
        });

        socket.on('zone_shrink', (data: { new_radius: number; center: [number, number] }) => {
            setZone(prev => prev ? { ...prev, radius: data.new_radius } : null);
            pushAnnouncement(`⚠ Zone is shrinking! New radius: ${data.new_radius}`, 'zone');
        });

        socket.on('zone_warning', (data: { seconds_remaining: number; next_radius: number }) => {
            pushAnnouncement(`Zone shrinks in ${data.seconds_remaining}s (next radius ${data.next_radius})`, 'warning');
        });

        socket.on('game_over', (data: GameOverData) => {
            setGameOver(data);
            setGameState('GAME_OVER');

            // Snap frontend roster to only winner (if any) to avoid stale
            // second-last player persisting in final frame.
            if (data.winner?.id) {
                setRawPlayers(prev => {
                    const winner = prev.find(p => p.id === data.winner?.id);
                    if (!winner) return prev;
                    return [{
                        ...winner,
                        hp: data.winner?.hp ?? winner.hp,
                        kills: data.winner?.kills ?? winner.kills,
                        alive: true,
                    }];
                });
                setAliveCount(1);
            }
        });

        socket.on('game_start', () => {
            setGameOver(null);
            setGameState('GAME_ACTIVE');
        });

        return () => {
            disconnectSocket();
        };
    }, [handleTick]);

    // Create interpolated players
    const players: InterpolatedPlayer[] = rawPlayers.map(p => {
        const prev = prevPositions.current.get(p.id) || p.position;
        return {
            ...p,
            prevPosition: prev,
            renderX: p.position[0],
            renderZ: p.position[1],
            interpolationT: 0,
            recent_damage: recentDamageRef.current.get(p.id) || 0,
        };
    });

    return {
        connected,
        gameState,
        tick,
        players,
        entities,
        zone,
        aliveCount,
        killFeed,
        chatLog,
        gameOver,
        followPlayer,
        setFollowPlayer,
        announcements,
    };
}
