# Phase 4 Spec: 3D Frontend (Next.js + React Three Fiber + Socket.io)

> **Owner:** Frontend Engineer
> **Effort:** ~5 hours
> **Dependencies:** Phase 1 (Game Server with Socket.io broadcasting)
> **Output:** A Next.js app with a cinematic 3D spectator view of the battle royale using React Three Fiber, Kenney Survival Kit GLB assets, smooth interpolation, and a full HUD (leaderboard, kill feed, minimap, timer).

---

## 1. Overview

The frontend serves two purposes:

1. **Spectator Experience** — Watch 10+ AI agents fight in a 3D world. This is what judges see.
2. **Lobby / Onboarding** — Landing page explaining the game, showing live match status, and linking to the SDK docs.

The frontend is **read-only** — no human plays. It connects to the game server via Socket.io and renders the world state in React Three Fiber.

---

## 2. Project Setup

### 2.1 Initialize Next.js

```bash
cd agent-royale
npx -y create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --no-import-alias
cd frontend
```

### 2.2 Install 3D Dependencies

```bash
npm install three @react-three/fiber @react-three/drei @react-three/postprocessing
npm install socket.io-client
npm install leva  # Debug controls (optional, nice for demo tweaking)
npm install -D @types/three
```

### 2.3 Directory Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── page.tsx                # Landing / lobby page
│   │   ├── game/
│   │   │   └── page.tsx            # Full spectator 3D view
│   │   ├── join/
│   │   │   └── page.tsx            # Onboarding guide for external players
│   │   └── layout.tsx              # Root layout with metadata
│   ├── components/
│   │   ├── game/
│   │   │   ├── GameCanvas.tsx      # R3F <Canvas> wrapper with config
│   │   │   ├── Scene.tsx           # Lighting, environment, fog
│   │   │   ├── Ground.tsx          # 50×50 grid plane
│   │   │   ├── PlayerModel.tsx     # Individual agent 3D model + label + HP bar
│   │   │   ├── Players.tsx         # Renders all players with interpolation
│   │   │   ├── Resources.tsx       # InstancedMesh for trees + rocks
│   │   │   ├── Structures.tsx      # Workbenches, barricades, loot crates
│   │   │   ├── Zone.tsx            # Red translucent shrinking cylinder
│   │   │   ├── ChatBubbles.tsx     # Floating HTML text above agents
│   │   │   ├── CameraController.tsx# Spectator camera (orbit + follow + god view)
│   │   │   └── Effects.tsx         # Post-processing (bloom, vignette)
│   │   ├── hud/
│   │   │   ├── HUD.tsx             # Main HUD container (overlay)
│   │   │   ├── Leaderboard.tsx     # Alive agents with HP bars
│   │   │   ├── KillFeed.tsx        # Recent kills (FPS style, top-right)
│   │   │   ├── Timer.tsx           # Game clock + alive count
│   │   │   ├── MiniMap.tsx         # Top-down 2D minimap
│   │   │   └── GameOverScreen.tsx  # Winner announcement + payout info
│   │   └── lobby/
│   │       ├── LobbyView.tsx       # Pre-game lobby display
│   │       └── StatusBar.tsx       # Connection status
│   ├── hooks/
│   │   ├── useGameSocket.ts        # Socket.io connection management
│   │   ├── useGameState.ts         # React state from socket events
│   │   └── useInterpolation.ts     # Smooth position lerping
│   ├── lib/
│   │   ├── socket.ts               # Socket.io client singleton
│   │   ├── constants.ts            # Shared constants (grid size, etc.)
│   │   └── types.ts                # TypeScript type definitions
│   └── styles/
│       └── globals.css             # Global styles
├── public/
│   └── models/                     # Kenney .glb files (copied here)
│       ├── tree.glb
│       ├── tree-pine.glb
│       ├── rock-a.glb
│       ├── rock-b.glb
│       ├── chest.glb
│       ├── barrel.glb
│       ├── workbench.glb
│       ├── character.glb           # Generic humanoid for agents
│       ├── tool-axe.glb
│       ├── tool-pickaxe.glb
│       └── tool-hammer.glb
└── next.config.ts
```

---

## 3. TypeScript Types (`src/lib/types.ts`)

```typescript
export interface PlayerState {
  id: string;
  display_name: string;
  position: [number, number];
  hp: number;
  alive: boolean;
  kills: number;
  holding: string | null;  // weapon name or null
}

export interface EntityState {
  id: string;
  type: 'RESOURCE' | 'WORKBENCH' | 'BARRICADE' | 'LOOT';
  subtype?: string;
  position: [number, number];
  hp?: number;
}

