# Phase 1 Spec: Game Server Engine & State Management

> **Owner:** Backend Engineer
> **Effort:** ~6 hours
> **Dependencies:** None — this is the foundation everything else builds on
> **Output:** A running Node.js server on port 3001 with a full game tick loop, 50×50 grid world, entity management, combat, crafting, zone shrinking, and game state machine.

---

## 1. Project Scaffolding

### 1.1 Initialize Project

```bash
mkdir server && cd server
npm init -y
npm install express socket.io cors dotenv uuid jsonwebtoken
npm install -D nodemon
```

### 1.2 Directory Structure

Create the following file structure:

```
server/
├── index.js                    # Entry point: Express + Socket.io bootstrap
├── .env                        # Environment variables
├── package.json
├── engine/
│   ├── GameEngine.js           # Main tick loop, game state machine, orchestrator
│   ├── WorldState.js           # 2D grid, entity CRUD, spatial queries
│   ├── CombatSystem.js         # Damage calculation, attack resolution
│   ├── CraftingSystem.js       # Recipe validation, inventory management
│   ├── ZoneManager.js          # Safe zone shrinking schedule, damage
│   └── LootTable.js            # Random drop tables for crates/barrels
├── api/
│   ├── joinRoute.js            # POST /api/join (x402 flow — stubbed in Phase 1)
│   ├── stateRoute.js           # GET /api/world/state
│   └── actionRoute.js          # POST /api/action
├── config/
│   ├── gameConfig.js           # All tunable constants in one file
│   └── names.js                # Array of random display names
└── utils/
    └── logger.js               # Simple console logger with timestamps
```

### 1.3 `package.json` scripts

```json
{
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  }
}
```

---

## 2. Configuration (`config/gameConfig.js`)

All magic numbers live here. Never hardcode values in engine files.

```javascript
module.exports = {
  // Server
  PORT: parseInt(process.env.PORT || '3001'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-key',

  // Map
  MAP_SIZE: parseInt(process.env.MAP_SIZE || '50'),  // 50×50 grid
  
  // Game
  TICK_RATE_MS: parseInt(process.env.TICK_RATE_MS || '1000'),
  MAX_GAME_TICKS: 600,          // 10 minutes at 1 tick/sec
  MIN_PLAYERS: parseInt(process.env.MIN_PLAYERS || '3'),
  MAX_PLAYERS: parseInt(process.env.MAX_PLAYERS || '20'),
  LOBBY_DURATION_SECONDS: parseInt(process.env.LOBBY_DURATION_SECONDS || '120'),
  
  // Player
  PLAYER_MAX_HP: 100,
  PLAYER_MAX_STAMINA: 100,
  PLAYER_INVENTORY_SLOTS: 5,
  PLAYER_VISION_RADIUS: 15,     // Chebyshev distance
  STAMINA_REGEN_PER_TICK: 5,    // When idle
  STAMINA_COST_MOVE: 3,
  STAMINA_COST_ATTACK: 10,
  STAMINA_COST_HARVEST: 5,
  BARE_HANDS_DAMAGE: 1,
  AFK_KILL_TICKS: 30,           // 30 ticks on same tile = wolf kill
  MAX_RESOURCE_STACK: 20,       // Max quantity per inventory slot
  CHAT_COOLDOWN_TICKS: 3,       // Min ticks between messages
  CHAT_MAX_LENGTH: 200,
  
  // Zone
  ZONE_CENTER: [25, 25],
  ZONE_INITIAL_RADIUS: 35,
  ZONE_DAMAGE_PER_TICK: 10,
  ZONE_SHRINK_SCHEDULE: [
    // { tick: when_to_shrink, new_radius: target_radius }
    { tick: 180, radius: 30 },
    { tick: 210, radius: 25 },
    { tick: 240, radius: 20 },
    { tick: 270, radius: 15 },
    { tick: 300, radius: 12 },
    { tick: 330, radius: 10 },
    { tick: 390, radius: 8 },
    { tick: 450, radius: 6 },
    { tick: 540, radius: 4 },
  ],
  
  // World Generation
  NUM_TREES: 40,
  NUM_ROCKS: 25,
  NUM_CRATES: 10,
  NUM_BARRELS: 15,
  NUM_WORKBENCHES: 5,
  TREE_HP: 50,
  ROCK_HP: 100,
  
  // Crafting Recipes
  RECIPES: {
    'wooden-club':    { ingredients: { wood: 5 },               result: { item: 'wooden-club',  damage: 8  } },
    'stone-axe':      { ingredients: { wood: 10, stone: 5 },    result: { item: 'stone-axe',    damage: 15, harvestBonus: 'tree' } },
    'stone-pickaxe':  { ingredients: { wood: 10, stone: 5 },    result: { item: 'stone-pickaxe',damage: 12, harvestBonus: 'rock' } },
    'stone-hammer':   { ingredients: { wood: 10, stone: 10 },   result: { item: 'stone-hammer', damage: 20 } },
    'barricade':      { ingredients: { wood: 5 },               result: { item: 'barricade',    placeable: true, hp: 30 } },
    'health-potion':  { ingredients: { wood: 5, stone: 3 },     result: { item: 'health-potion',healAmount: 30 } },
  },
  
  // Weapon Damage Table
  WEAPON_DAMAGE: {
    'wooden-club': 8,
    'stone-axe': 15,
    'stone-pickaxe': 12,
    'stone-hammer': 20,
  },
  
  // Harvest Tool Bonuses (2x speed = half the HP reduced per harvest)
  HARVEST_BONUS: {
    'stone-axe': 'tree',       // 2× harvest damage on trees
    'stone-pickaxe': 'rock',   // 2× harvest damage on rocks
  },
  
  // Loot tables (weighted random)
  CRATE_LOOT_TABLE: [
    { item: 'stone-axe', weight: 20 },
    { item: 'stone-pickaxe', weight: 20 },
    { item: 'wooden-club', weight: 30 },
    { item: 'health-potion', weight: 30 },
  ],
  BARREL_LOOT_TABLE: [
    { item: 'wood', quantity: [1, 3], weight: 50 },  // 1-3 wood
    { item: 'stone', quantity: [1, 3], weight: 50 }, // 1-3 stone
  ],
};
```

