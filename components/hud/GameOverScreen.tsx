'use client';

import type { GameOverData } from '../../lib/types';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import confetti from 'canvas-confetti';

interface Props {
    data: GameOverData;
}

export default function GameOverScreen({ data }: Props) {
    const router = useRouter();
    const [show, setShow] = useState(false);
    const [redirectIn, setRedirectIn] = useState(8);
    const hasNavigatedRef = useRef(false);

    useEffect(() => {
        // Delay slightly for dramatic effect
        const t = setTimeout(() => setShow(true), 500);
        let confettiInterval: ReturnType<typeof setInterval> | null = null;

        // Fire confetti
        if (data.winner) {
            const duration = 5000;
            const animationEnd = Date.now() + duration;
            const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

            const random = (min: number, max: number) => Math.random() * (max - min) + min;

            confettiInterval = setInterval(function () {
                const timeLeft = animationEnd - Date.now();

                if (timeLeft <= 0) {
                    if (confettiInterval) clearInterval(confettiInterval);
                    return;
                }

                const particleCount = 50 * (timeLeft / duration);
                confetti({ ...defaults, particleCount, origin: { x: random(0.1, 0.3), y: random(0.1, 0.2) } });
                confetti({ ...defaults, particleCount, origin: { x: random(0.7, 0.9), y: random(0.1, 0.2) } });
            }, 250);
        }

        return () => {
            clearTimeout(t);
            if (confettiInterval) clearInterval(confettiInterval);
        };
    }, [data]);

    useEffect(() => {
        const interval = setInterval(() => {
            setRedirectIn(prev => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (redirectIn !== 0 || hasNavigatedRef.current) return;
        hasNavigatedRef.current = true;
        router.push('/');
    }, [redirectIn, router]);

    if (!show) return null;

    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            color: '#fff',
            fontFamily: 'Inter, system-ui, sans-serif',
        }}>
            <div style={{ maxWidth: 860, width: '92%', textAlign: 'center' }}>
                <h1 style={{
                    fontSize: 'clamp(40px, 6vw, 80px)',
                    margin: '0 0 10px',
                    fontWeight: 900,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    color: '#fcd34d',
                    textShadow: '0 0 20px rgba(252,211,77,0.35)',
                }}>
                    Victory Royale
                </h1>

                {data.winner ? (
                    <div style={{
                        background: 'linear-gradient(180deg, rgba(31,41,55,0.95), rgba(17,24,39,0.95))',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 20,
                        padding: '28px 24px',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
                    }}>
                        <h2 style={{ margin: 0, fontSize: 18, color: 'rgba(255,255,255,0.72)', fontWeight: 500 }}>Winner</h2>
                        <div style={{ fontSize: 'clamp(32px,5vw,58px)', fontWeight: 900, margin: '8px 0 18px' }}>{data.winner.display_name}</div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
                            <div style={{ background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: 12 }}>
                                <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase' }}>Kills</div>
                                <div style={{ fontSize: 28, fontFamily: 'monospace', color: '#fca5a5', fontWeight: 800 }}>{data.winner.kills}</div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: 12 }}>
                                <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase' }}>HP Remaining</div>
                                <div style={{ fontSize: 28, fontFamily: 'monospace', color: '#86efac', fontWeight: 800 }}>{data.winner.hp}</div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: 12 }}>
                                <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase' }}>Prize Pool</div>
                                <div style={{ fontSize: 20, fontFamily: 'monospace', color: '#fcd34d', fontWeight: 800 }}>{data.pool_display}</div>
                            </div>
                        </div>

                        {data.payout_tx_hash && (
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Payout Transaction</div>
                                <a
                                    href={data.payout_explorer_url || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'inline-flex',
                                        padding: '8px 12px',
                                        borderRadius: 8,
                                        border: '1px solid rgba(96,165,250,0.4)',
                                        background: 'rgba(37,99,235,0.2)',
                                        color: '#93c5fd',
                                        fontFamily: 'monospace',
                                        fontSize: 13,
                                        textDecoration: 'none',
                                    }}
                                >
                                    🔗 View on Monad Explorer
                                </a>
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ fontSize: 28, opacity: 0.75 }}>
                        No Winner (Draw)
                    </div>
                )}

                <div style={{ marginTop: 18, fontSize: 14, opacity: 0.75 }}>
                    Returning to landing page in {redirectIn}s...
                </div>
            </div>
        </div>
    );
}
