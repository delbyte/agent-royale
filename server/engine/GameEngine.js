const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const config = require('../config/gameConfig');
const WorldState = require('./WorldState');
const CombatSystem = require('./CombatSystem');
const CraftingSystem = require('./CraftingSystem');
const ZoneManager = require('./ZoneManager');
const LootTable = require('./LootTable');
const names = require('../config/names');
const logger = require('../utils/logger');

const STATES = {
    LOBBY_OPEN: 'LOBBY_OPEN',
    GAME_ACTIVE: 'GAME_ACTIVE',
    GAME_OVER: 'GAME_OVER',
};

class GameEngine {
    constructor(io) {
        this.io = io;
        this.gameId = uuidv4();
        this.status = STATES.LOBBY_OPEN;
        this.tick = 0;
        this.tickInterval = null;
        this.lobbyTimeout = null;
        this.minStartTimeout = null;

        // Subsystems
        this.world = new WorldState(config.MAP_SIZE);
        this.combat = new CombatSystem();
        this.crafting = new CraftingSystem();
        this.zone = new ZoneManager();
        this.lastZoneWarningTick = null;

        // Player tracking
        this.players = new Map();       // agentId -> PlayerState
        this.actionQueue = new Map();   // agentId -> action (consumed per tick)
        this.usedNames = new Set();
        this.killLog = [];
        this.chatLog = [];

        // Pool tracking (in wei as BigInt)
        this.pool = 0n;

        // Wallet manager — set externally after construction for payout support
        this.walletManager = null;
    }

    // ─────────────────────────────────────
    // STATE MACHINE
    // ─────────────────────────────────────

    start() {
        this.status = STATES.LOBBY_OPEN;
        this.gameId = uuidv4();
        this.tick = 0;
        clearTimeout(this.minStartTimeout);
        this.minStartTimeout = null;
        this.players.clear();
        this.actionQueue.clear();
        this.usedNames.clear();
        this.killLog = [];
        this.chatLog = [];
        this.pool = 0n;
        this.lastZoneWarningTick = null;
        this.world.reset();

        logger.info('Engine', `Game ${this.gameId} — Lobby open`);
        this.scheduleLobbyCheck();
    }

    /**
     * Schedule a lobby check. If min players are met → start game.
     * Otherwise, keep extending the lobby without resetting players.
     *
     * BUG FIX: The spec called this.start() on extension, which would clear
     * all joined players. We now re-schedule the check instead.
     */
    scheduleLobbyCheck() {
        clearTimeout(this.lobbyTimeout);
        clearTimeout(this.minStartTimeout);
        this.lobbyTimeout = setTimeout(() => {
            if (this.status !== STATES.LOBBY_OPEN) return; // Guard against race
            if (this.players.size >= config.MIN_PLAYERS) {
                this.startGame();
            } else {
                logger.warn('Engine', `Not enough players (${this.players.size}/${config.MIN_PLAYERS}). Extending lobby...`);
                this.scheduleLobbyCheck(); // Re-check, don't reset
            }
        }, config.LOBBY_DURATION_SECONDS * 1000);
    }

    startGame() {
        if (this.status !== STATES.LOBBY_OPEN) return;
        clearTimeout(this.lobbyTimeout);
        clearTimeout(this.minStartTimeout);

        this.status = STATES.GAME_ACTIVE;
        this.tick = 0;

        // IMPORTANT ORDER: Reserve player spawn tiles FIRST, then generate world.
        // This prevents the world generator from placing trees/rocks on top of
        // player spawn positions.
        for (const [id, player] of this.players) {
            this.world.placePlayer(id, player.position);
        }

        // Generate the world (will avoid occupied tiles)
        const seed = Date.now();
        this.world.generate(seed, {
            trees: config.NUM_TREES,
            rocks: config.NUM_ROCKS,
            crates: config.NUM_CRATES,
            barrels: config.NUM_BARRELS,
            workbenches: config.NUM_WORKBENCHES,
        });

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

        logger.info('Engine', `Game ${this.gameId} — STARTED with ${this.players.size} players`);

        // Start tick loop
        this.tickInterval = setInterval(() => this.gameTick(), config.TICK_RATE_MS);
    }