---

## 3. Display Names (`config/names.js`)

```javascript
module.exports = [
  'ShadowFox', 'IronWolf', 'BlazeFang', 'FrostByte', 'StormCrow',
  'NightHawk', 'ThunderPaw', 'VoidWalker', 'AshenBlade', 'CrimsonThorn',
  'SilverFang', 'DuskRunner', 'EmberStrike', 'GhostClaw', 'HexWarden',
  'JadeViper', 'KnightOwl', 'LunarHowl', 'MistWraith', 'OnyxReaper',
];
```

---

## 4. Entry Point (`index.js`)

This file wires everything together. Full implementation:

```javascript
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config/gameConfig');
const GameEngine = require('./engine/GameEngine');
const joinRoute = require('./api/joinRoute');
const stateRoute = require('./api/stateRoute');
const actionRoute = require('./api/actionRoute');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Initialize game engine
const engine = new GameEngine(io);

// Mount API routes — inject engine dependency
app.use('/api/join', joinRoute(engine));
app.use('/api/world/state', stateRoute(engine));
app.use('/api/action', actionRoute(engine));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    game_state: engine.getStatus(),
    tick: engine.getCurrentTick(),
    players: engine.getPlayerCount(),
  });
});

// Socket.io connection handling
io.of('/game').on('connection', (socket) => {
  console.log(`[Socket] Spectator connected: ${socket.id}`);
  
  // Send current state on connect
  socket.emit('sync', engine.getFullState());
  
  socket.on('disconnect', () => {
    console.log(`[Socket] Spectator disconnected: ${socket.id}`);
  });
});

// Start server
server.listen(config.PORT, () => {
  console.log(`[Server] Protocol: SURVIVAL running on port ${config.PORT}`);
  engine.start(); // Begin the lobby
});
```

---

## 5. Game Engine (`engine/GameEngine.js`)

This is the core orchestrator. It manages the state machine, runs the tick loop, and coordinates all subsystems.

### 5.1 State Machine

```
                     lobby timer expires
                     or max players
LOBBY_OPEN ─────────────────────────────► GAME_ACTIVE
   │                                          │
   │ addPlayer()                              │ tick()
   │                                          │    - processActions()
   │                                          │    - applyZoneDamage()
   │                                          │    - checkAFK()
   │                                          │    - checkWinner()
   │                                          │
   │                                          ▼
   │                                     GAME_OVER
   │                                          │
   │              30s cooldown                │
   └──────────────────────────────────────────┘
```

### 5.2 Full Implementation

