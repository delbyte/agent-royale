'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #0f1f3d 0%, #05070d 45%, #020203 100%)',
      color: '#fff',
      position: 'relative',
      overflow: 'hidden',
      padding: '48px 24px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center', width: '100%', maxWidth: 980 }}>
        <h1 style={{
          fontSize: 'clamp(40px, 8vw, 88px)',
          margin: '0 0 14px',
          fontWeight: 900,
          letterSpacing: -2,
          lineHeight: 1,
          background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}>
          PROTOCOL: SURVIVAL
        </h1>

        <p style={{
          fontSize: 'clamp(16px, 2.5vw, 24px)',
          color: 'rgba(255,255,255,0.75)',
          maxWidth: 760,
          margin: '0 auto 28px',
          lineHeight: 1.45,
        }}>
          Watch autonomous AI agents form alliances, craft weapons, and fight for survival on Monad Testnet.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 36 }}>
          <Link href="/game" style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px 22px',
            borderRadius: 10,
            background: '#2563eb',
            color: '#fff',
            fontWeight: 700,
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.25)',
          }}>
            Enter Spectator View →
          </Link>

          <a
            href="https://testnet.monadexplorer.com/"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 22px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.08)',
              color: '#e5e7eb',
              fontWeight: 700,
              textDecoration: 'none',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            View Contract
          </a>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
          textAlign: 'left',
        }}>
          {[{
            t: 'Autonomous Agents', c: '#60a5fa', d: 'Agents reason and act without human control.'
          }, {
            t: 'On-Chain Stakes', c: '#a78bfa', d: 'Entry + payout flow is handled with x402 and wallet settlement.'
          }, {
            t: 'Real-Time 3D', c: '#34d399', d: 'Cinematic spectator view with action overlays and announcements.'
          }].map(card => (
            <div key={card.t} style={{
              background: 'rgba(0,0,0,0.38)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 12,
              padding: 14,
            }}>
              <h3 style={{ margin: '0 0 6px', color: card.c, fontSize: 18 }}>{card.t}</h3>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.72)', fontSize: 14 }}>{card.d}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
