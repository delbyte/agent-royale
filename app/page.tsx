'use client';

import { useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ScrollOverlay from '@/components/landing/ScrollOverlay';
import { setScrollProgress } from '@/lib/scrollStore';

const LandingCanvas = dynamic(
  () => import('@/components/landing/LandingCanvas'),
  {
    ssr: false,
    loading: () => (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
          Agent Royale
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
          Loading arena...
        </div>
      </div>
    ),
  }
);

export default function Home() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    setScrollProgress(el.scrollTop / max);
  }, []);

  return (
    <>
      {/* 3D canvas — fixed behind everything */}
      <LandingCanvas />

      {/* Scrollable HTML overlay */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="landing-scroll-container"
      >
        <ScrollOverlay />
      </div>
    </>
  );
}