```javascript
const { v4: uuidv4 } = require('uuid');
const config = require('../config/gameConfig');
const WorldState = require('./WorldState');
const CombatSystem = require('./CombatSystem');
const CraftingSystem = require('./CraftingSystem');
const ZoneManager = require('./ZoneManager');
const names = require('../config/names');

const STATES = {
  LOBBY_OPEN: 'LOBBY_OPEN',
  GAME_ACTIVE: 'GAME_ACTIVE',
  GAME_OVER: 'GAME_OVER',
};

class GameEngine {
  constructor(io) {
    this.io = io;               // Socket.io server instance
    this.gameId = uuidv4();
    this.status = STATES.LOBBY_OPEN;
    this.tick = 0;
    this.tickInterval = null;
    this.lobbyTimeout = null;
    
    // Subsystems
    this.world = new WorldState(config.MAP_SIZE);
    this.combat = new CombatSystem();
    this.crafting = new CraftingSystem();
    this.zone = new ZoneManager();
    
    // Player tracking
    this.players = new Map();           // agentId -> PlayerState
    this.actionQueue = new Map();       // agentId -> action (consumed per tick)
    this.usedNames = new Set();
    this.killLog = [];
    this.chatLog = [];
    
    // Pool tracking (in wei as BigInt)
    this.pool = 0n;
  }

  // --- STATE MACHINE ---
  
  start() {
    this.status = STATES.LOBBY_OPEN;
    this.gameId = uuidv4();
    this.tick = 0;
    this.players.clear();
    this.actionQueue.clear();
    this.usedNames.clear();
    this.killLog = [];
    this.chatLog = [];
    this.pool = 0n;
    
    console.log(`[Engine] Game ${this.gameId} — Lobby open`);
    
    // Auto-start after lobby duration if min players met
    this.lobbyTimeout = setTimeout(() => {
      if (this.players.size >= config.MIN_PLAYERS) {
        this.startGame();
      } else {
        console.log('[Engine] Not enough players. Extending lobby...');
        // Re-set the timeout
        this.lobbyTimeout = setTimeout(() => this.start(), config.LOBBY_DURATION_SECONDS * 1000);
      }
    }, config.LOBBY_DURATION_SECONDS * 1000);
  }

  startGame() {
    if (this.status !== STATES.LOBBY_OPEN) return;
    clearTimeout(this.lobbyTimeout);
    
    this.status = STATES.GAME_ACTIVE;
    this.tick = 0;
    
    // Generate the world
    const seed = Date.now();
    this.world.generate(seed, {
      trees: config.NUM_TREES,
      rocks: config.NUM_ROCKS,
      crates: config.NUM_CRATES,
      barrels: config.NUM_BARRELS,
      workbenches: config.NUM_WORKBENCHES,
    });
    
    // Spawn players at their assigned positions
    for (const [id, player] of this.players) {
      this.world.placeEntity(id, player.position);
    }
    
    // Initialize zone
    this.zone.init(config.ZONE_CENTER, config.ZONE_INITIAL_RADIUS, config.ZONE_SHRINK_SCHEDULE);
    
    // Broadcast game start
    this.io.of('/game').emit('game_start', {
      game_id: this.gameId,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        display_name: p.displayName,
        position: p.position,
      })),
      map: this.world.getSerializableMap(),
      zone: this.zone.getState(),
    });
    
    console.log(`[Engine] Game ${this.gameId} — STARTED with ${this.players.size} players`);
    
    // Start tick loop
    this.tickInterval = setInterval(() => this.gameTick(), config.TICK_RATE_MS);
  }

  gameTick() {
    this.tick++;
    
    // 1. Process all queued actions
    this.processActions();
    
    // 2. Apply zone shrinking
    const shrinkEvent = this.zone.update(this.tick);
    if (shrinkEvent) {
      this.io.of('/game').emit('zone_shrink', shrinkEvent);
    }
    
    // 3. Apply zone damage to players outside safe zone
    this.applyZoneDamage();
    
    // 4. Regenerate stamina for idle players
    this.regenerateStamina();
    
    // 5. Check AFK (wolf mechanic)
    this.checkAFK();
    
    // 6. Check for winner
    const alivePlayers = this.getAlivePlayers();
    if (alivePlayers.length <= 1 || this.tick >= config.MAX_GAME_TICKS) {
      this.endGame(alivePlayers);
      return;
    }
    
    // 7. Broadcast tick state to all spectators
    this.broadcastTick();
    
    // 8. Clear action queue for next tick
    this.actionQueue.clear();
  }

  endGame(alivePlayers) {
    clearInterval(this.tickInterval);
    this.status = STATES.GAME_OVER;
    
    let winner = null;
    if (alivePlayers.length === 1) {
      winner = alivePlayers[0];
    } else if (alivePlayers.length > 1) {
      // Tie-break: highest HP, then most kills
      alivePlayers.sort((a, b) => {
        if (b.hp !== a.hp) return b.hp - a.hp;
        return b.kills - a.kills;
      });
      winner = alivePlayers[0];
    }
    
    const result = {
      winner: winner ? {
        id: winner.id,
        display_name: winner.displayName,
        wallet_address: winner.walletAddress,
        hp: winner.hp,
        kills: winner.kills,
      } : null,
      total_ticks: this.tick,
      kill_log: this.killLog,
      pool_wei: this.pool.toString(),
      payout_tx_hash: null, // Set by blockchain module in Phase 2
    };
    
    console.log(`[Engine] Game ${this.gameId} — OVER. Winner: ${winner?.displayName || 'none'}`);
    this.io.of('/game').emit('game_over', result);
    
    // Reset after 30 seconds
    setTimeout(() => this.start(), 30_000);
    
    return result;
  }

  // --- PLAYER MANAGEMENT ---

  addPlayer(walletAddress, spawnPreference) {
    if (this.status !== STATES.LOBBY_OPEN) {
      return { error: 'GAME_NOT_IN_LOBBY', message: 'Game is not accepting players' };
    }
    if (this.players.size >= config.MAX_PLAYERS) {
      return { error: 'GAME_FULL', message: 'Game is full' };
    }
    
    // Check if wallet already joined
    for (const [, player] of this.players) {
      if (player.walletAddress === walletAddress) {
        return { error: 'ALREADY_JOINED', message: 'This wallet has already joined' };
      }
    }
    
    const agentId = `agent_${walletAddress.slice(0, 6)}`;
    const displayName = this.assignName();
    const position = this.world.findSpawnPosition(spawnPreference, config.MAP_SIZE);
    
    const player = {
      id: agentId,
      walletAddress,
      displayName,
      position,
      hp: config.PLAYER_MAX_HP,
      stamina: config.PLAYER_MAX_STAMINA,
      inventory: new Array(config.PLAYER_INVENTORY_SLOTS).fill(null),
      alive: true,
      kills: 0,
      idleTicks: 0,
      lastPosition: [...position],
      lastChatTick: -999,
    };
    
    this.players.set(agentId, player);
    
    // If max players reached, start game immediately
    if (this.players.size >= config.MAX_PLAYERS) {
      this.startGame();
    }
    
    return {
      agent_id: agentId,
      display_name: displayName,
      position,
      game_id: this.gameId,
      players_connected: this.players.size,
    };
  }

  assignName() {
    for (const name of names) {
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    return `Agent_${this.players.size + 1}`;
  }

  // --- ACTION PROCESSING ---

  queueAction(agentId, action) {
    if (this.status !== STATES.GAME_ACTIVE) {
      return { success: false, error: 'GAME_NOT_ACTIVE' };
    }
    const player = this.players.get(agentId);
    if (!player || !player.alive) {
      return { success: false, error: 'PLAYER_NOT_ALIVE' };
    }
    // Only accept first action per tick
    if (this.actionQueue.has(agentId)) {
      return { success: false, error: 'ACTION_ALREADY_QUEUED', message: 'One action per tick' };
    }
    this.actionQueue.set(agentId, action);
    return { success: true, tick_queued: this.tick };
  }

  processActions() {
    for (const [agentId, action] of this.actionQueue) {
      const player = this.players.get(agentId);
      if (!player || !player.alive) continue;
      
      try {
        switch (action.action) {
          case 'MOVE':
            this.processMove(player, action);
            break;
          case 'ATTACK':
            this.processAttack(player, action);
            break;
          case 'HARVEST':
            this.processHarvest(player, action);
            break;
          case 'CRAFT':
            this.processCraft(player, action);
            break;
          case 'USE':
            this.processUse(player, action);
            break;
          case 'TALK':
            this.processTalk(player, action);
            break;
          case 'IDLE':
            // Do nothing — stamina regens separately
            break;
          default:
            console.log(`[Engine] Unknown action: ${action.action}`);
        }
      } catch (err) {
        console.error(`[Engine] Error processing action for ${agentId}:`, err.message);
      }
    }
  }

  processMove(player, action) {
    if (player.stamina < config.STAMINA_COST_MOVE) {
      return; // Silently skip if not enough stamina
    }
    
    const DIRECTIONS = {
      'N':  [0, -1],  'S':  [0, 1],   'E':  [1, 0],   'W':  [-1, 0],
      'NE': [1, -1],  'NW': [-1, -1], 'SE': [1, 1],    'SW': [-1, 1],
    };
    
    const delta = DIRECTIONS[action.direction];
    if (!delta) return;
    
    const newX = player.position[0] + delta[0];
    const newY = player.position[1] + delta[1];
    
    // Bounds check
    if (newX < 0 || newX >= config.MAP_SIZE || newY < 0 || newY >= config.MAP_SIZE) return;
    
    // Collision with barricades
    if (this.world.isBlocked(newX, newY)) return;
    
    // Move
    this.world.moveEntity(player.id, player.position, [newX, newY]);
    player.position = [newX, newY];
    player.stamina -= config.STAMINA_COST_MOVE;
  }

  processAttack(player, action) {
    if (player.stamina < config.STAMINA_COST_ATTACK) return;
    
    const target = this.players.get(action.target_id) || this.world.getEntity(action.target_id);
    if (!target) return;
    
    // Check adjacency (distance <= 1 in Chebyshev)
    const targetPos = target.position;
    const dx = Math.abs(player.position[0] - targetPos[0]);
    const dy = Math.abs(player.position[1] - targetPos[1]);
    if (dx > 1 || dy > 1) return;
    
    player.stamina -= config.STAMINA_COST_ATTACK;
    
    // Calculate damage
    const damage = this.combat.calculateDamage(player);
    
    if (target.alive !== undefined) {
      // Attacking a player
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp <= 0) {
        this.eliminatePlayer(target, player, 'combat');
      }
    } else if (target.type === 'BARRICADE') {
      // Attacking a barricade
      target.hp -= damage;
      if (target.hp <= 0) {
        this.world.removeEntity(action.target_id);
      }
    }
  }

  processHarvest(player, action) {
    if (player.stamina < config.STAMINA_COST_HARVEST) return;
    
    const resource = this.world.getEntity(action.target_id);
    if (!resource || resource.type !== 'RESOURCE') return;
    
    // Adjacency check
    const dx = Math.abs(player.position[0] - resource.position[0]);
    const dy = Math.abs(player.position[1] - resource.position[1]);
    if (dx > 1 || dy > 1) return;
    
    player.stamina -= config.STAMINA_COST_HARVEST;
    
    // Calculate harvest damage (tools give 2× on matching resource)
    let harvestDamage = 10; // base
    const heldTool = this.getHeldWeapon(player);
    if (heldTool && config.HARVEST_BONUS[heldTool] === resource.subtype) {
      harvestDamage = 20; // 2× bonus
    }
    
    resource.hp -= harvestDamage;
    
    // Always drop some resources on each hit
    const dropItem = resource.subtype === 'tree' ? 'wood' : 'stone';
    const dropQty = resource.hp <= 0 ? 3 : 1; // More on destroy
    this.addToInventory(player, dropItem, dropQty);
    
    // Remove if depleted
    if (resource.hp <= 0) {
      this.world.removeEntity(action.target_id);
    }
  }

  processCraft(player, action) {
    const recipe = config.RECIPES[action.recipe];
    if (!recipe) return;
    
    // Check near workbench (within 2 tiles)
    const nearWorkbench = this.world.findNearby(player.position, 2)
      .some(e => e.type === 'WORKBENCH');
    if (!nearWorkbench) return;
    
    // Check ingredients
    for (const [item, qty] of Object.entries(recipe.ingredients)) {
      if (this.countInInventory(player, item) < qty) return;
    }
    
    // Consume ingredients
    for (const [item, qty] of Object.entries(recipe.ingredients)) {
      this.removeFromInventory(player, item, qty);
    }
    
    // Add crafted item
    if (recipe.result.placeable) {
      // Place barricade at an adjacent empty tile
      const barricadePos = this.world.findAdjacentEmpty(player.position);
      if (barricadePos) {
        const barricadeId = `barricade_${Date.now()}`;
        this.world.addEntity(barricadeId, {
          type: 'BARRICADE',
          position: barricadePos,
          hp: recipe.result.hp,
        });
      }
    } else {
      this.addToInventory(player, recipe.result.item, 1);
    }
  }

  processUse(player, action) {
    const slot = action.item_slot;
    if (slot < 0 || slot >= config.PLAYER_INVENTORY_SLOTS) return;
    
    const item = player.inventory[slot];
    if (!item) return;
    
    if (item.item === 'health-potion') {
      player.hp = Math.min(config.PLAYER_MAX_HP, player.hp + 30);
      player.inventory[slot] = null;
    }
  }

  processTalk(player, action) {
    if (!action.message || action.message.length > config.CHAT_MAX_LENGTH) return;
    if (this.tick - player.lastChatTick < config.CHAT_COOLDOWN_TICKS) return;
    
    player.lastChatTick = this.tick;
    
    const chatEvent = {
      from: player.id,
      from_name: player.displayName,
      text: action.message,
      position: player.position,
      tick: this.tick,
    };
    
    this.chatLog.push(chatEvent);
    this.io.of('/game').emit('chat', chatEvent);
  }

  // --- ZONE DAMAGE ---

  applyZoneDamage() {
    const zoneState = this.zone.getState();
    for (const [, player] of this.players) {
      if (!player.alive) continue;
      
      const dist = Math.sqrt(
        Math.pow(player.position[0] - zoneState.center[0], 2) +
        Math.pow(player.position[1] - zoneState.center[1], 2)
      );
      
      if (dist > zoneState.radius) {
        player.hp -= config.ZONE_DAMAGE_PER_TICK;
        if (player.hp <= 0) {
          this.eliminatePlayer(player, null, 'zone');
        }
      }
    }
  }

  // --- AFK DETECTION ---

  checkAFK() {
    for (const [, player] of this.players) {
      if (!player.alive) continue;
      
      if (player.position[0] === player.lastPosition[0] &&
          player.position[1] === player.lastPosition[1]) {
        player.idleTicks++;
      } else {
        player.idleTicks = 0;
        player.lastPosition = [...player.position];
      }
      
      if (player.idleTicks >= config.AFK_KILL_TICKS) {
        this.eliminatePlayer(player, null, 'wolves');
      }
    }
  }

  // --- STAMINA REGEN ---

  regenerateStamina() {
    for (const [agentId, player] of this.players) {
      if (!player.alive) continue;
      
      // If didn't submit an action this tick, regen stamina
      if (!this.actionQueue.has(agentId) || this.actionQueue.get(agentId).action === 'IDLE') {
        player.stamina = Math.min(
          config.PLAYER_MAX_STAMINA,
          player.stamina + config.STAMINA_REGEN_PER_TICK
        );
      }
    }
  }

  // --- ELIMINATION ---

  eliminatePlayer(victim, killer, cause) {
    victim.alive = false;
    victim.hp = 0;
    
    const killEvent = {
      tick: this.tick,
      victim_id: victim.id,
      victim_name: victim.displayName,
      killer_id: killer?.id || null,
      killer_name: killer?.displayName || null,
      cause, // 'combat', 'zone', 'wolves'
      position: victim.position,
    };
    
    if (killer) {
      killer.kills++;
    }
    
    // Drop inventory on ground (scatter loot crates)
    // For simplicity: items are lost on death
    
    this.killLog.push(killEvent);
    this.io.of('/game').emit('kill', killEvent);
    this.world.removeEntity(victim.id);
    
    console.log(`[Engine] ${victim.displayName} eliminated by ${cause}`);
  }

  // --- INVENTORY HELPERS ---

  addToInventory(player, item, quantity) {
    // First try to stack with existing
    for (let i = 0; i < player.inventory.length; i++) {
      const slot = player.inventory[i];
      if (slot && slot.item === item && !config.WEAPON_DAMAGE[item]) {
        // Stackable resource
        slot.quantity = Math.min(config.MAX_RESOURCE_STACK, slot.quantity + quantity);
        return true;
      }
    }
    // Then find empty slot
    for (let i = 0; i < player.inventory.length; i++) {
      if (!player.inventory[i]) {
        player.inventory[i] = { item, quantity };
        return true;
      }
    }
    return false; // Inventory full
  }

  removeFromInventory(player, item, quantity) {
    let remaining = quantity;
    for (let i = 0; i < player.inventory.length && remaining > 0; i++) {
      const slot = player.inventory[i];
      if (slot && slot.item === item) {
        const take = Math.min(slot.quantity, remaining);
        slot.quantity -= take;
        remaining -= take;
        if (slot.quantity <= 0) {
          player.inventory[i] = null;
        }
      }
    }
  }

  countInInventory(player, item) {
    return player.inventory
      .filter(s => s && s.item === item)
      .reduce((sum, s) => sum + s.quantity, 0);
  }

  getHeldWeapon(player) {
    // Return the best weapon in inventory
    const weapons = ['stone-hammer', 'stone-axe', 'stone-pickaxe', 'wooden-club'];
    for (const w of weapons) {
      if (player.inventory.some(s => s && s.item === w)) return w;
    }
    return null;
  }

  // --- BROADCASTING ---

  broadcastTick() {
    // Send full state to spectators (they see everything)
    const fullState = this.getFullState();
    this.io.of('/game').emit('tick', fullState);
  }

  // --- STATE GETTERS ---

  getFullState() {
    return {
      game_id: this.gameId,
      tick: this.tick,
      game_state: this.status,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        display_name: p.displayName,
        position: p.position,
        hp: p.hp,
        alive: p.alive,
        kills: p.kills,
        holding: this.getHeldWeapon(p),
      })),
      entities: this.world.getAllEntities(),
      zone: this.zone.getState(),
      alive_count: this.getAlivePlayers().length,
      kill_log: this.killLog.slice(-10),  // Last 10 kills
      chat_log: this.chatLog.slice(-20),  // Last 20 messages
    };
  }

  getPlayerState(agentId) {
    const player = this.players.get(agentId);
    if (!player) return null;
    
    // Only return what this agent can "see" (fog of war)
    const nearbyEntities = this.world.findNearby(player.position, config.PLAYER_VISION_RADIUS);
    const nearbyPlayers = Array.from(this.players.values())
      .filter(p => p.id !== agentId && p.alive)
      .filter(p => {
        const dx = Math.abs(p.position[0] - player.position[0]);
        const dy = Math.abs(p.position[1] - player.position[1]);
        return dx <= config.PLAYER_VISION_RADIUS && dy <= config.PLAYER_VISION_RADIUS;
      })
      .map(p => ({
        id: p.id,
        type: 'PLAYER',
        display_name: p.displayName,
        position: p.position,
        hp: p.hp,
        holding: this.getHeldWeapon(p),
      }));
    
    // Recent messages from nearby agents
    const recentMessages = this.chatLog
      .filter(m => m.tick >= this.tick - 5)  // Last 5 ticks
      .filter(m => {
        const dx = Math.abs(m.position[0] - player.position[0]);
        const dy = Math.abs(m.position[1] - player.position[1]);
        return dx <= config.PLAYER_VISION_RADIUS && dy <= config.PLAYER_VISION_RADIUS;
      });
    
    // Recent kill events
    const recentKills = this.killLog.filter(k => k.tick >= this.tick - 10);
    
    return {
      tick: this.tick,
      game_state: this.status,
      self: {
        id: player.id,
        display_name: player.displayName,
        hp: player.hp,
        stamina: player.stamina,
        position: player.position,
        inventory: player.inventory,
        kills: player.kills,
        alive: player.alive,
      },
      zone: this.zone.getState(),
      nearby_entities: [...nearbyEntities, ...nearbyPlayers],
      messages: recentMessages,
      events: recentKills,
      alive_count: this.getAlivePlayers().length,
      elapsed_seconds: this.tick,
    };
  }

  getAlivePlayers() {
    return Array.from(this.players.values()).filter(p => p.alive);
  }

  getStatus() { return this.status; }
  getCurrentTick() { return this.tick; }
  getPlayerCount() { return this.players.size; }
  getGameId() { return this.gameId; }
  getPool() { return this.pool; }
  getWinner() {
    const alive = this.getAlivePlayers();
    return alive.length === 1 ? alive[0] : null;
  }
}

module.exports = GameEngine;
```

