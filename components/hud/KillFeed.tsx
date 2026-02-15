'use client';

import type { KillEvent } from '../../lib/types';
import { useEffect, useState } from 'react';

interface Props {
    events: KillEvent[];
}

export default function KillFeed({ events }: Props) {
    // In a real implementation we might animate these in/out more complexly
    // detailed logic is handled in the reducer/state hook usually to trim old ones
    // Here we just render what we are given

    return (
        <div className="flex flex-col items-end pointer-events-none">
            {events.map((event, i) => (
                <div
                    key={`${event.tick}-${event.victim_id}`}
                    className="bg-black/60 backdrop-blur text-white px-3 py-1.5 rounded mb-1 text-sm font-mono flex items-center gap-2 animate-in slide-in-from-right fade-in duration-300 border-l-2 border-red-500"
                >
                    {event.killer_name ? (
                        <>
                            <span className="text-blue-300 font-bold">{event.killer_name}</span>
                            <span className="text-gray-400">eliminated</span>
                            <span className="text-red-300 font-bold">{event.victim_name}</span>
                            <span className="text-xs text-gray-500">with {event.cause}</span>
                        </>
                    ) : (
                        <>
                            <span className="text-red-300 font-bold">{event.victim_name}</span>
                            <span className="text-gray-400">died to</span>
                            <span className="text-yellow-500 font-bold">{event.cause}</span>
                        </>
                    )}
                </div>
            ))}
        </div>
    );
}