export interface ZoneState {
  center: [number, number];
  radius: number;
  next_shrink_tick: number | null;
  next_radius: number | null;
  damage_per_tick_outside: number;
}

export interface KillEvent {
  tick: number;
  victim_id: string;
  victim_name: string;
  killer_id: string | null;
  killer_name: string | null;
  cause: 'combat' | 'zone' | 'wolves';
  position: [number, number];
}

export interface ChatEvent {
  from: string;
  from_name: string;
  text: string;
  position: [number, number];
  tick: number;
}

export interface GameTick {
  game_id: string;
  tick: number;
  game_state: 'LOBBY_OPEN' | 'GAME_ACTIVE' | 'GAME_OVER';
  players: PlayerState[];
  entities: EntityState[];
  zone: ZoneState;
  alive_count: number;
  kill_log: KillEvent[];
  chat_log: ChatEvent[];
}

export interface GameOverData {
  winner: {
    id: string;
    display_name: string;
    wallet_address: string;
    hp: number;
    kills: number;
  } | null;
  total_ticks: number;
  kill_log: KillEvent[];
  pool_display: string;
  payout_tx_hash: string | null;
  payout_explorer_url: string | null;
}

// Interpolated player for rendering (3D position)
export interface InterpolatedPlayer extends PlayerState {
  prevPosition: [number, number];
  renderX: number;
  renderZ: number;
  interpolationT: number;
}
```

---

## 4. Constants (`src/lib/constants.ts`)

```typescript
export const GRID_SIZE = 50;
export const TILE_SIZE = 1;  // 1 world unit per tile
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
export const SOCKET_NAMESPACE = '/game';
export const TICK_RATE_MS = 1000;

// 3D World mapping: grid [x,y] → 3D [x, 0, z]
// Grid origin [0,0] = world position [0, 0, 0]
// Grid [49,49] = world position [49, 0, 49]
export function gridTo3D(gridPos: [number, number]): [number, number, number] {
  return [gridPos[0] * TILE_SIZE, 0, gridPos[1] * TILE_SIZE];
}

// Camera presets
export const CAMERA_GOD_VIEW = {
  position: [25, 45, 40] as [number, number, number],
  target: [25, 0, 25] as [number, number, number],
};

export const CAMERA_CLOSE = {
  distance: 10,
  height: 8,
};

// Colors
export const COLORS = {
  ground: '#2d5a27',  // Dark green grass
  zone: '#ff000033',  // Semi-transparent red
  zoneEdge: '#ff0000',
  gridLine: '#1a3d15',
  playerAlive: '#00ff88',
  playerDead: '#ff4444',
  tree: '#228b22',
  rock: '#808080',
  workbench: '#8b4513',
};
```

---

## 5. Socket.io Client (`src/lib/socket.ts`)

```typescript
import { io, Socket } from 'socket.io-client';
import { SERVER_URL, SOCKET_NAMESPACE } from './constants';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${SERVER_URL}${SOCKET_NAMESPACE}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });
    
    socket.on('connect', () => {
      console.log('[Socket] Connected to game server');
    });
    
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Disconnected: ${reason}`);
    });
    
    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
```

---

## 6. Game State Hook (`src/hooks/useGameState.ts`)