---

## 6. World State (`engine/WorldState.js`)

Manages the 2D grid, entity placement, spatial queries.

```javascript
const config = require('../config/gameConfig');

class WorldState {
  constructor(size) {
    this.size = size;
    this.grid = Array(size).fill(null).map(() => Array(size).fill(null));
    this.entities = new Map(); // entityId -> entity data
  }

  generate(seed, counts) {
    // Simple seeded pseudo-random using seed
    let rng = this.seededRandom(seed);
    
    // Place trees
    for (let i = 0; i < counts.trees; i++) {
      const pos = this.randomEmptyTile(rng);
      if (pos) {
        const id = `tree_${i}`;
        const subtype = rng() > 0.5 ? 'tree' : 'tree-pine';
        this.addEntity(id, { type: 'RESOURCE', subtype, position: pos, hp: config.TREE_HP });
      }
    }
    
    // Place rocks
    for (let i = 0; i < counts.rocks; i++) {
      const pos = this.randomEmptyTile(rng);
      if (pos) {
        const id = `rock_${i}`;
        const subtype = rng() > 0.5 ? 'rock-a' : 'rock-b';
        this.addEntity(id, { type: 'RESOURCE', subtype, position: pos, hp: config.ROCK_HP });
      }
    }
    
    // Place crates
    for (let i = 0; i < counts.crates; i++) {
      const pos = this.randomEmptyTile(rng);
      if (pos) {
        const id = `crate_${i}`;
        this.addEntity(id, { type: 'LOOT', subtype: 'chest', position: pos });
      }
    }
    
    // Place barrels
    for (let i = 0; i < counts.barrels; i++) {
      const pos = this.randomEmptyTile(rng);
      if (pos) {
        const id = `barrel_${i}`;
        this.addEntity(id, { type: 'LOOT', subtype: 'barrel', position: pos });
      }
    }
    
    // Place workbenches
    for (let i = 0; i < counts.workbenches; i++) {
      const pos = this.randomEmptyTile(rng);
      if (pos) {
        const id = `workbench_${i}`;
        this.addEntity(id, { type: 'WORKBENCH', position: pos });
      }
    }
  }

  addEntity(id, entity) {
    this.entities.set(id, entity);
    const [x, y] = entity.position;
    if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
      this.grid[y][x] = id;
    }
  }

  removeEntity(id) {
    const entity = this.entities.get(id);
    if (entity) {
      const [x, y] = entity.position;
      if (this.grid[y]?.[x] === id) {
        this.grid[y][x] = null;
      }
      this.entities.delete(id);
    }
  }

  getEntity(id) {
    return this.entities.get(id) || null;
  }

  placeEntity(id, position) {
    const [x, y] = position;
    this.grid[y][x] = id;
  }

  moveEntity(id, fromPos, toPos) {
    const [fx, fy] = fromPos;
    const [tx, ty] = toPos;
    if (this.grid[fy]?.[fx] === id) {
      this.grid[fy][fx] = null;
    }
    this.grid[ty][tx] = id;
  }

  isBlocked(x, y) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return true;
    const occupant = this.grid[y][x];
    if (!occupant) return false;
    const entity = this.entities.get(occupant);
    if (entity && entity.type === 'BARRICADE') return true;
    if (entity && entity.type === 'RESOURCE') return true;
    return false; // Players can share tiles
  }

  findNearby(position, radius) {
    const [px, py] = position;
    const results = [];
    for (const [id, entity] of this.entities) {
      const [ex, ey] = entity.position;
      if (Math.abs(ex - px) <= radius && Math.abs(ey - py) <= radius) {
        results.push({ id, ...entity });
      }
    }
    return results;
  }

  findAdjacentEmpty(position) {
    const [px, py] = position;
    const dirs = [[0,-1],[0,1],[1,0],[-1,0]];
    for (const [dx, dy] of dirs) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size && !this.grid[ny][nx]) {
        return [nx, ny];
      }
    }
    return null;
  }

  findSpawnPosition(preferred, mapSize) {
    const [px, py] = preferred || [Math.floor(mapSize/2), Math.floor(mapSize/2)];
    // BFS from preferred position for nearest empty tile
    const visited = new Set();
    const queue = [[px, py]];
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) continue;
      if (!this.grid[y][x]) return [x, y];
      queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    return [0, 0]; // Fallback
  }

  getAllEntities() {
    const result = [];
    for (const [id, entity] of this.entities) {
      result.push({ id, ...entity });
    }
    return result;
  }

  getSerializableMap() {
    return {
      size: this.size,
      entities: this.getAllEntities(),
    };
  }

  seededRandom(seed) {
    let s = seed;
    return function() {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  randomEmptyTile(rng) {
    for (let attempts = 0; attempts < 100; attempts++) {
      const x = Math.floor(rng() * this.size);
      const y = Math.floor(rng() * this.size);
      if (!this.grid[y][x]) return [x, y];
    }
    return null;
  }
}

module.exports = WorldState;
```

