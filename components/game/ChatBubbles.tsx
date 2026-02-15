'use client';

import { Html } from '@react-three/drei';
import { useState, useEffect, useRef } from 'react';
import type { ChatEvent, InterpolatedPlayer } from '../../lib/types';
import { getTerrainHeight } from '../../lib/terrain';

interface Props {
    chatLog: ChatEvent[];
    players: InterpolatedPlayer[];
}

export default function ChatBubbles({ chatLog, players }: Props) {
    const [displayMessages, setDisplayMessages] = useState<(ChatEvent & { receivedAt: number })[]>([]);
    const lastTickRef = useRef(-1);

    // 1. Detect new messages
    useEffect(() => {
        const newMsgs = chatLog.filter(m => m.tick > lastTickRef.current);
        if (newMsgs.length > 0) {
            const now = Date.now();
            const tagged = newMsgs.map(m => ({ ...m, receivedAt: now }));

            setDisplayMessages(prev => {
                return [...prev, ...tagged];
            });

            const maxTick = Math.max(...newMsgs.map(m => m.tick));
            lastTickRef.current = Math.max(lastTickRef.current, maxTick);
        }
    }, [chatLog]);

    // 2. Prune old messages
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setDisplayMessages(prev => prev.filter(m => now - m.receivedAt < 3000));
        }, 100);
        return () => clearInterval(interval);
    }, []);

    return (
        <group>
            {displayMessages.map((msg, idx) => {
                const player = players.find(p => p.id === msg.from);
                if (!player) return null;

                const y = getTerrainHeight(player.position[0], player.position[1]) + 2.5;

                return (
                    <Html key={`${msg.tick}-${idx}`} position={[player.position[0], y, player.position[1]]} center zIndexRange={[100, 0]}>
                        <div style={{
                            background: 'white',
                            borderRadius: '8px',
                            padding: '4px 8px',
                            fontSize: '12px',
                            fontFamily: 'sans-serif',
                            border: '1px solid #ccc',
                            maxWidth: '150px',
                            textAlign: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            pointerEvents: 'none',
                            color: 'black',
                            fontWeight: 'bold',
                        }}>
                            {msg.text}
                            <div style={{
                                position: 'absolute',
                                bottom: '-4px',
                                left: '50%',
                                marginLeft: '-4px',
                                width: 0,
                                height: 0,
                                borderLeft: '4px solid transparent',
                                borderRight: '4px solid transparent',
                                borderTop: '4px solid white'
                            }} />
                        </div>
                    </Html>
                );
            })}
        </group>
    );
}