    gameTick() {
        this.tick++;

        // 0. Zone warning announcements (e.g., 10s before shrink)
        this.emitZoneCountdownWarning();

        // 1. Process all queued actions
        this.processActions();

        // 2. Apply zone shrinking
        const shrinkEvent = this.zone.update(this.tick);
        if (shrinkEvent) {
            this.io.of('/game').emit('zone_shrink', shrinkEvent);
        }

        // 3. Apply zone damage to players outside safe zone
        this.applyZoneDamage();

        // 4. Check AFK (wolf mechanic)
        this.checkAFK();

        // 5. Check for winner
        const alivePlayers = this.getAlivePlayers();
        if (alivePlayers.length <= 1 || this.tick >= config.MAX_GAME_TICKS) {
            this.endGame(alivePlayers);
            return;
        }

        // 6. Broadcast tick state to all spectators
        this.broadcastTick();

        // 7. Clear action queue for next tick
        this.actionQueue.clear();
    }

    emitZoneCountdownWarning() {
        const zoneState = this.zone.getState();
        if (!zoneState || zoneState.next_shrink_tick == null || zoneState.next_radius == null) return;

        const secondsUntil = zoneState.next_shrink_tick - this.tick;
        if (secondsUntil === 10 && this.lastZoneWarningTick !== this.tick) {
            this.lastZoneWarningTick = this.tick;
            this.io.of('/game').emit('zone_warning', {
                tick: this.tick,
                seconds_remaining: 10,
                next_radius: zoneState.next_radius,
            });
        }
    }

    async endGame(alivePlayers) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
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

        let payoutTxHash = null;

        // Send payout if winner exists and pool > 0 and wallet manager is available
        if (winner && this.pool > 0n && this.walletManager) {
            try {
                const winnerPayout = this.walletManager.calculateWinnerPayout(this.pool);
                logger.info('Engine', `Attempting payout: ${ethers.formatEther(winnerPayout)} MON to ${winner.walletAddress}`);
                const payoutResult = await this.walletManager.sendPayout(winner.walletAddress, winnerPayout);
                if (payoutResult.success) {
                    payoutTxHash = payoutResult.txHash;
                    logger.info('Engine', `Payout sent: ${ethers.formatEther(winnerPayout)} MON → ${payoutTxHash}`);
                } else {
                    logger.error('Engine', `Payout FAILED: ${payoutResult.error}`);
                }
            } catch (err) {
                logger.error('Engine', `Payout exception: ${err.message}`);
            }
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
            pool_display: this.pool > 0n ? `${ethers.formatEther(this.pool)} MON` : '0 MON',
            payout_tx_hash: payoutTxHash,
            payout_explorer_url: payoutTxHash
                ? `https://testnet.monadexplorer.com/tx/${payoutTxHash}`
                : null,
        };

        logger.info('Engine', `Game ${this.gameId} — OVER. Winner: ${winner?.displayName || 'none'}`);
        this.io.of('/game').emit('game_over', result);

        // Reset after 30 seconds
        setTimeout(() => this.start(), 30_000);