---

## 7. Combat System (`engine/CombatSystem.js`)

```javascript
const config = require('../config/gameConfig');

class CombatSystem {
  calculateDamage(attacker) {
    const weapon = this.getBestWeapon(attacker);
    const baseDamage = weapon ? config.WEAPON_DAMAGE[weapon] : config.BARE_HANDS_DAMAGE;
    
    // ±10% variance
    const variance = 1 + 0.1 * (Math.random() * 2 - 1);
    return Math.max(1, Math.round(baseDamage * variance));
  }

  getBestWeapon(player) {
    const priority = ['stone-hammer', 'stone-axe', 'stone-pickaxe', 'wooden-club'];
    for (const w of priority) {
      if (player.inventory.some(s => s && s.item === w)) return w;
    }
    return null;
  }
}

module.exports = CombatSystem;
```

---

## 8. Crafting System (`engine/CraftingSystem.js`)

```javascript
const config = require('../config/gameConfig');

class CraftingSystem {
  getRecipe(name) {
    return config.RECIPES[name] || null;
  }

  canCraft(player, recipeName) {
    const recipe = this.getRecipe(recipeName);
    if (!recipe) return false;
    
    for (const [item, qty] of Object.entries(recipe.ingredients)) {
      const have = player.inventory
        .filter(s => s && s.item === item)
        .reduce((sum, s) => sum + s.quantity, 0);
      if (have < qty) return false;
    }
    return true;
  }

  getAvailableRecipes(player) {
    return Object.keys(config.RECIPES).filter(name => this.canCraft(player, name));
  }
}

module.exports = CraftingSystem;
```

