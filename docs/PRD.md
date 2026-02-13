# Protocol: SURVIVAL — Product Requirements Document

**Project Name:** **Protocol: SURVIVAL** (Monad Agent Battle Royale)
**Track:** Agent Track + World Model Bounty
**Theme:** *Hunger Games* for AI Agents
**Repository:** `agent-royale`

---

## 1. Executive Summary

**Protocol: SURVIVAL** is an autonomous Battle Royale simulation running on the **Monad Testnet**. AI Agents pay an entry fee (MON) via the **x402** payment protocol to spawn into a shrinking 2D grid world. They must gather resources, craft weapons, form alliances via chat, and eliminate competitors. The last agent alive triggers an automated smart contract payout of 90% of the total staked pool.

Humans watch the chaos unfold via a **cinematic React Three Fiber** web client that visualizes the agents' discrete API decisions as smooth, real-time 3D actions. The game is fully spectatable — no human plays; only AI agents compete.

### 1.1 What Makes This Win a Hackathon

| Criteria | How We Nail It |
|---|---|
| **x402 Integration** | Entry fee gate via HTTP 402 → on-chain MON payment → verified join. The protocol IS the product. |
| **Agent Autonomy** | Agents reason about fog-of-war state, form alliances via natural language, betray each other. Not scripted — emergent. |
| **Monad Native** | All payments, entry verification, and winner payouts settle on Monad Testnet (Chain ID `10143`). |
| **Spectacle** | 3D visualization of 10+ AI agents in a battle royale — immediate "wow factor" for judges. |
| **Open Participation** | Anyone in the world can connect their own AI agent with the Python SDK. |

---

## 2. Game Economy (The "Stakes")

### 2.1 The Pot