        return result;
    }

    /**
     * Add an entry fee payment to the prize pool.
     * @param {bigint} amountWei - Amount in wei to add
     */
    addToPool(amountWei) {
        this.pool += amountWei;
        logger.info('Engine', `Pool increased. Total: ${ethers.formatEther(this.pool)} MON`);
    }

    // ─────────────────────────────────────
    // PLAYER MANAGEMENT
    // ─────────────────────────────────────

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

        const agentId = `agent_${walletAddress.slice(-8)}_${this.players.size}`;
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
            lastAction: null,
            lastActionTick: null,
            lastActionTarget: null,
        };

        this.players.set(agentId, player);

        // Reserve the spawn tile on the grid so other players don't get the same spot
        this.world.placePlayer(agentId, position);

        // Broadcast updated lobby snapshot immediately so spectators can see
        // live join count (e.g., 0/10 -> 1/10 -> ...), even before GAME_ACTIVE.
        this.io.of('/game').emit('sync', this.getFullState());

        logger.info('Engine', `${displayName} (${agentId}) joined at [${position}]`);

        // Auto-start immediately when lobby is full.
        if (this.players.size >= config.MAX_PLAYERS) {
            try {
                this.startGame();
            } catch (err) {
                logger.error('Engine', `startGame failed: ${err.stack || err.message}`);
            }
        } else if (
            this.players.size >= config.MIN_PLAYERS
            && !this.minStartTimeout
            && this.status === STATES.LOBBY_OPEN
        ) {
            // Grace period: allow additional joins after min players are reached.
            this.minStartTimeout = setTimeout(() => {
                this.minStartTimeout = null;
                if (this.status === STATES.LOBBY_OPEN && this.players.size >= config.MIN_PLAYERS) {
                    this.startGame();
                }
            }, config.LOBBY_GRACE_AFTER_MIN_SECONDS * 1000);
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
        // Fallback if all 20 names are taken
        return `Agent_${this.players.size + 1}`;
    }

    // ─────────────────────────────────────
    // ACTION PROCESSING
    // ─────────────────────────────────────

    queueAction(agentId, action) {
        if (this.status !== STATES.GAME_ACTIVE) {
            return { success: false, error: 'GAME_NOT_ACTIVE' };
        }
        const player = this.players.get(agentId);
        if (!player || !player.alive) {
            return { success: false, error: 'PLAYER_NOT_ALIVE' };
        }
        // Only accept the first action per tick
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
                // Track attempted action for frontend animation cues.
                player.lastAction = action.action;
                player.lastActionTick = this.tick;
                player.lastActionTarget = action.target_id || null;

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
                        break; // Intentional no-op
                    default:
                        logger.warn('Engine', `Unknown action from ${agentId}: ${action.action}`);
                }
            } catch (err) {
                logger.error('Engine', `Error processing action for ${agentId}: ${err.message}`);
            }
        }
    }

    processMove(player, action) {
        const DIRECTIONS = {
            'N': [0, -1], 'S': [0, 1], 'E': [1, 0], 'W': [-1, 0],
            'NE': [1, -1], 'NW': [-1, -1], 'SE': [1, 1], 'SW': [-1, 1],
        };

        const delta = DIRECTIONS[action.direction];
        if (!delta) return false;

        const newX = player.position[0] + delta[0];
        const newY = player.position[1] + delta[1];

        // Bounds + collision check (barricades and resources block movement)
        if (this.world.isBlocked(newX, newY)) return false;

        this.world.moveEntity(player.id, player.position, [newX, newY]);
        player.position = [newX, newY];
        player.stamina = config.PLAYER_MAX_STAMINA;
        return true;
    }

    processAttack(player, action) {
        if (!action.target_id) return false;

        // Target can be another player or a world entity (barricade)
        const targetPlayer = this.players.get(action.target_id);
        const targetEntity = this.world.getEntity(action.target_id);

        if (!targetPlayer && !targetEntity) return false;

        // Determine target position for adjacency check
        const targetPos = targetPlayer ? targetPlayer.position : targetEntity.position;
        const dx = Math.abs(player.position[0] - targetPos[0]);
        const dy = Math.abs(player.position[1] - targetPos[1]);
        if (dx > 1 || dy > 1) return false; // Must be within 1 tile (melee)

        player.stamina = config.PLAYER_MAX_STAMINA;
        const damage = this.combat.calculateDamage(player);
        const weaponUsed = this.combat.getBestWeapon(player);

        if (targetPlayer) {
            // Attacking another player
            if (!targetPlayer.alive) return false;
            targetPlayer.hp = Math.max(0, targetPlayer.hp - damage);

            this.io.of('/game').emit('damage', {
                tick: this.tick,
                attacker_id: player.id,
                attacker_name: player.displayName,
                target_id: targetPlayer.id,
                target_name: targetPlayer.displayName,
                damage,
                target_hp: targetPlayer.hp,
                weapon: weaponUsed,
            });

            if (targetPlayer.hp <= 0) {
                this.eliminatePlayer(targetPlayer, player, 'combat');
            }
        } else if (targetEntity && targetEntity.type === 'BARRICADE') {
            // Attacking a barricade
            targetEntity.hp -= damage;
            if (targetEntity.hp <= 0) {
                this.world.removeEntity(action.target_id);
            }
        } else {
            return false;
        }
        // Attacking trees/rocks/workbenches via ATTACK does nothing intentionally
        // — use HARVEST for resources
        return true;
    }

    /**
     * Process a HARVEST action. Handles both:
     * - RESOURCE entities (trees, rocks): progressive HP damage, drop materials
     * - LOOT entities (crates, barrels): instant open, roll loot table
     *
     * The spec's original code only handled RESOURCE, leaving crates/barrels
     * uninteractable. This is fixed here.
     */
    processHarvest(player, action) {
        if (!action.target_id) return false;

        const entity = this.world.getEntity(action.target_id);
        if (!entity) return false;

        // Adjacency check (Chebyshev distance ≤ 1)
        const dx = Math.abs(player.position[0] - entity.position[0]);
        const dy = Math.abs(player.position[1] - entity.position[1]);
        if (dx > 1 || dy > 1) return false;

        player.stamina = config.PLAYER_MAX_STAMINA;

        if (entity.type === 'RESOURCE') {
            // Progressive harvest (trees & rocks)
            let harvestDamage = 10; // base
            const heldTool = this.getHeldWeapon(player);
            const bonusTarget = heldTool ? config.HARVEST_BONUS[heldTool] : null;
            const matchesTree = bonusTarget === 'tree' && entity.subtype?.startsWith('tree');
            const matchesRock = bonusTarget === 'rock' && entity.subtype?.startsWith('rock');
            if (matchesTree || matchesRock) {
                harvestDamage = 20; // 2× bonus for matching tool
            }

            entity.hp -= harvestDamage;

            // Drop resources on each hit
            const dropItem = entity.subtype.startsWith('tree') ? 'wood' : 'stone';
            const dropQty = entity.hp <= 0 ? 3 : 1; // More on destroy
            this.addToInventory(player, dropItem, dropQty);

            if (entity.hp <= 0) {
                this.world.removeEntity(action.target_id);
            }
        } else if (entity.type === 'LOOT') {
            // Instant open: crates drop weapons/potions, barrels drop resources
            let loot;
            if (entity.subtype === 'chest') {
                loot = LootTable.rollCrate();
            } else {
                loot = LootTable.rollBarrel();
            }
            this.addToInventory(player, loot.item, loot.quantity);
            this.world.removeEntity(action.target_id);
        } else {
            return false;
        }
        // WORKBENCH: can't be harvested (no-op if targeted)
        return true;
    }

    processCraft(player, action) {
        if (!action.recipe) return false;
        const recipe = config.RECIPES[action.recipe];
        if (!recipe) return false;

        // Check near workbench (Chebyshev distance ≤ 2)
        const nearWorkbench = this.world.findNearby(player.position, 2)
            .some(e => e.type === 'WORKBENCH');
        if (!nearWorkbench) return false;

        // Check ingredients
        for (const [item, qty] of Object.entries(recipe.ingredients)) {
            if (this.countInInventory(player, item) < qty) return false;
        }

        // Consume ingredients
        for (const [item, qty] of Object.entries(recipe.ingredients)) {
            this.removeFromInventory(player, item, qty);
        }

        // Produce result
        if (recipe.result.placeable) {
            // Place barricade at an adjacent empty tile
            const barricadePos = this.world.findAdjacentEmpty(player.position);
            if (barricadePos) {
                const barricadeId = `barricade_${this.tick}_${player.id}`;
                this.world.addEntity(barricadeId, {
                    type: 'BARRICADE',
                    position: barricadePos,
                    hp: recipe.result.hp,
                });
            }
            // If no adjacent empty tile, crafting still consumes materials (intentional penalty)
        } else {
            this.addToInventory(player, recipe.result.item, 1);
        }
        return true;
    }

    processUse(player, action) {
        const slot = action.item_slot;
        if (typeof slot !== 'number' || slot < 0 || slot >= config.PLAYER_INVENTORY_SLOTS) return false;

        const item = player.inventory[slot];
        if (!item) return false;

        if (item.item === 'health-potion') {
            player.hp = Math.min(config.PLAYER_MAX_HP, player.hp + 30);
            player.inventory[slot] = null;
            return true;
        }
        // Future: other consumables can be added here
        return false;
    }

    processTalk(player, action) {
        if (!action.message || typeof action.message !== 'string') return false;
        if (action.message.length > config.CHAT_MAX_LENGTH) return false;
        if (this.tick - player.lastChatTick < config.CHAT_COOLDOWN_TICKS) return false;

        player.lastChatTick = this.tick;

        const chatEvent = {
            from: player.id,
            from_name: player.displayName,
            text: action.message,
            position: [...player.position],
            tick: this.tick,
        };

        this.chatLog.push(chatEvent);
        this.io.of('/game').emit('chat', chatEvent);
        return true;
    }

    // ─────────────────────────────────────
    // ZONE DAMAGE
    // ─────────────────────────────────────

    applyZoneDamage() {
        for (const [, player] of this.players) {
            if (!player.alive) continue;

            if (!this.zone.isInsideZone(player.position)) {
                player.hp -= config.ZONE_DAMAGE_PER_TICK;
                if (player.hp <= 0) {
                    player.hp = 0;
                    this.eliminatePlayer(player, null, 'zone');
                }
            }
        }
    }

    // ─────────────────────────────────────
    // AFK DETECTION (Wolf Mechanic)
    // ─────────────────────────────────────

    checkAFK() {
        for (const [, player] of this.players) {
            if (!player.alive) continue;

            const queuedAction = this.actionQueue.get(player.id);
            const activeAction = queuedAction
                && ['MOVE', 'ATTACK', 'HARVEST', 'CRAFT', 'USE', 'TALK'].includes(queuedAction.action);

            if (player.position[0] === player.lastPosition[0] &&
                player.position[1] === player.lastPosition[1]) {
                if (activeAction) {
                    // Attacking/harvesting/crafting counts as active play;
                    // avoid false AFK eliminations during prolonged fights.
                    player.idleTicks = 0;
                } else {
                    player.idleTicks++;
                }
            } else {
                player.idleTicks = 0;
                player.lastPosition = [...player.position];
            }

            if (player.idleTicks >= config.AFK_KILL_TICKS) {
                this.eliminatePlayer(player, null, 'wolves');
            }
        }
    }

    // ─────────────────────────────────────
    // ELIMINATION
    // ─────────────────────────────────────

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
            position: [...victim.position],
        };

        if (killer) {
            killer.kills++;
        }

        // Remove player from the grid (items are lost on death for simplicity)
        this.world.removePlayer(victim.id, victim.position);

        this.killLog.push(killEvent);
        this.io.of('/game').emit('kill', killEvent);

        logger.info('Engine', `${victim.displayName} eliminated by ${cause}${killer ? ` (killed by ${killer.displayName})` : ''}`);
    }

    // ─────────────────────────────────────
    // INVENTORY HELPERS
    // ─────────────────────────────────────

    addToInventory(player, item, quantity) {
        const isWeapon = !!config.WEAPON_DAMAGE[item] || item === 'health-potion';

        // First try to stack with existing (only for stackable resources)
        if (!isWeapon) {
            for (let i = 0; i < player.inventory.length; i++) {
                const slot = player.inventory[i];
                if (slot && slot.item === item) {
                    slot.quantity = Math.min(config.MAX_RESOURCE_STACK, slot.quantity + quantity);
                    return true;
                }
            }
        }
        // Then find an empty slot
        for (let i = 0; i < player.inventory.length; i++) {
            if (!player.inventory[i]) {
                player.inventory[i] = { item, quantity };
                return true;
            }
        }
        return false; // Inventory full — item is lost
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
        // Return the best weapon in inventory (highest damage priority)
        const weapons = ['stone-hammer', 'stone-axe', 'stone-pickaxe', 'wooden-club'];
        for (const w of weapons) {
            if (player.inventory.some(s => s && s.item === w)) return w;
        }
        return null;
    }

    // ─────────────────────────────────────
    // BROADCASTING
    // ─────────────────────────────────────

    broadcastTick() {
        const fullState = this.getFullState();
        this.io.of('/game').emit('tick', fullState);
    }

    // ─────────────────────────────────────
    // STATE GETTERS
    // ─────────────────────────────────────

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
                last_action: p.lastAction,
                last_action_tick: p.lastActionTick,
                last_action_target: p.lastActionTarget,
            })),
            entities: this.world.getAllEntities(),
            zone: this.zone.getState(),
            alive_count: this.getAlivePlayers().length,
            kill_log: this.killLog.slice(-10),
            chat_log: this.chatLog.slice(-20),
        };
    }

    /**
     * Returns fog-of-war filtered state for a specific agent.
     * Only includes entities and players within PLAYER_VISION_RADIUS (Chebyshev).
     */
    getPlayerState(agentId) {
        const player = this.players.get(agentId);
        if (!player) return null;

        // Nearby world entities (within vision)
        const nearbyEntities = this.world.findNearby(player.position, config.PLAYER_VISION_RADIUS);

        // Nearby other players (fog of war)
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

        // Recent chat messages from within vision
        const recentMessages = this.chatLog
            .filter(m => m.tick >= this.tick - 5)
            .filter(m => {
                const dx = Math.abs(m.position[0] - player.position[0]);
                const dy = Math.abs(m.position[1] - player.position[1]);
                return dx <= config.PLAYER_VISION_RADIUS && dy <= config.PLAYER_VISION_RADIUS;
            });

        // Recent kill events (globally visible — fog doesn't hide death announcements)
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
                last_action: player.lastAction,
                last_action_tick: player.lastActionTick,
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