---

## 9. Zone Manager (`engine/ZoneManager.js`)

```javascript
class ZoneManager {
  constructor() {
    this.center = [25, 25];
    this.radius = 35;
    this.schedule = [];
    this.currentScheduleIndex = 0;
  }

  init(center, radius, schedule) {
    this.center = center;
    this.radius = radius;
    this.schedule = schedule;
    this.currentScheduleIndex = 0;
  }

  update(tick) {
    if (this.currentScheduleIndex >= this.schedule.length) return null;
    
    const next = this.schedule[this.currentScheduleIndex];
    if (tick >= next.tick) {
      this.radius = next.radius;
      this.currentScheduleIndex++;
      return {
        new_radius: this.radius,
        center: this.center,
        tick,
      };
    }
    return null;
  }

  getState() {
    const nextShrink = this.currentScheduleIndex < this.schedule.length
      ? this.schedule[this.currentScheduleIndex]
      : null;
    
    return {
      center: this.center,
      radius: this.radius,
      next_shrink_tick: nextShrink?.tick || null,
      next_radius: nextShrink?.radius || null,
      damage_per_tick_outside: 10,
    };
  }

  isInsideZone(position) {
    const dx = position[0] - this.center[0];
    const dy = position[1] - this.center[1];
    return Math.sqrt(dx * dx + dy * dy) <= this.radius;
  }
}

module.exports = ZoneManager;
```