The central state management hook. Receives Socket.io events and maintains React state.

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket, disconnectSocket } from '@/lib/socket';
import type {
  GameTick, PlayerState, EntityState, ZoneState,
  KillEvent, ChatEvent, GameOverData, InterpolatedPlayer
} from '@/lib/types';

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
  
  // Previous positions for interpolation
  const prevPositions = useRef<Map<string, [number, number]>>(new Map());
  const lastTickTime = useRef<number>(Date.now());

  useEffect(() => {
    const socket = getSocket();
    
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    
    // Initial sync
    socket.on('sync', (data: GameTick) => {
      handleTick(data);
    });
    
    // Per-tick updates
    socket.on('tick', (data: GameTick) => {
      handleTick(data);
    });
    
    // Kill events
    socket.on('kill', (event: KillEvent) => {
      setKillFeed(prev => [event, ...prev].slice(0, 10));
    });
    
    // Chat events
    socket.on('chat', (event: ChatEvent) => {
      setChatLog(prev => [event, ...prev].slice(0, 20));
    });
    
    // Zone shrink
    socket.on('zone_shrink', (data: { new_radius: number; center: [number, number] }) => {
      setZone(prev => prev ? { ...prev, radius: data.new_radius } : null);
    });
    
    // Game over
    socket.on('game_over', (data: GameOverData) => {
      setGameOver(data);
      setGameState('GAME_OVER');
    });
    
    // Game start
    socket.on('game_start', () => {
      setGameOver(null);
      setGameState('GAME_ACTIVE');
    });
    
    return () => {
      disconnectSocket();
    };
  }, []);

  const handleTick = useCallback((data: GameTick) => {
    // Store previous positions for interpolation
    const newPrevPositions = new Map<string, [number, number]>();
    for (const player of rawPlayers) {
      newPrevPositions.set(player.id, player.position);
    }
    prevPositions.current = newPrevPositions;
    lastTickTime.current = Date.now();
    
    setTick(data.tick);
    setGameState(data.game_state);
    setRawPlayers(data.players);
    setEntities(data.entities);
    setZone(data.zone);
    setAliveCount(data.alive_count);
    
    if (data.kill_log) {
      setKillFeed(data.kill_log.slice(-10).reverse());
    }
    if (data.chat_log) {
      setChatLog(data.chat_log.slice(-20).reverse());
    }
  }, [rawPlayers]);

  // Create interpolated players
  const players: InterpolatedPlayer[] = rawPlayers.map(p => {
    const prev = prevPositions.current.get(p.id) || p.position;
    return {
      ...p,
      prevPosition: prev,
      renderX: p.position[0],
      renderZ: p.position[1],
      interpolationT: 0,
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
  };
}
```

---

## 7. Interpolation Hook (`src/hooks/useInterpolation.ts`)

Smoothly animates positions between 1-second ticks at 60fps.

```typescript
'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Lerp a mesh position from previous to current grid position.
 * Call this inside R3F components.
 * 
 * @param meshRef - ref to the Three.js object
 * @param currentPos - current server position [x, y]
 * @param previousPos - previous server position [x, y]
 * @param tickTimeRef - ref to timestamp of last tick
 * @param tickRateMs - milliseconds between ticks (1000)
 */
export function useInterpolation(
  meshRef: React.RefObject<THREE.Object3D>,
  currentPos: [number, number],
  previousPos: [number, number],
  tickTimeRef: React.MutableRefObject<number>,
  tickRateMs: number = 1000
) {
  useFrame(() => {
    if (!meshRef.current) return;
    
    const elapsed = Date.now() - tickTimeRef.current;
    const t = Math.min(elapsed / tickRateMs, 1); // 0 → 1 over tickRateMs
    
    // Smooth step for nicer easing
    const smooth = t * t * (3 - 2 * t); // smoothstep
    
    const x = THREE.MathUtils.lerp(previousPos[0], currentPos[0], smooth);
    const z = THREE.MathUtils.lerp(previousPos[1], currentPos[1], smooth);
    
    meshRef.current.position.x = x;
    meshRef.current.position.z = z;
  });
}

/**
 * Simple standalone lerp for a Vector3.
 */
export function lerpPosition(
  from: [number, number],
  to: [number, number],
  t: number
): [number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
}
```

---

## 8. Core 3D Components

### 8.1 Game Canvas (`src/components/game/GameCanvas.tsx`)

```tsx
'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import Scene from './Scene';
import Ground from './Ground';
import Players from './Players';
import Resources from './Resources';
import Structures from './Structures';
import Zone from './Zone';
import ChatBubbles from './ChatBubbles';
import CameraController from './CameraController';
import Effects from './Effects';
import type { GameStateHook } from '@/hooks/useGameState';

interface Props {
  state: GameStateHook;
}

export default function GameCanvas({ state }: Props) {
  return (
    <Canvas
      camera={{ position: [25, 45, 40], fov: 50 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ width: '100vw', height: '100vh' }}
    >
      <Suspense fallback={null}>
        <Scene />
        <Ground />
        <Players
          players={state.players}
          followId={state.followPlayer}
        />
        <Resources entities={state.entities.filter(e => e.type === 'RESOURCE')} />
        <Structures entities={state.entities.filter(e => ['WORKBENCH', 'BARRICADE', 'LOOT'].includes(e.type))} />
        {state.zone && <Zone zone={state.zone} />}
        <ChatBubbles chatLog={state.chatLog} players={state.players} />
        <CameraController
          followId={state.followPlayer}
          players={state.players}
        />
        <Effects />
      </Suspense>
    </Canvas>
  );
}
```

### 8.2 Scene (`src/components/game/Scene.tsx`)

```tsx
'use client';

import { Environment } from '@react-three/drei';

export default function Scene() {
  return (
    <>
      {/* Ambient light for base illumination */}
      <ambientLight intensity={0.4} />
      
      {/* Main directional light (sun) */}
      <directionalLight
        position={[30, 50, 30]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      
      {/* Fill light */}
      <directionalLight position={[-20, 30, -20]} intensity={0.3} />
      
      {/* Sky */}
      <color attach="background" args={['#87CEEB']} />
      <fog attach="fog" args={['#87CEEB', 60, 100]} />
    </>
  );
}
```

### 8.3 Ground (`src/components/game/Ground.tsx`)

```tsx
'use client';

import { useMemo } from 'react';
import { GRID_SIZE, TILE_SIZE, COLORS } from '@/lib/constants';
import * as THREE from 'three';

export default function Ground() {
  // Create a grid texture procedurally
  const gridTexture = useMemo(() => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Fill with grass green
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, size, size);
    
    // Draw grid lines
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    const cellSize = size / GRID_SIZE;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * cellSize;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(size, pos);
      ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[GRID_SIZE / 2 - 0.5, -0.01, GRID_SIZE / 2 - 0.5]} receiveShadow>
      <planeGeometry args={[GRID_SIZE * TILE_SIZE, GRID_SIZE * TILE_SIZE]} />
      <meshStandardMaterial map={gridTexture} />
    </mesh>
  );
}
```

### 8.4 Players (`src/components/game/Players.tsx`)

```tsx
'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { InterpolatedPlayer } from '@/lib/types';

