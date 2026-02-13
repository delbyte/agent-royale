const config = require('../config/gameConfig');

class WorldState {
    constructor(size) {
        this.size = size;
        // grid[y][x] holds the entity ID occupying that tile (or null)
        this.grid = Array.from({ length: size }, () => new Array(size).fill(null));
        this.entities = new Map(); // entityId -> entity data
    }

    /**
     * Populate the world with resources, loot, and workbenches using seeded RNG.
     * Must be called AFTER reserving player spawn tiles on the grid.
     */
    generate(seed, counts) {
        const rng = this.seededRandom(seed);

        // Place trees
        for (let i = 0; i < counts.trees; i++) {
            const pos = this.randomEmptyTile(rng);
            if (!pos) continue;
            const id = `tree_${i}`;
            // Alternate between tree variants for visual variety
            const subtype = rng() > 0.5 ? 'tree' : 'tree-pine';
            this.addEntity(id, { type: 'RESOURCE', subtype, position: pos, hp: config.TREE_HP });
        }

        // Place rocks
        for (let i = 0; i < counts.rocks; i++) {
            const pos = this.randomEmptyTile(rng);
            if (!pos) continue;
            const id = `rock_${i}`;
            const subtype = rng() > 0.5 ? 'rock-a' : 'rock-b';
            this.addEntity(id, { type: 'RESOURCE', subtype, position: pos, hp: config.ROCK_HP });
        }

        // Place loot crates (1-hit open, drops weapon/potion)
        for (let i = 0; i < counts.crates; i++) {
            const pos = this.randomEmptyTile(rng);
            if (!pos) continue;
            const id = `crate_${i}`;
            this.addEntity(id, { type: 'LOOT', subtype: 'chest', position: pos });
        }

        // Place barrels (1-hit open, drops resources)
        for (let i = 0; i < counts.barrels; i++) {
            const pos = this.randomEmptyTile(rng);
            if (!pos) continue;
            const id = `barrel_${i}`;
            this.addEntity(id, { type: 'LOOT', subtype: 'barrel', position: pos });
        }

        // Place workbenches (needed for crafting, within 2 tiles)
        for (let i = 0; i < counts.workbenches; i++) {
            const pos = this.randomEmptyTile(rng);
            if (!pos) continue;
            const id = `workbench_${i}`;
            this.addEntity(id, { type: 'WORKBENCH', position: pos });
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
        if (!entity) return;
        const [x, y] = entity.position;
        // Only clear the grid if this entity still occupies that cell
        // (guards against double-removes or overwritten cells)
        if (y >= 0 && y < this.size && x >= 0 && x < this.size && this.grid[y][x] === id) {
            this.grid[y][x] = null;
        }
        this.entities.delete(id);
    }

    getEntity(id) {
        return this.entities.get(id) || null;
    }

    /**
     * Reserve a grid cell for a player (players are tracked in GameEngine.players,
     * NOT in this.entities, to keep entity queries clean).
     */
    placePlayer(id, position) {
        const [x, y] = position;
        if (y >= 0 && y < this.size && x >= 0 && x < this.size) {
            this.grid[y][x] = id;
        }
    }

    /**
     * Clear a player from the grid (used on elimination).
     */
    removePlayer(id, position) {
        const [x, y] = position;
        if (y >= 0 && y < this.size && x >= 0 && x < this.size && this.grid[y][x] === id) {
            this.grid[y][x] = null;
        }
    }

    moveEntity(id, fromPos, toPos) {
        const [fx, fy] = fromPos;
        const [tx, ty] = toPos;
        if (fy >= 0 && fy < this.size && fx >= 0 && fx < this.size && this.grid[fy][fx] === id) {
            this.grid[fy][fx] = null;
        }
        if (ty >= 0 && ty < this.size && tx >= 0 && tx < this.size) {
            this.grid[ty][tx] = id;
        }
    }

    /**
     * Check if a tile is blocked (barricades and resource nodes block movement).
     * Players and walkable entities (loot, workbenches) do NOT block.
     */
    isBlocked(x, y) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return true;
        const occupant = this.grid[y][x];
        if (!occupant) return false;
        const entity = this.entities.get(occupant);
        // If occupant is a player (not in entities map) → not blocked (players share tiles)
        if (!entity) return false;
        return entity.type === 'BARRICADE' || entity.type === 'RESOURCE';
    }

    /**
     * Find all world entities within Chebyshev distance of a position.
     */
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

    /**
     * Find the first adjacent empty tile (cardinal directions only).
     */
    findAdjacentEmpty(position) {
        const [px, py] = position;
        const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size && !this.grid[ny][nx]) {
                return [nx, ny];
            }
        }
        return null;
    }

    /**
     * BFS from a preferred position to find the nearest empty tile.
     * Used to assign spawn positions that avoid collisions.
     */
    findSpawnPosition(preferred, mapSize) {
        const [px, py] = preferred || [Math.floor(mapSize / 2), Math.floor(mapSize / 2)];
        // Clamp preferred position to valid range
        const startX = Math.max(0, Math.min(mapSize - 1, px));
        const startY = Math.max(0, Math.min(mapSize - 1, py));

        const visited = new Set();
        const queue = [[startX, startY]];

        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const key = `${x},${y}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) continue;
            if (!this.grid[y][x]) return [x, y];
            // Expand BFS in cardinal directions
            queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
        return [0, 0]; // Fallback — should never happen on a 50×50 grid
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

    /**
     * Reset the grid and entities for a new game round.
     */
    reset() {
        this.grid = Array.from({ length: this.size }, () => new Array(this.size).fill(null));
        this.entities.clear();
    }

    // --- Seeded PRNG (Lehmer / Park-Miller) ---

    seededRandom(seed) {
        let s = seed % 2147483647;
        if (s <= 0) s += 2147483646;
        return function () {
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