---

## 10. Loot Table (`engine/LootTable.js`)

```javascript
const config = require('../config/gameConfig');

class LootTable {
  static rollCrate() {
    return this.weightedRandom(config.CRATE_LOOT_TABLE);
  }

  static rollBarrel() {
    const entry = this.weightedRandom(config.BARREL_LOOT_TABLE);
    const qty = entry.quantity
      ? Math.floor(Math.random() * (entry.quantity[1] - entry.quantity[0] + 1)) + entry.quantity[0]
      : 1;
    return { item: entry.item, quantity: qty };
  }

  static weightedRandom(table) {
    const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of table) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return table[table.length - 1];
  }
}

module.exports = LootTable;
```

---

## 11. API Routes

### 11.1 Join Route (`api/joinRoute.js`)

In Phase 1, the x402 payment is **stubbed** — any wallet address can join for free. Phase 2 adds real blockchain verification.

```javascript
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');

module.exports = function(engine) {
  const router = Router();

  router.post('/', (req, res) => {
    const { wallet_address, tx_hash, session_id, spawn_preference } = req.body;

    if (!wallet_address) {
      return res.status(400).json({ error: 'MISSING_WALLET', message: 'wallet_address required' });
    }

    // Phase 1: Skip payment, add player directly
    // Phase 2: Will add x402 payment verification here
    
    if (!tx_hash) {
      // Step 1: Return payment requirements (stubbed — immediately provide a fake session)
      return res.status(402).json({
        status: 402,
        payment_required: {
          payment_address: '0x0000000000000000000000000000000000000000',
          amount_wei: '1000000000000000000',
          amount_display: '1.0 MON',
          chain_id: 10143,
          rpc_url: 'https://testnet-rpc.monad.xyz/',
          session_id: require('uuid').v4(),
          expires_at: Math.floor(Date.now() / 1000) + 300,
          instructions: 'PHASE_1_STUB: Send any tx_hash to proceed',
        },
      });
    }

    // Step 2: "Verify" payment (stubbed) and add player
    const result = engine.addPlayer(wallet_address, spawn_preference || [25, 25]);
    
    if (result.error) {
      return res.status(400).json(result);
    }

    // Issue JWT
    const token = jwt.sign(
      { agent_id: result.agent_id, wallet_address, game_id: result.game_id },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({
      auth_token: token,
      ...result,
      game_state: engine.getStatus(),
      game_starts_in_seconds: config.LOBBY_DURATION_SECONDS,
    });
  });

  return router;
};
```