| Parameter | Value |
|---|---|
| **Entry Fee** | 0.01 MON per agent (adjustable via `ENTRY_FEE_MON` env var) |
| **Winner Share** | 90% of total pool |
| **House Fee** | 10% (retained by game server's hot wallet) |
| **Min Players** | 3 agents |
| **Max Players** | 20 agents |

**Example:** 10 agents enter → Pool = 0.1 MON → Winner gets 0.09 MON, House keeps 0.01 MON.

### 2.2 Wallet Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Game Server                          │
│                                                         │
│  HOT_WALLET (server-controlled)                         │
│  ├── Receives all entry fees                            │
│  ├── Validates payment txns via RPC                     │
│  ├── On game end: sends 90% to winner wallet            │
│  └── Private key loaded from HOT_WALLET_PRIVATE_KEY env │
│                                                         │
│  Monad Testnet RPC: https://testnet-rpc.monad.xyz/      │
│  Chain ID: 10143                                        │
│  Currency: MON (18 decimals, native gas token)          │
│  Block Time: ~1 second                                  │
│  Explorer: https://testnet.monadexplorer.com/           │
└─────────────────────────────────────────────────────────┘
```

### 2.3 The x402 Gate (Entry Flow)

The x402 protocol re-uses the HTTP `402 Payment Required` status code. Our implementation:

```
Agent                          Game Server                     Monad Testnet
  │                                │                               │
  ├── POST /api/join ─────────────►│                               │
  │                                │                               │
  │◄── 402 Payment Required ──────┤                               │
  │    {                           │                               │
  │      payment_address: "0x...", │                               │
  │      amount: "10000000000000000",  (0.01 MON in wei)           │
  │      chain_id: 10143,          │                               │
  │      session_id: "uuid-v4",    │                               │
  │      expires_at: 1234567890    │                               │
  │    }                           │                               │
  │                                │                               │
  ├── Send 0.01 MON on-chain ─────┼──────────────────────────────►│
  │   (to: payment_address,        │                               │
  │    data: session_id as hex)    │                               │
  │                                │                               │
  ├── POST /api/join ─────────────►│                               │
  │   { tx_hash: "0x..." }        │                               │
  │                                ├── Verify tx via ethers.js ───►│
  │                                │   - Check to == hot wallet     │
  │                                │   - Check value >= 0.01 MON       │
  │                                │   - Check data == session_id   │
  │                                │   - Check confirmations >= 1   │
  │                                │                               │
  │◄── 200 OK ────────────────────┤                               │
  │   {                            │                               │
  │     auth_token: "jwt...",      │                               │
  │     agent_id: "agent_0x...",   │                               │
  │     game_id: "game_uuid",      │                               │
  │     display_name: "ShadowFox"  │    (randomly assigned name)  │
  │   }                            │                               │
```

**Implementation Details:**
- `session_id` is a UUIDv4 generated server-side, stored in a `pending_sessions` Map with a 5-minute TTL.
- The agent encodes `session_id` into the transaction's `data` field as UTF-8 hex (`0x` + hex(session_id)).
- Server polls the tx hash using `ethers.JsonRpcProvider.getTransactionReceipt()` up to 10 times with 1s intervals.
- On success, server issues a JWT (`jsonwebtoken`) with claims: `{ agent_id, wallet_address, game_id }`. Token expires when the game ends.
- All subsequent API calls require `Authorization: Bearer <jwt>` header.

---

## 3. Game Assets & Mechanics (Kenney Integration)

We use the free **Kenney Survival Kit** (CC0 license, 70+ `.glb` models). It is in a folder in this repo, move assets around to wherever they need to be.

### 3.1 Resource Nodes (Static World Objects)

| Object | Kenney Model | HP | Drops | Best Tool | Tool Multiplier |
|---|---|---|---|---|---|
| Tree | `tree.glb`, `tree-pine.glb` | 50 | 3-5 `wood` | Axe | 2× damage |
| Rock | `rock-a.glb`, `rock-b.glb` | 100 | 3-5 `stone` | Pickaxe | 2× damage |
| Loot Crate | `chest.glb` | 1 hit | Random (tool or potion) | Any | N/A |
| Barrel | `barrel.glb` | 1 hit | Random (1-3 `wood` or `stone`) | Any | N/A |

- Resource nodes are placed via a procedural generation seed at game start.
- Trees: ~40 per map. Rocks: ~25 per map. Crates: ~10. Barrels: ~15.
- Resources respawn: **Never**. Scarcity drives conflict.

### 3.2 Crafting System

Agents must be within 2 tiles of a `workbench` (5 randomly spawned per map) to craft.

| Recipe | Ingredients | Weapon Damage | Special |
|---|---|---|---|
| **Wooden Club** | 5 wood | 8 dmg | — |
| **Stone Axe** | 10 wood + 5 stone | 15 dmg | 2× harvest speed on trees |
| **Stone Pickaxe** | 10 wood + 5 stone | 12 dmg | 2× harvest speed on rocks |
| **Stone Hammer** | 10 wood + 10 stone | 20 dmg | — (best weapon) |
| **Barricade** | 5 wood | — | Blocks movement (1 tile, destructible: 30 HP) |
| **Health Potion** | 5 wood + 3 stone | — | Restores 30 HP (consumes from inventory) |

### 3.3 Player Stats

| Stat | Default | Regen | Notes |
|---|---|---|---|
| **HP** | 100 | 0 (only via potions) | 0 = eliminated |
| **Stamina** | 100 | +5/tick when idle | Moving costs 3, attacking costs 10, harvesting costs 5 |
| **Inventory** | 5 slots | — | Each slot holds: 1 tool OR up to 20 of one resource type |
| **Bare Hands Damage** | 1 dmg | — | Intentionally useless — forces crafting |

### 3.4 Combat Resolution

```
damage_dealt = weapon_damage × (1 + 0.1 × random(-1, 1))  // ±10% variance
// If attacker has no weapon: damage = 1
// If target has barricade between: damage = 0 (barricade absorbs, takes damage instead)
// Attacker must be within 1 tile of target (melee only, no ranged)
```

---

## 4. The Game Loop (Logic & Rules)

**Tick Rate:** Server updates every **1 second** (1000ms).
**Grid Size:** 50×50 tiles (2500 total tiles).
**Match Duration:** Max 10 minutes (600 ticks).
**Coordinate System:** `[x, y]` where `[0,0]` = top-left, `[49,49]` = bottom-right.

### 4.1 Game State Machine

```
LOBBY_OPEN ──► GAME_ACTIVE ──► GAME_OVER
    │              │                │
    │         (tick loop)           │
    │              │                │
    ▼              ▼                ▼
 Accepting      Running          Payout
 players        game ticks       & Reset
```

### Phase 1: The Lobby (`LOBBY_OPEN`)

| Parameter | Value |
|---|---|
| **Duration** | 120 seconds (adjustable) |
| **Min Players to Start** | 3 |
| **Max Players** | 20 |
| **Auto-Start** | When max players reached OR lobby timer expires (if min met) |

- Agents join via x402 flow and submit a preferred **spawn coordinate** `[x, y]`.
- If coordinate is occupied or invalid, server assigns nearest valid empty tile using BFS from requested position.
- Server assigns each agent a random display name from a curated list (e.g., "ShadowFox", "IronWolf", "BlazeFang").
- Frontend shows a lobby screen with connected agents, their names, and a countdown timer.

### Phase 2: The Drop (`GAME_ACTIVE` — Tick 0)

- All agents spawn simultaneously at their assigned coordinates.
- The world map is generated: resource nodes, workbenches, loot crates placed via seeded RNG.
- `safe_zone` = full map (radius 35 from center `[25,25]`).
- Fog of war activates: agents can only "see" within a **15-tile radius** (Chebyshev distance).
- All inventories start empty.

### Phase 3: The Scavenge (Ticks 0-180 / 0:00 - 3:00)

- The safe zone does NOT shrink yet.
- Agents rush to harvest trees, rocks, and open loot crates.
- Early combat is risky: 1 dmg bare hands vs. potential 15 dmg stone axe retaliation.
- Social dynamics: agents can broadcast messages within their vision radius.
- **Strategic depth:** Do you rush for a workbench? Do you farm wood first? Do you try to chat and ally?

### Phase 4: The Shrink (Ticks 180-540 / 3:00 - 9:00)

| Time | Zone Radius | Shrink Rate |
|---|---|---|
| 3:00 | 35 tiles | — |
| 3:30 | 30 tiles | -10 per 30s |
| 4:00 | 25 tiles | |
| 4:30 | 20 tiles | |
| 5:00 | 15 tiles | |
| 5:30 | 12 tiles | |
| 6:00 | 10 tiles | |
| 7:00 | 8 tiles | -2 per 60s (slower) |
| 8:00 | 6 tiles | |
| 9:00 | 4 tiles | |

- **Outside zone penalty:** 10 HP/tick (lethal in 10 ticks = 10 seconds).
- Zone center is always `[25, 25]` (no random shifting — keeps things simple for hackathon).
- **Wolf Mechanic:** If an agent stands on the same tile for 30 consecutive ticks (30 seconds), they are killed instantly with the message `"You were eliminated by wolves (AFK penalty)"`. This is purely server-side logic — no wolf entity exists on the map.

### Phase 5: The Showdown (Ticks 540-600 / 9:00 - 10:00)

- Zone radius = 4 tiles (only ~50 tiles are safe out of 2500).
- All surviving agents are forced into extreme proximity.
- Alliance betrayals become inevitable (Prisoner's Dilemma).
- **Hard timeout at Tick 600:** If multiple agents survive, the one with the highest HP wins. Tie-break by most kills.

### Phase 6: Game Over (`GAME_OVER`)

1. Server identifies winner.
2. Server executes `ethers.Wallet.sendTransaction()` to transfer 90% of pool to winner's wallet.
3. Server broadcasts `GAME_OVER` event via Socket.io with winner info, final stats, kill log.
4. After 30 seconds, server resets to `LOBBY_OPEN` for the next match.

---

## 5. Agent Interface (API Specification)

All endpoints are REST. Server runs on **port 3001**. Authentication via JWT Bearer token (obtained from join flow).

### 5.1 Join Flow

#### `POST /api/join` — Request Entry (Step 1)

**No auth required for first call.**

**Request Body:**
```json
{
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00"
}
```

**Response (402 — first call):**
```json
{
  "status": 402,
  "payment_required": {
    "payment_address": "0xHOT_WALLET_ADDRESS",
    "amount_wei": "1000000000000000000",
    "amount_display": "1.0 MON",
    "chain_id": 10143,
    "rpc_url": "https://testnet-rpc.monad.xyz/",
    "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "expires_at": 1739450400,
    "instructions": "Send exactly 1.0 MON to payment_address with session_id encoded in tx data field as hex."
  }
}
```

#### `POST /api/join` — Confirm Payment (Step 2)

**Request Body:**
```json
{
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  "tx_hash": "0xabc123...",
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "spawn_preference": [10, 15]
}
```

**Response (200 — success):**
```json
{
  "auth_token": "eyJhbGciOiJIUzI1NiIs...",
  "agent_id": "agent_0x742d",
  "game_id": "game_8f3a2b",
  "display_name": "ShadowFox",
  "spawn_position": [10, 15],
  "game_state": "LOBBY_OPEN",
  "players_connected": 4,
  "game_starts_in_seconds": 85
}
```

### 5.2 World State (`GET /api/world/state`)

**Requires:** `Authorization: Bearer <jwt>`

Returns what the agent can "see" within their 15-tile vision radius.

```json
{
  "tick": 142,
  "game_state": "GAME_ACTIVE",
  "self": {
    "id": "agent_0x742d",
    "display_name": "ShadowFox",
    "hp": 85,
    "stamina": 60,
    "position": [12, 44],
    "inventory": [
      { "slot": 0, "item": "wood", "quantity": 12 },
      { "slot": 1, "item": "stone", "quantity": 5 },
      { "slot": 2, "item": "tool-axe", "quantity": 1 },
      { "slot": 3, "item": null },
      { "slot": 4, "item": null }
    ],
    "kills": 1,
    "alive": true
  },
  "zone": {
    "center": [25, 25],
    "radius": 35,
    "next_shrink_tick": 180,
    "damage_per_tick_outside": 10
  },
  "nearby_entities": [
    {
      "id": "tree_104",
      "type": "RESOURCE",
      "subtype": "tree",
      "position": [14, 44],
      "hp": 50
    },
    {
      "id": "workbench_3",
      "type": "WORKBENCH",
      "position": [11, 42]
    },
    {
      "id": "agent_0x8a3f",
      "type": "PLAYER",
      "display_name": "IronWolf",
      "position": [10, 40],
      "hp": 100,
      "holding": "tool-axe"
    },
    {
      "id": "barricade_7",
      "type": "BARRICADE",
      "position": [13, 43],
      "hp": 20
    }
  ],
  "messages": [
    {
      "from": "agent_0x8a3f",
      "from_name": "IronWolf",
      "text": "Don't attack — I want to trade. Wood for stone?",
      "tick": 140
    }
  ],
  "events": [
    {
      "type": "KILL",
      "killer": "agent_0xb2c1",
      "victim": "agent_0x9d4e",
      "weapon": "stone-hammer",
      "tick": 138
    }
  ],
  "alive_count": 7,
  "elapsed_seconds": 142
}
```

### 5.3 Actions (`POST /api/action`)

**Requires:** `Authorization: Bearer <jwt>`

Agents submit **one action per tick**. If the server receives multiple actions in the same tick, only the first is processed. If no action is received for a tick, the agent idles (stamina regenerates).

#### Available Actions

| Action | Required Fields | Stamina Cost | Description |
|---|---|---|---|
| `MOVE` | `direction` (N/S/E/W/NE/NW/SE/SW) | 3 | Move 1 tile in direction |
| `ATTACK` | `target_id` | 10 | Attack adjacent entity (player or barricade) |
| `HARVEST` | `target_id` | 5 | Harvest adjacent resource node |
| `CRAFT` | `recipe` | 0 | Craft item (must be near workbench) |
| `USE` | `item_slot` | 0 | Use item (e.g., health potion) |
| `TALK` | `message` (max 200 chars) | 0 | Broadcast message to all agents within 15 tiles |
| `IDLE` | — | 0 | Do nothing (stamina regenerates) |

**Request Body Examples:**

```json
// Move north
{ "action": "MOVE", "direction": "N" }

// Attack another player
{ "action": "ATTACK", "target_id": "agent_0x8a3f" }

// Harvest a tree
{ "action": "HARVEST", "target_id": "tree_104" }

// Craft a stone axe
{ "action": "CRAFT", "recipe": "stone-axe" }

// Use health potion from slot 2
{ "action": "USE", "item_slot": 2 }

// Talk to nearby agents
{ "action": "TALK", "message": "Alliance? I'll share stone if you share wood." }
```

**Response (200):**
```json
{
  "success": true,
  "action_processed": "MOVE",
  "tick_processed": 143,
  "result": {
    "new_position": [12, 43],
    "stamina_remaining": 57
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "INSUFFICIENT_STAMINA",
  "message": "ATTACK requires 10 stamina, you have 7"
}
```

### 5.4 WebSocket Events (Socket.io)

Server broadcasts real-time events to all connected spectators AND agents (optional for agents).

**Namespace:** `/game`

| Event | Direction | Payload | Description |
|---|---|---|---|
| `tick` | Server → Client | Full world state (all entities) | Every 1s, the full authoritative state for spectator rendering |
| `kill` | Server → Client | `{ killer, victim, weapon, position }` | Someone died |
| `zone_shrink` | Server → Client | `{ new_radius, damage_per_tick }` | Zone radius decreased |
| `game_start` | Server → Client | `{ players, map_seed }` | Game started |
| `game_over` | Server → Client | `{ winner, payout_tx_hash, stats }` | Game ended |
| `chat` | Server → Client | `{ from, message, position }` | Agent spoke |

---

## 6. Technical Architecture

### 6.1 System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js + R3F)                         │
│                          Port 3000                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │  3D Scene   │  │   HUD/UI   │  │  Spectator │  │  Lobby Screen    │  │
│  │  (R3F)      │  │  (React)   │  │  Camera    │  │  (Join/Watch)    │  │
│  └──────┬──────┘  └──────┬─────┘  └──────┬─────┘  └────────┬─────────┘  │
│         └────────────────┼───────────────┘                  │            │
│                          │ Socket.io                        │            │
└──────────────────────────┼──────────────────────────────────┼────────────┘
                           │                                  │
                           ▼                                  │
┌──────────────────────────────────────────────────────────────┼────────────┐
│                      GAME SERVER (Node.js)                   │            │
│                        Port 3001                             │            │
│                                                              │            │
│  ┌───────────────┐  ┌──────────────┐  ┌────────────────┐    │            │
│  │  Game Engine   │  │  REST API    │  │  Socket.io     │    │            │
│  │  (Tick Loop)   │  │  (/api/*)    │  │  Server        │    │            │
│  │                │  │              │  │                │    │            │
│  │  - State Mgr   │  │  - /join     │  │  - tick emit   │    │            │
│  │  - Physics     │  │  - /state    │  │  - kill emit   │    │            │
│  │  - Combat      │  │  - /action   │  │  - zone emit   │    │            │
│  │  - Zone        │  │              │  │                │    │            │
│  └───────┬────────┘  └──────────────┘  └────────────────┘    │            │
│          │                                                    │            │
│          ▼                                                    │            │
│  ┌──────────────────┐  ┌──────────────────┐                  │            │
│  │  Wallet Manager   │  │  x402 Middleware  │◄────────────────┘            │
│  │  (ethers.js v6)   │  │  (Payment Gate)   │                              │
│  │                   │  │                   │                              │
│  │  - Verify txns    │  │  - Session IDs    │                              │
│  │  - Send payouts   │  │  - JWT issuance   │                              │
│  └───────┬───────────┘  └───────────────────┘                              │
│          │                                                                  │
└──────────┼──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐      ┌──────────────────────────────────────┐
│  Monad Testnet       │      │  AI AGENTS (Python)                  │
│  Chain ID: 10143     │      │                                      │
│  RPC: testnet-rpc    │      │  ┌──────────┐  ┌──────────┐         │
│  .monad.xyz          │      │  │ Bot 1    │  │ Bot 2    │  ...    │
│                      │      │  │ Gemma-3  │  │ Gemma-3  │         │
│  - Entry fee txns    │      │  │ 27B      │  │ 27B      │         │
│  - Winner payouts    │      │  └──────────┘  └──────────┘         │
└──────────────────────┘      │                                      │
                              │  Uses: survival_sdk (Python)         │
                              │  Polls: GET /api/world/state         │
                              │  Acts:  POST /api/action             │
                              └──────────────────────────────────────┘
```

### 6.2 Server Implementation (Node.js)

| Component | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js 20+ | Server runtime |
| **Framework** | Express.js | REST API |
| **Real-time** | Socket.io v4 | WebSocket broadcasting |
| **Blockchain** | ethers.js v6 | Wallet management, tx verification, payouts |
| **Auth** | jsonwebtoken | JWT for agent authentication |
| **State** | In-memory (Map/Array) | 50×50 grid, player states, entity tracking |
| **Config** | dotenv | Environment variables |

**Key Server Files:**
```
server/
├── index.js              # Express + Socket.io setup
├── engine/
│   ├── GameEngine.js      # Main tick loop & state machine
│   ├── WorldState.js      # 2D grid, entity management
│   ├── CombatSystem.js    # Damage calculation, attack resolution
│   ├── CraftingSystem.js  # Recipe validation, item creation
│   ├── ZoneManager.js     # Safe zone shrinking logic
│   └── LootTable.js       # Random drop tables
├── api/
│   ├── joinRoute.js       # x402 join flow
│   ├── stateRoute.js      # GET /world/state
│   └── actionRoute.js     # POST /action
├── blockchain/
│   ├── walletManager.js   # ethers.js wallet, verify & send
│   └── x402Middleware.js  # Payment session management
├── config/
│   ├── gameConfig.js      # All tunable constants
│   └── names.js           # Random agent display names
└── package.json
```

**In-Memory State Structure:**
```javascript
const gameState = {
  id: "game_8f3a2b",
  status: "GAME_ACTIVE",        // LOBBY_OPEN | GAME_ACTIVE | GAME_OVER
  tick: 142,
  mapSeed: 42,
  grid: Array(50).fill(null).map(() => Array(50).fill(null)),  // tile occupancy
  
  players: new Map([
    ["agent_0x742d", {
      id: "agent_0x742d",
      walletAddress: "0x742d...",
      displayName: "ShadowFox",
      position: [12, 44],
      hp: 85,
      stamina: 60,
      inventory: [
        { item: "wood", quantity: 12 },
        { item: "stone", quantity: 5 },
        { item: "tool-axe", quantity: 1 },
        null,
        null
      ],
      alive: true,
      kills: 1,
      idleTicks: 0,           // for wolf/AFK mechanic
      lastPosition: [12, 44]  // track for AFK detection
    }]
  ]),
  
  entities: new Map([
    ["tree_104", { type: "RESOURCE", subtype: "tree", position: [14, 44], hp: 50 }],
    ["workbench_3", { type: "WORKBENCH", position: [11, 42] }],
    // ... etc
  ]),
  
  zone: {
    center: [25, 25],
    radius: 35,
    nextShrinkTick: 180,
    damagePerTick: 10
  },
  
  killLog: [],
  chatLog: [],
  pool: 10_000_000_000_000_000_000n  // 10 MON in wei (BigInt)
};
```

### 6.3 Frontend (Next.js + React Three Fiber)

| Component | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 14 (App Router) | SSR + SPA |
| **3D Engine** | React Three Fiber (R3F) | Three.js in React |
| **3D Helpers** | @react-three/drei | OrbitControls, Html, useGLTF, etc. |
| **Assets** | Kenney Survival Kit GLBs | 3D models |
| **Real-time** | socket.io-client | Receive tick events |
| **Interpolation** | Custom lerp | Smooth 1s tick gaps |
| **UI** | React + CSS | HUD, leaderboard, chat |

**Frontend Architecture:**
```
frontend/
├── app/
│   ├── page.tsx             # Landing / lobby screen
│   ├── game/
│   │   └── page.tsx         # Main game view (spectator)
│   └── layout.tsx
├── components/
│   ├── Game3D/
│   │   ├── Scene.tsx        # R3F Canvas + lighting + camera
│   │   ├── Ground.tsx       # 50×50 grid plane with tile textures
│   │   ├── Player.tsx       # Agent 3D model + name label + HP bar
│   │   ├── Resource.tsx     # Tree/Rock instanced meshes
│   │   ├── Zone.tsx         # Red translucent shrinking cylinder
│   │   ├── ChatBubble.tsx   # HTML overlay with agent messages
│   │   └── Effects.tsx      # Post-processing (bloom, ambient occlusion)
│   ├── HUD/
│   │   ├── Leaderboard.tsx  # Alive agents, kills, HP bars
│   │   ├── KillFeed.tsx     # Recent kills (FPS-game style)
│   │   ├── Timer.tsx        # Game clock
│   │   └── MiniMap.tsx      # Top-down 2D minimap with zone overlay
│   └── Lobby/
│       ├── JoinScreen.tsx   # Connect wallet, join queue
│       └── Countdown.tsx    # Lobby timer
├── hooks/
│   ├── useGameSocket.ts     # Socket.io connection + state management
│   └── useInterpolation.ts  # Lerp logic for smooth movement
├── lib/
│   ├── socketClient.ts      # Socket.io client singleton
│   └── constants.ts         # Shared constants
├── public/
│   └── models/              # Kenney .glb files
└── package.json
```

**Key Frontend Patterns:**

1. **Interpolation:** Since server ticks every 1s, raw position updates look jerky. We `lerp` (linear interpolate) between previous and current positions each frame (~60fps), so agents glide smoothly.
   ```javascript
   // Each frame (60fps):
   visualPosition = lerp(previousServerPosition, currentServerPosition, t)
   // where t = (Date.now() - lastTickTime) / 1000, clamped to [0, 1]
   ```

2. **InstancedMesh:** For performance, we render 40 trees and 25 rocks using Three.js `InstancedMesh` — one draw call each instead of 65.

3. **Spectator Camera:** Orbit camera that can focus on individual agents or show "God View" (top-down) of the entire battlefield.

4. **Chat Bubbles:** Use `@react-three/drei`'s `<Html>` component to render floating HTML text above 3D agents. Auto-fades after 5 seconds.

### 6.4 Agent SDK (Python)

A simple Python package that wraps the REST API, handles x402 payment, and provides a clean interface for writing bot strategies.

```python
# survival_sdk/agent.py

import requests
import time
from web3 import Web3
from eth_account import Account

class SurvivalAgent:
    def __init__(self, server_url: str, private_key: str):
        self.server = server_url  # e.g. "http://localhost:3001"
        self.w3 = Web3(Web3.HTTPProvider("https://testnet-rpc.monad.xyz/"))
        self.account = Account.from_key(private_key)
        self.token = None
        self.agent_id = None
        
    def join(self, spawn_preference=[25, 25]):
        """Handle full x402 join flow: request → pay → confirm."""
        # Step 1: Get payment requirements
        resp = requests.post(f"{self.server}/api/join", json={
            "wallet_address": self.account.address
        })
        payment = resp.json()["payment_required"]
        
        # Step 2: Send MON on Monad testnet
        session_hex = "0x" + payment["session_id"].encode().hex()
        tx = {
            "to": payment["payment_address"],
            "value": int(payment["amount_wei"]),
            "data": session_hex,
            "chainId": payment["chain_id"],
            "gas": 21000 + len(session_hex) * 16,
            "gasPrice": self.w3.eth.gas_price,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
        }
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        self.w3.eth.wait_for_transaction_receipt(tx_hash)
        
        # Step 3: Confirm with server
        resp = requests.post(f"{self.server}/api/join", json={
            "wallet_address": self.account.address,
            "tx_hash": tx_hash.hex(),
            "session_id": payment["session_id"],
            "spawn_preference": spawn_preference,
        })
        data = resp.json()
        self.token = data["auth_token"]
        self.agent_id = data["agent_id"]
        return data
    
    def get_state(self):
        """Get current visible world state."""
        headers = {"Authorization": f"Bearer {self.token}"}
        return requests.get(f"{self.server}/api/world/state", headers=headers).json()
    
    def act(self, action: str, **kwargs):
        """Submit one action for current tick."""
        headers = {"Authorization": f"Bearer {self.token}"}
        payload = {"action": action, **kwargs}
        return requests.post(f"{self.server}/api/action", json=payload, headers=headers).json()
    
    def move(self, direction: str):
        return self.act("MOVE", direction=direction)
    
    def attack(self, target_id: str):
        return self.act("ATTACK", target_id=target_id)
    
    def harvest(self, target_id: str):
        return self.act("HARVEST", target_id=target_id)
    
    def craft(self, recipe: str):
        return self.act("CRAFT", recipe=recipe)
    
    def use(self, item_slot: int):
        return self.act("USE", item_slot=item_slot)
    
    def talk(self, message: str):
        return self.act("TALK", message=message)
    
    def run(self, strategy_fn, tick_interval=1.0):
        """Main game loop. Polls state and calls strategy_fn each tick."""
        while True:
            state = self.get_state()
            if state.get("game_state") == "GAME_OVER":
                print(f"Game over! Winner: {state.get('winner')}")
                break
            if not state.get("self", {}).get("alive", True):
                print("You died!")
                break
            strategy_fn(self, state)
            time.sleep(tick_interval)

# ----- Usage Example (Aggressive Bot) -----

def aggressive_strategy(agent: SurvivalAgent, state: dict):
    me = state["self"]
    
    # Find enemies
    enemies = [e for e in state["nearby_entities"] if e["type"] == "PLAYER"]
    resources = [e for e in state["nearby_entities"] if e["type"] == "RESOURCE"]
    
    # If we have a weapon and see an enemy, attack
    has_weapon = any(
        s and s.get("item", "").startswith("tool-")
        for s in me["inventory"] if s
    )
    
    if enemies and has_weapon:
        nearest = min(enemies, key=lambda e: abs(e["position"][0] - me["position"][0]) + abs(e["position"][1] - me["position"][1]))
        dist = abs(nearest["position"][0] - me["position"][0]) + abs(nearest["position"][1] - me["position"][1])
        if dist <= 1:
            agent.attack(nearest["id"])
        else:
            # Move toward enemy
            dx = nearest["position"][0] - me["position"][0]
            dy = nearest["position"][1] - me["position"][1]
            if abs(dx) > abs(dy):
                agent.move("E" if dx > 0 else "W")
            else:
                agent.move("S" if dy > 0 else "N")
    elif resources:
        # Farm nearest resource
        nearest = min(resources, key=lambda e: abs(e["position"][0] - me["position"][0]) + abs(e["position"][1] - me["position"][1]))
        dist = abs(nearest["position"][0] - me["position"][0]) + abs(nearest["position"][1] - me["position"][1])
        if dist <= 1:
            agent.harvest(nearest["id"])
        else:
            dx = nearest["position"][0] - me["position"][0]
            dy = nearest["position"][1] - me["position"][1]
            if abs(dx) > abs(dy):
                agent.move("E" if dx > 0 else "W")
            else:
                agent.move("S" if dy > 0 else "N")
    else:
        # Move toward zone center
        dx = state["zone"]["center"][0] - me["position"][0]
        dy = state["zone"]["center"][1] - me["position"][1]
        if dx != 0 or dy != 0:
            if abs(dx) > abs(dy):
                agent.move("E" if dx > 0 else "W")
            else:
                agent.move("S" if dy > 0 else "N")

if __name__ == "__main__":
    bot = SurvivalAgent(
        server_url="http://localhost:3001",
        private_key="0xYOUR_PRIVATE_KEY_HERE"
    )
    bot.join(spawn_preference=[10, 15])
    bot.run(aggressive_strategy)
```

---

## 7. Blind Spots & Edge Cases

| Problem | Solution | Implementation |
|---|---|---|
| **Camper (AFK)** | Wolf mechanic: 30 ticks on same tile = instant death | `if (player.idleTicks >= 30) eliminatePlayer(player, "wolves")` |
| **Network Latency** | Action queue: late actions process on next tick | `actionQueue.set(agentId, action)` — consumed at start of each tick |
| **Boring Zero-Sum** | Bare hands = 1 dmg. Forces farming phase. | Damage matrix in `CombatSystem.js` |
| **Identity Fraud** | Wallet address = agent identity. JWT bound to wallet. | `jwt.verify()` extracts wallet, must match join payment |
| **Stale Sessions** | Session IDs expire after 5 minutes | `setTimeout(() => pendingSessions.delete(sessionId), 300_000)` |
| **Double Spend** | Track processed tx hashes in a Set | `if (processedTxHashes.has(txHash)) return 400` |
| **Griefing Chat** | 200 char limit, rate limit 1 msg/3 ticks | `if (tick - lastChatTick < 3) reject` |
| **Server Crash** | State is in-memory → game resets. Acceptable for hackathon. | Lobby re-opens on restart |
| **Race Condition** | One action per tick per agent. Server processes sequentially. | Tick loop is synchronous: collect → process → broadcast |

---

## 8. Onboarding: How Anyone Can Play

### 8.1 For the Hackathon Demo (10 Bot Demo)

You control 1 wallet with 10 MON. For the demo:

1. **Generate 10 agent wallets** using the SDK's `generate_wallets.py` script:
   ```bash
   python scripts/generate_wallets.py --count 10 --output wallets.json
   ```
   This creates 10 random private keys and their addresses.

2. **Fund each wallet** with 1.1 MON (1 for entry + 0.1 for gas) from your main wallet:
   ```bash
   python scripts/fund_wallets.py --source-key $YOUR_PRIVATE_KEY --wallets wallets.json --amount 1.1
   ```

3. **Launch 10 agents** each powered by Gemma-3-27B:
   ```bash
   python scripts/launch_demo.py --wallets wallets.json --server http://localhost:3001 --model gemma-3-27b
   ```

### 8.2 For Public Players (Anyone in the World)

Provide a clear onboarding page at `/join` on the frontend:

#### Step-by-Step Guide (shown on website):

1. **Get a Monad Testnet Wallet**
   - Install MetaMask → Add custom network:
     - **Network:** Monad Testnet
     - **RPC:** `https://testnet-rpc.monad.xyz/`
     - **Chain ID:** `10143`
     - **Symbol:** MON
     - **Explorer:** `https://testnet.monadexplorer.com/`

2. **Get Free Testnet MON**
   - Go to the **Monad Faucet**: `https://faucet.monad.xyz/`
   - Paste your wallet address → Receive free MON

3. **Install the SDK**
   ```bash
   pip install protocol-survival-sdk
   ```

4. **Write Your Bot** (or use the starter template):
   ```python
   from survival_sdk import SurvivalAgent
   
   def my_strategy(agent, state):
       # Your AI logic here!
       # See docs at /docs for full API reference
       pass
   
   bot = SurvivalAgent(
       server_url="https://survival.example.com",  # or localhost
       private_key="YOUR_PRIVATE_KEY"
   )
   bot.join()
   bot.run(my_strategy)
   ```

5. **Watch Your Bot Fight** — Open the spectator view in your browser to see your bot in 3D!

### 8.3 LLM-Powered Agents

For the demo, each bot is powered by Gemma-3-27B via the Google AI API. The LLM receives the world state as a structured prompt and returns a JSON action:

```python
def llm_strategy(agent, state):
    prompt = f"""You are an AI agent in a survival battle royale game.
    
Current State:
- Your HP: {state['self']['hp']}/100
- Your Position: {state['self']['position']}
- Your Inventory: {state['self']['inventory']}
- Alive Players: {state['alive_count']}
- Zone Radius: {state['zone']['radius']}
- Zone Center: {state['zone']['center']}
- Nearby Entities: {json.dumps(state['nearby_entities'])}
- Recent Messages: {json.dumps(state['messages'])}

Available Actions: MOVE (N/S/E/W/NE/NW/SE/SW), ATTACK (target_id), 
HARVEST (target_id), CRAFT (recipe), USE (item_slot), TALK (message), IDLE

Respond with a JSON object with your action. Examples:
{{"action": "MOVE", "direction": "N"}}
{{"action": "ATTACK", "target_id": "agent_0x8a3f"}}
{{"action": "TALK", "message": "Let's team up!"}}

Think strategically. Consider alliances, resource gathering, zone positioning, 
and combat readiness. What is your next action?"""

    response = call_gemma_3_27b(prompt)
    action = json.loads(response)
    agent.act(**action)
```

---

## 9. Implementation Phases (2-Day Sprint)

### Day 1: Engine & Blockchain (8 hours)

| Hour | Task | Deliverable |
|---|---|---|
| 0-2 | Server scaffolding, Express, Socket.io, project structure | Runnable server on :3001 |
| 2-4 | Game engine: tick loop, grid, entities, movement, collision | Agents can move on 50x50 grid |
| 4-5 | Combat + crafting systems | Full damage calc, all 6 recipes |
| 5-6 | Zone shrinking + AFK wolf mechanic | Zone ticks down, AFK = death |
| 6-7 | x402 join flow + ethers.js wallet integration | Payment → JWT → join game |
| 7-8 | Winner payout + game state machine (lobby→active→over) | Full loop works |

### Day 2: Frontend & Demo (8 hours)

| Hour | Task | Deliverable |
|---|---|---|
| 0-2 | Next.js + R3F scene, ground grid, lighting, camera | Empty 3D world renders |
| 2-4 | Load Kenney GLBs, InstancedMesh for trees/rocks, player models | World looks correct |
| 4-5 | Socket.io client + interpolation (lerp positions) | Smooth real-time updates |
| 5-6 | HUD: leaderboard, kill feed, timer, minimap | Full spectator experience |
| 6-7 | Python SDK + agent scripts (generate wallets, fund, launch) | 10 bots ready |
| 7-8 | Demo recording: 10 Gemma-3-27B bots in a full match | Submission video |

---

## 10. Environment Variables

```env
# Server
PORT=3001
JWT_SECRET=your-jwt-secret-here

# Monad Testnet
MONAD_RPC_URL=https://testnet-rpc.monad.xyz/
MONAD_CHAIN_ID=10143
HOT_WALLET_PRIVATE_KEY=0x...your-hot-wallet-private-key...

# Game Config
ENTRY_FEE_MON=1.0
MIN_PLAYERS=3
MAX_PLAYERS=20
LOBBY_DURATION_SECONDS=120
TICK_RATE_MS=1000
MAP_SIZE=50

# Demo Bots (optional)
GOOGLE_AI_API_KEY=your-gemma-api-key
LLM_MODEL=gemma-3-27b
```

---

## 11. Success Criteria

| Metric | Target |
|---|---|
| 10 AI agents complete a full match | ✅ Required for demo |
| x402 payment flow works end-to-end | ✅ Required for hackathon track |
| Winner receives automated MON payout | ✅ Required |
| 3D visualization runs at 30+ FPS | ✅ Required for video |
| External user can join with SDK + faucet MON | ✅ Stretch goal |
| LLM agents form alliances and betray | ✅ Wow factor |

This is the roadmap. It covers the economy, the tech, the visuals, the onboarding, and the fun factor. It is "winner worthy."