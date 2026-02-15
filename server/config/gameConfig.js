module.exports = {
  // Server
  PORT: parseInt(process.env.PORT || '3001'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-key',

  // Map
  MAP_SIZE: parseInt(process.env.MAP_SIZE || '50'), // 50×50 grid

  // Game
  TICK_RATE_MS: parseInt(process.env.TICK_RATE_MS || '1000'),
  MAX_GAME_TICKS: 600, // 10 minutes at 1 tick/sec
  MIN_PLAYERS: parseInt(process.env.MIN_PLAYERS || '3'),
  MAX_PLAYERS: parseInt(process.env.MAX_PLAYERS || '20'),
  LOBBY_DURATION_SECONDS: parseInt(process.env.LOBBY_DURATION_SECONDS || '120'),
  LOBBY_GRACE_AFTER_MIN_SECONDS: parseInt(process.env.LOBBY_GRACE_AFTER_MIN_SECONDS || '8'),

  // Player
  PLAYER_MAX_HP: 100,
  PLAYER_MAX_STAMINA: 100,
  PLAYER_INVENTORY_SLOTS: 5,
  PLAYER_VISION_RADIUS: 15, // Chebyshev distance
  STAMINA_REGEN_PER_TICK: 0, // Stamina mechanic disabled
  STAMINA_COST_MOVE: 0,
  STAMINA_COST_ATTACK: 0,
  STAMINA_COST_HARVEST: 0,
  BARE_HANDS_DAMAGE: 1,
  AFK_KILL_TICKS: 30, // 30 ticks on same tile = wolf kill
  MAX_RESOURCE_STACK: 20, // Max quantity per inventory slot
  CHAT_COOLDOWN_TICKS: 3, // Min ticks between messages
  CHAT_MAX_LENGTH: 200,

  // Zone
  ZONE_CENTER: [25, 25],
  ZONE_INITIAL_RADIUS: 35,
  ZONE_DAMAGE_PER_TICK: 10,
  ZONE_SHRINK_SCHEDULE: [
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
    'wooden-club':   { ingredients: { wood: 5 },             result: { item: 'wooden-club',   damage: 8 } },
    'stone-axe':     { ingredients: { wood: 10, stone: 5 },  result: { item: 'stone-axe',     damage: 15, harvestBonus: 'tree' } },
    'stone-pickaxe': { ingredients: { wood: 10, stone: 5 },  result: { item: 'stone-pickaxe', damage: 12, harvestBonus: 'rock' } },
    'stone-hammer':  { ingredients: { wood: 10, stone: 10 }, result: { item: 'stone-hammer',  damage: 20 } },
    'barricade':     { ingredients: { wood: 5 },             result: { item: 'barricade',     placeable: true, hp: 30 } },
    'health-potion': { ingredients: { wood: 5, stone: 3 },   result: { item: 'health-potion', healAmount: 30 } },
  },

  // Weapon Damage Table
  WEAPON_DAMAGE: {
    'wooden-club': 8,
    'stone-axe': 15,
    'stone-pickaxe': 12,
    'stone-hammer': 20,
  },

  // Harvest Tool Bonuses (2x harvest damage on matching resource)
  HARVEST_BONUS: {
    'stone-axe': 'tree',
    'stone-pickaxe': 'rock',
  },

  // Loot tables (weighted random)
  CRATE_LOOT_TABLE: [
    { item: 'stone-axe', weight: 20 },
    { item: 'stone-pickaxe', weight: 20 },
    { item: 'wooden-club', weight: 30 },
    { item: 'health-potion', weight: 30 },
  ],
  BARREL_LOOT_TABLE: [
    { item: 'wood', quantity: [1, 3], weight: 50 },
    { item: 'stone', quantity: [1, 3], weight: 50 },
  ],
};