interface Props {
  players: InterpolatedPlayer[];
  followId: string | null;
}

export default function Players({ players, followId }: Props) {
  return (
    <group>
      {players.filter(p => p.alive).map(player => (
        <PlayerMesh key={player.id} player={player} isFollowed={player.id === followId} />
      ))}
    </group>
  );
}

function PlayerMesh({ player, isFollowed }: { player: InterpolatedPlayer; isFollowed: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const prevPos = useRef<[number, number]>(player.position);
  const lastTickTime = useRef(Date.now());
  
  // Detect position change (new tick)
  const posChanged = player.position[0] !== prevPos.current[0] || player.position[1] !== prevPos.current[1];
  if (posChanged) {
    prevPos.current = player.prevPosition;
    lastTickTime.current = Date.now();
  }
  
  // Smoothly interpolate position each frame
  useFrame(() => {
    if (!groupRef.current) return;
    
    const elapsed = Date.now() - lastTickTime.current;
    const t = Math.min(elapsed / 1000, 1);
    const smooth = t * t * (3 - 2 * t); // smoothstep
    
    const x = THREE.MathUtils.lerp(prevPos.current[0], player.position[0], smooth);
    const z = THREE.MathUtils.lerp(prevPos.current[1], player.position[1], smooth);
    
    groupRef.current.position.set(x, 0, z);
  });
  
  // Color based on HP
  const hpRatio = player.hp / 100;
  const color = useMemo(() => {
    return new THREE.Color().setHSL(hpRatio * 0.35, 1, 0.5); // Green to red
  }, [hpRatio]);

  return (
    <group ref={groupRef} position={[player.position[0], 0, player.position[1]]}>
      {/* Body — simple capsule */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.6, 8, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      
      {/* Head */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#ffd4a3" />
      </mesh>
      
      {/* Highlight ring for followed player */}
      {isFollowed && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[0.5, 0.6, 32]} />
          <meshBasicMaterial color="#00ffff" transparent opacity={0.8} />
        </mesh>
      )}
      
      {/* Name label + HP bar (HTML overlay) */}
      <Html position={[0, 1.8, 0]} center distanceFactor={15}>
        <div style={{
          background: 'rgba(0,0,0,0.7)',
          borderRadius: '4px',
          padding: '2px 6px',
          color: 'white',
          fontSize: '11px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          userSelect: 'none',
        }}>
          <div style={{ fontWeight: 'bold' }}>{player.display_name}</div>
          <div style={{
            width: '50px',
            height: '3px',
            background: '#333',
            borderRadius: '2px',
            marginTop: '2px',
          }}>
            <div style={{
              width: `${player.hp}%`,
              height: '100%',
              background: hpRatio > 0.5 ? '#00ff88' : hpRatio > 0.25 ? '#ffaa00' : '#ff4444',
              borderRadius: '2px',
              transition: 'width 0.3s',
            }} />
          </div>
          {player.holding && (
            <div style={{ fontSize: '9px', color: '#aaa', marginTop: '1px' }}>
              🗡️ {player.holding}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}
```

### 8.5 Resources — InstancedMesh (`src/components/game/Resources.tsx`)

```tsx
'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { EntityState } from '@/lib/types';

interface Props {
  entities: EntityState[];
}

export default function Resources({ entities }: Props) {
  const trees = entities.filter(e => e.subtype === 'tree' || e.subtype === 'tree-pine');
  const rocks = entities.filter(e => e.subtype === 'rock-a' || e.subtype === 'rock-b');

  return (
    <>
      <InstancedTrees trees={trees} />
      <InstancedRocks rocks={rocks} />
    </>
  );
}

function InstancedTrees({ trees }: { trees: EntityState[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    trees.forEach((tree, i) => {
      dummy.position.set(tree.position[0], 0, tree.position[1]);
      // Random rotation for variety
      dummy.rotation.y = tree.position[0] * 1.5;
      dummy.scale.set(0.8 + (tree.position[1] % 3) * 0.1, 0.8 + (tree.position[0] % 4) * 0.15, 0.8);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [trees, dummy]);

  if (trees.length === 0) return null;

  return (
    <group>
      {/* Trunk */}
      <instancedMesh ref={meshRef} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 0.8, 8]} />
        <meshStandardMaterial color="#6b3a1f" />
      </instancedMesh>
      {/* Simple foliage spheres as separate instances */}
      {trees.map((tree, i) => (
        <mesh key={tree.id} position={[tree.position[0], 1.2, tree.position[1]]} castShadow>
          <sphereGeometry args={[0.5, 8, 8]} />
          <meshStandardMaterial color={i % 2 === 0 ? '#228b22' : '#2d7d2d'} />
        </mesh>
      ))}
    </group>
  );
}

function InstancedRocks({ rocks }: { rocks: EntityState[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    rocks.forEach((rock, i) => {
      dummy.position.set(rock.position[0], 0.2, rock.position[1]);
      dummy.rotation.y = rock.position[0] * 2.3;
      const scale = 0.3 + (rock.position[1] % 3) * 0.1;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [rocks, dummy]);

  if (rocks.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, rocks.length]} castShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#808080" roughness={0.9} />
    </instancedMesh>
  );
}
```

### 8.6 Zone (`src/components/game/Zone.tsx`)

```tsx
'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ZoneState } from '@/lib/types';

interface Props {
  zone: ZoneState;
}

export default function Zone({ zone }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const targetRadius = useRef(zone.radius);
  
  // Smoothly animate zone shrinking
  targetRadius.current = zone.radius;
  
  useFrame(() => {
    if (!meshRef.current) return;
    const currentScale = meshRef.current.scale.x;
    const targetScale = targetRadius.current;
    const newScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.05);
    meshRef.current.scale.set(newScale, 1, newScale);
  });

  return (
    <group position={[zone.center[0], 0, zone.center[1]]}>
      {/* Danger zone — everything OUTSIDE this cylinder is red */}
      {/* We render the zone edge as a ring */}
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[0.98, 1, 64]} />
        <meshBasicMaterial color="#ff0000" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Vertical wall effect */}
      <mesh scale={[zone.radius, 1, zone.radius]} position={[0, 5, 0]}>
        <cylinderGeometry args={[1, 1, 10, 64, 1, true]} />
        <meshBasicMaterial color="#ff0000" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
```

### 8.7 Chat Bubbles (`src/components/game/ChatBubbles.tsx`)

```tsx
'use client';

import { Html } from '@react-three/drei';
import { useState, useEffect } from 'react';
import type { ChatEvent, InterpolatedPlayer } from '@/lib/types';

interface Props {
  chatLog: ChatEvent[];
  players: InterpolatedPlayer[];
}

export default function ChatBubbles({ chatLog, players }: Props) {
  // Show only recent messages (last 5 seconds worth)
  const [visibleMessages, setVisibleMessages] = useState<(ChatEvent & { expiresAt: number })[]>([]);
  
  useEffect(() => {
    const now = Date.now();
    const newMessages = chatLog
      .slice(0, 5) // Latest 5
      .map(m => ({ ...m, expiresAt: now + 5000 }));
    
    setVisibleMessages(prev => {
      const fresh = prev.filter(m => m.expiresAt > now);
      // Merge, dedupe by from+tick
      const seen = new Set(fresh.map(m => `${m.from}-${m.tick}`));
      const added = newMessages.filter(m => !seen.has(`${m.from}-${m.tick}`));
      return [...added, ...fresh].slice(0, 10);
    });
  }, [chatLog]);
  
  // Auto-cleanup
  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleMessages(prev => prev.filter(m => m.expiresAt > Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <group>
      {visibleMessages.map((msg, i) => {
        const player = players.find(p => p.id === msg.from);
        if (!player) return null;
        
        return (
          <Html
            key={`${msg.from}-${msg.tick}`}
            position={[player.position[0], 2.2 + i * 0.3, player.position[1]]}
            center
            distanceFactor={20}
          >
            <div style={{
              background: 'rgba(0, 0, 0, 0.8)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              padding: '4px 8px',
              maxWidth: '200px',
              color: 'white',
              fontSize: '10px',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              opacity: Math.max(0, (msg.expiresAt - Date.now()) / 5000), // Fade out
            }}>
              <strong style={{ color: '#00ff88' }}>{player.display_name}:</strong>{' '}
              {msg.text}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
```

### 8.8 Camera Controller (`src/components/game/CameraController.tsx`)

```tsx
'use client';

import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { InterpolatedPlayer } from '@/lib/types';
import { CAMERA_GOD_VIEW } from '@/lib/constants';

interface Props {
  followId: string | null;
  players: InterpolatedPlayer[];
}

export default function CameraController({ followId, players }: Props) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  
  // Follow a specific player
  useFrame(() => {
    if (!followId || !controlsRef.current) return;
    
    const player = players.find(p => p.id === followId && p.alive);
    if (!player) return;
    
    // Smoothly move camera target to player position
    const target = controlsRef.current.target;
    target.x = THREE.MathUtils.lerp(target.x, player.position[0], 0.05);
    target.z = THREE.MathUtils.lerp(target.z, player.position[1], 0.05);
    target.y = 0;
    
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={[CAMERA_GOD_VIEW.target[0], CAMERA_GOD_VIEW.target[1], CAMERA_GOD_VIEW.target[2]]}
      maxPolarAngle={Math.PI / 2.2} // Don't go below ground
      minDistance={5}
      maxDistance={80}
      enableDamping
      dampingFactor={0.05}
    />
  );
}
```

---

## 9. HUD Components

### 9.1 HUD Container (`src/components/hud/HUD.tsx`)

```tsx
'use client';

import Leaderboard from './Leaderboard';
import KillFeed from './KillFeed';
import Timer from './Timer';
import MiniMap from './MiniMap';
import GameOverScreen from './GameOverScreen';
import type { GameStateHook } from '@/hooks/useGameState';

interface Props {
  state: GameStateHook;
}

export default function HUD({ state }: Props) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 10,
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Top Center: Timer + Alive Count */}
      <Timer tick={state.tick} aliveCount={state.aliveCount} gameState={state.gameState} />
      
      {/* Top Right: Kill Feed */}
      <KillFeed kills={state.killFeed} />
      
      {/* Left: Leaderboard */}
      <Leaderboard
        players={state.players}
        onPlayerClick={(id) => {
          (state as any).setFollowPlayer(
            state.followPlayer === id ? null : id
          );
        }}
        followId={state.followPlayer}
      />
      
      {/* Bottom Right: MiniMap */}
      <MiniMap
        players={state.players}
        zone={state.zone}
      />
      
      {/* Game Over Overlay */}
      {state.gameOver && <GameOverScreen data={state.gameOver} />}
    </div>
  );
}
```

### 9.2 Leaderboard (`src/components/hud/Leaderboard.tsx`)

```tsx
'use client';

import type { InterpolatedPlayer } from '@/lib/types';

interface Props {
  players: InterpolatedPlayer[];
  onPlayerClick: (id: string) => void;
  followId: string | null;
}

export default function Leaderboard({ players, onPlayerClick, followId }: Props) {
  const sorted = [...players]
    .sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.kills !== b.kills) return b.kills - a.kills;
      return b.hp - a.hp;
    });

  return (
    <div style={{
      position: 'absolute',
      top: '60px',
      left: '16px',
      background: 'rgba(0,0,0,0.7)',
      borderRadius: '8px',
      padding: '12px',
      color: 'white',
      fontSize: '12px',
      fontFamily: 'monospace',
      minWidth: '180px',
      pointerEvents: 'auto',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
        ⚔️ PLAYERS
      </div>
      {sorted.map(p => (
        <div
          key={p.id}
          onClick={() => onPlayerClick(p.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 4px',
            borderRadius: '4px',
            cursor: 'pointer',
            opacity: p.alive ? 1 : 0.4,
            textDecoration: p.alive ? 'none' : 'line-through',
            background: p.id === followId ? 'rgba(0,255,255,0.15)' : 'transparent',
          }}
        >
          <span style={{ color: p.alive ? '#00ff88' : '#ff4444' }}>●</span>
          <span style={{ flex: 1 }}>{p.display_name}</span>
          <span style={{ color: '#888' }}>{p.kills}K</span>
          <div style={{
            width: '30px',
            height: '4px',
            background: '#333',
            borderRadius: '2px',
          }}>
            <div style={{
              width: `${p.hp}%`,
              height: '100%',
              background: p.hp > 50 ? '#00ff88' : p.hp > 25 ? '#ffaa00' : '#ff4444',
              borderRadius: '2px',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 9.3 Kill Feed (`src/components/hud/KillFeed.tsx`)

```tsx
'use client';

import type { KillEvent } from '@/lib/types';

interface Props {
  kills: KillEvent[];
}

const CAUSE_ICONS: Record<string, string> = {
  combat: '⚔️',
  zone: '☠️',
  wolves: '🐺',
};

export default function KillFeed({ kills }: Props) {
  return (
    <div style={{
      position: 'absolute',
      top: '60px',
      right: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      fontFamily: 'monospace',
      fontSize: '11px',
    }}>
      {kills.map((k, i) => (
        <div key={`${k.victim_id}-${k.tick}`} style={{
          background: 'rgba(0,0,0,0.6)',
          borderRadius: '4px',
          padding: '4px 8px',
          color: 'white',
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
          opacity: 1 - i * 0.1,
          backdropFilter: 'blur(2px)',
        }}>
          {k.killer_name && (
            <>
              <span style={{ color: '#ff8888' }}>{k.killer_name}</span>
              <span>{CAUSE_ICONS[k.cause] || '→'}</span>
            </>
          )}
          {!k.killer_name && (
            <span>{CAUSE_ICONS[k.cause] || '💀'}</span>
          )}
          <span style={{ color: '#aaa' }}>{k.victim_name}</span>
        </div>
      ))}
    </div>
  );
}
```

### 9.4 Timer (`src/components/hud/Timer.tsx`)

```tsx
'use client';

interface Props {
  tick: number;
  aliveCount: number;
  gameState: string;
}

export default function Timer({ tick, aliveCount, gameState }: Props) {
  const minutes = Math.floor(tick / 60);
  const seconds = tick % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div style={{
      position: 'absolute',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      background: 'rgba(0,0,0,0.7)',
      borderRadius: '8px',
      padding: '8px 20px',
      color: 'white',
      fontFamily: 'monospace',
      fontSize: '16px',
      backdropFilter: 'blur(4px)',
    }}>
      <span>⏱️ {timeStr}</span>
      <span style={{ color: '#888' }}>|</span>
      <span>👥 {aliveCount} alive</span>
      <span style={{ color: '#888' }}>|</span>
      <span style={{
        color: gameState === 'GAME_ACTIVE' ? '#00ff88' : gameState === 'LOBBY_OPEN' ? '#ffaa00' : '#ff4444',
        fontSize: '11px',
        textTransform: 'uppercase',
      }}>
        {gameState.replace('_', ' ')}
      </span>
    </div>
  );
}
```

### 9.5 MiniMap (`src/components/hud/MiniMap.tsx`)

```tsx
'use client';

import { useRef, useEffect } from 'react';
import type { InterpolatedPlayer, ZoneState } from '@/lib/types';
import { GRID_SIZE } from '@/lib/constants';

interface Props {
  players: InterpolatedPlayer[];
  zone: ZoneState | null;
}

const MINIMAP_SIZE = 160;

export default function MiniMap({ players, zone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const scale = MINIMAP_SIZE / GRID_SIZE;
    
    // Clear
    ctx.fillStyle = '#1a3d15';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    
    // Draw zone
    if (zone) {
      ctx.beginPath();
      ctx.arc(
        zone.center[0] * scale,
        zone.center[1] * scale,
        zone.radius * scale,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = '#ff000088';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Fill outside zone with red
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      ctx.arc(zone.center[0] * scale, zone.center[1] * scale, zone.radius * scale, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fill();
      ctx.restore();
    }
    
    // Draw players
    for (const p of players) {
      ctx.beginPath();
      ctx.arc(
        p.position[0] * scale,
        p.position[1] * scale,
        3,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = p.alive ? '#00ff88' : '#ff4444';
      ctx.fill();
    }
  }, [players, zone]);

  return (
    <div style={{
      position: 'absolute',
      bottom: '16px',
      right: '16px',
      pointerEvents: 'auto',
    }}>
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        style={{
          border: '2px solid rgba(255,255,255,0.2)',
          borderRadius: '8px',
          background: 'rgba(0,0,0,0.5)',
        }}
      />
    </div>
  );
}
```

### 9.6 Game Over Screen (`src/components/hud/GameOverScreen.tsx`)

```tsx
'use client';

import type { GameOverData } from '@/lib/types';

interface Props {
  data: GameOverData;
}

export default function GameOverScreen({ data }: Props) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      pointerEvents: 'auto',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: 'rgba(0,0,0,0.9)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        padding: '40px',
        textAlign: 'center',
        color: 'white',
        fontFamily: "'Inter', sans-serif",
        maxWidth: '400px',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '8px' }}>🏆</div>
        <h1 style={{ fontSize: '28px', margin: '0 0 4px' }}>VICTORY</h1>
        
        {data.winner && (
          <>
            <p style={{ color: '#00ff88', fontSize: '20px', fontWeight: 'bold' }}>
              {data.winner.display_name}
            </p>
            <p style={{ color: '#888', fontSize: '13px', fontFamily: 'monospace' }}>
              {data.winner.wallet_address.slice(0, 6)}...{data.winner.wallet_address.slice(-4)}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', margin: '16px 0', fontSize: '14px' }}>
              <div>
                <div style={{ color: '#888' }}>HP</div>
                <div style={{ fontWeight: 'bold' }}>{data.winner.hp}</div>
              </div>
              <div>
                <div style={{ color: '#888' }}>Kills</div>
                <div style={{ fontWeight: 'bold' }}>{data.winner.kills}</div>
              </div>
              <div>
                <div style={{ color: '#888' }}>Ticks</div>
                <div style={{ fontWeight: 'bold' }}>{data.total_ticks}</div>
              </div>
            </div>
          </>
        )}
        
        {data.pool_display && (
          <p style={{ color: '#ffaa00', fontSize: '16px', margin: '12px 0' }}>
            💰 Pool: {data.pool_display}
          </p>
        )}
        
        {data.payout_explorer_url && (
          <a
            href={data.payout_explorer_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: '12px',
              padding: '8px 16px',
              background: '#7c3aed',
              color: 'white',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '13px',
            }}
          >
            View Payout on Explorer ↗
          </a>
        )}
        
        <p style={{ color: '#666', fontSize: '12px', marginTop: '20px' }}>
          Next game starts in 30 seconds...
        </p>
      </div>
    </div>
  );
}
```

---

## 10. Main Game Page (`src/app/game/page.tsx`)

```tsx
'use client';

import GameCanvas from '@/components/game/GameCanvas';
import HUD from '@/components/hud/HUD';
import { useGameState } from '@/hooks/useGameState';

export default function GamePage() {
  const state = useGameState();

  if (!state.connected) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: 'white',
        fontFamily: 'monospace',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
          <p>Connecting to game server...</p>
          <p style={{ color: '#888', fontSize: '12px' }}>
            Make sure the server is running on port 3001
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GameCanvas state={state} />
      <HUD state={state} />
    </div>
  );
}
```

---

## 11. Kenney Asset Integration

### 11.1 Downloading Assets

1. Download from https://kenney.nl/assets/survival-kit
2. Extract the `.glb` files from the `Models/GLB/` folder
3. Copy the relevant files to `frontend/public/models/`

### 11.2 Using GLB Models (Alternative to Primitives)

If you want to use the actual Kenney models instead of the primitive geometries shown above, replace the primitives with `useGLTF`:

```tsx
import { useGLTF } from '@react-three/drei';

function TreeModel({ position }: { position: [number, number, number] }) {
  const { scene } = useGLTF('/models/tree.glb');
  return <primitive object={scene.clone()} position={position} scale={0.5} />;
}

// Preload all models
useGLTF.preload('/models/tree.glb');
useGLTF.preload('/models/rock-a.glb');
// etc.
```

> **Note:** For the hackathon, using simple primitives (capsules, spheres, cubes) is perfectly fine and renders faster. The Kenney GLBs can be swapped in as a polish step.

---

## 12. Environment Variables

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_SERVER_URL=http://localhost:3001
```

---

## 13. Testing Plan

### 13.1 Visual Testing

1. Start the game server: `cd server && npm run dev`
2. Start the frontend: `cd frontend && npm run dev`
3. Open `http://localhost:3000/game`
4. Verify: Canvas renders, ground visible, camera controls work
5. Join 3+ agents via SDK or curl
6. Verify: Player models appear, interpolation smooth, names visible
7. Wait for zone shrink → Verify red ring shrinks
8. Kill an agent → Verify kill feed appears
9. Game over → Verify game over screen with winner info

### 13.2 Performance

- Target: 30+ FPS with 20 players + 80 entities
- Use R3F's built-in `<Stats />` component from drei for FPS counter
- InstancedMesh for trees/rocks is critical for performance

---

## 14. Definition of Done

- [ ] Next.js app runs on port 3000
- [ ] Connects to game server via Socket.io on port 3001
- [ ] 3D scene renders: ground grid, lighting, sky, fog
- [ ] Players render as capsule models with name labels + HP bars
- [ ] Position interpolation makes movement smooth between 1s ticks
- [ ] Trees and rocks render via InstancedMesh
- [ ] Zone renders as red translucent ring/cylinder, shrinks smoothly
- [ ] Chat bubbles float above agents, auto-fade after 5s
- [ ] Camera: orbit controls + click-to-follow individual players
- [ ] HUD: leaderboard (left), kill feed (right), timer (top), minimap (bottom-right)
- [ ] Game over screen shows winner, kills, HP, pool, payout explorer link
- [ ] 30+ FPS with 20 players