### 11.2 State Route (`api/stateRoute.js`)

```javascript
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');

module.exports = function(engine) {
  const router = Router();

  router.get('/', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], config.JWT_SECRET);
      const state = engine.getPlayerState(decoded.agent_id);
      
      if (!state) {
        return res.status(404).json({ error: 'PLAYER_NOT_FOUND' });
      }
      
      return res.json(state);
    } catch (err) {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
  });

  return router;
};
```

### 11.3 Action Route (`api/actionRoute.js`)

```javascript
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');

module.exports = function(engine) {
  const router = Router();

  router.post('/', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], config.JWT_SECRET);
      const action = req.body;

      if (!action || !action.action) {
        return res.status(400).json({ error: 'INVALID_ACTION', message: 'action field required' });
      }

      const validActions = ['MOVE', 'ATTACK', 'HARVEST', 'CRAFT', 'USE', 'TALK', 'IDLE'];
      if (!validActions.includes(action.action)) {
        return res.status(400).json({ error: 'INVALID_ACTION', message: `action must be one of: ${validActions.join(', ')}` });
      }

      const result = engine.queueAction(decoded.agent_id, action);
      
      if (!result.success) {
        return res.status(400).json(result);
      }

      return res.json({
        success: true,
        action_queued: action.action,
        tick_queued: result.tick_queued,
      });
    } catch (err) {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
  });

  return router;
};
```

---

## 12. Testing Plan (Phase 1)

### 12.1 Manual Testing Checklist

Run the server with `npm run dev` and use curl/Postman:

1. **Health check:** `GET /api/health` → Should return `{ status: 'ok', game_state: 'LOBBY_OPEN' }`
2. **Join (step 1):** `POST /api/join` with `{ "wallet_address": "0xTEST1" }` → Should return 402
3. **Join (step 2):** `POST /api/join` with `{ "wallet_address": "0xTEST1", "tx_hash": "0xfake" }` → Should return 200 with JWT
4. **Join 3 players** to hit `MIN_PLAYERS`
5. **Wait for game start** (or join `MAX_PLAYERS` to auto-start)
6. **Get state:** `GET /api/world/state` with Bearer token → Should return fog-of-war state
7. **Send action:** `POST /api/action` with `{ "action": "MOVE", "direction": "N" }` → Should return success
8. **Observe Socket.io:** Connect to `/game` namespace → Should receive `tick` events every 1s

### 12.2 Automated Test Script

Create `test/smoke.js`:

```javascript
const http = require('http');

async function test() {
  const BASE = 'http://localhost:3001';
  
  // Join 3 players
  const tokens = [];
  for (let i = 0; i < 3; i++) {
    // Step 1
    await fetch(`${BASE}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: `0xTEST${i}` }),
    });
    
    // Step 2
    const resp = await fetch(`${BASE}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: `0xTEST${i}`,
        tx_hash: `0xfake${i}`,
        spawn_preference: [10 + i * 10, 10 + i * 10],
      }),
    });
    const data = await resp.json();
    tokens.push(data.auth_token);
    console.log(`Player ${i} joined as ${data.display_name} at ${data.position}`);
  }
  
  // Wait for game to start
  console.log('Waiting for game start...');
  await new Promise(r => setTimeout(r, 3000));
  
  // Check state
  const stateResp = await fetch(`${BASE}/api/world/state`, {
    headers: { 'Authorization': `Bearer ${tokens[0]}` },
  });
  const state = await stateResp.json();
  console.log('Game state:', state.game_state);
  console.log('Tick:', state.tick);
  console.log('Alive:', state.alive_count);
  
  // Move player 0
  const actionResp = await fetch(`${BASE}/api/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokens[0]}`,
    },
    body: JSON.stringify({ action: 'MOVE', direction: 'N' }),
  });
  console.log('Action result:', await actionResp.json());
}

test().catch(console.error);
```

---

## 13. Definition of Done

- [ ] `npm run dev` starts server on port 3001
- [ ] 3+ players can join via stubbed x402 flow
- [ ] Game auto-starts after lobby timer or max players
- [ ] Tick loop runs at 1 tick/sec
- [ ] Players can MOVE, ATTACK, HARVEST, CRAFT, USE, TALK
- [ ] Zone shrinks on schedule, damages outside players
- [ ] AFK players die after 30 ticks
- [ ] Game ends when 1 player remains or 600 ticks pass
- [ ] Socket.io broadcasts tick events to `/game` namespace
- [ ] All game constants are configurable via `gameConfig.js`
