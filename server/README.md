# Game Server — Protocol: SURVIVAL

This directory houses the game server engine (Node.js + Express + Socket.io).

## Getting Started

```bash
cd server
npm install
npm run dev
```

Server runs on **port 3001** by default.

## Implementation Guide

Follow the Phase 1 spec for full implementation details:

📄 **[Phase 1: Game Server Engine](../docs/specs/phase-1-game-server-engine.md)**

## Target Directory Structure

```
server/
├── index.js                    # Entry point: Express + Socket.io bootstrap
├── .env                        # Environment variables (see ../.env.example)
├── package.json
├── engine/
│   ├── GameEngine.js           # Main tick loop, game state machine
│   ├── WorldState.js           # 2D grid, entity CRUD, spatial queries
│   ├── CombatSystem.js         # Damage calculation, attack resolution
│   ├── CraftingSystem.js       # Recipe validation, inventory management
│   ├── ZoneManager.js          # Safe zone shrinking schedule
│   └── LootTable.js            # Random drop tables
├── api/
│   ├── joinRoute.js            # POST /api/join (x402 flow)
│   ├── stateRoute.js           # GET /api/world/state
│   └── actionRoute.js          # POST /api/action
├── config/
│   ├── gameConfig.js           # All tunable constants
│   └── names.js                # Random display names
└── utils/
    └── logger.js               # Timestamped console logger
```
