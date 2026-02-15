'use client';

import { useEffect, useRef } from 'react';
import { GRID_SIZE, COLORS } from '../../lib/constants';
import type { InterpolatedPlayer, ZoneState } from '../../lib/types';

interface Props {
    players: InterpolatedPlayer[];
    zone: ZoneState | null;
}

export default function MiniMap({ players, zone }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = 'rgba(0, 20, 0, 0.8)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const scale = canvas.width / GRID_SIZE;

        // Draw Zone
        if (zone) {
            ctx.beginPath();
            ctx.arc(zone.center[0] * scale, zone.center[1] * scale, zone.radius * scale, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ff3333';
            ctx.stroke();
        }

        // Draw Players
        players.forEach(p => {
            if (!p.alive) return;
            const x = p.position[0] * scale;
            const y = p.position[1] * scale;

            ctx.fillStyle = COLORS.playerAlive;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });

    }, [players, zone]);

    // CSS border for the shrinking zone effect visual
    return (
        <div className="bg-black/50 p-1 rounded-full border-2 border-white/10 shadow-xl backdrop-blur-md">
            <canvas
                ref={canvasRef}
                width={150}
                height={150}
                className="rounded-full"
            />
        </div>
    );
}
