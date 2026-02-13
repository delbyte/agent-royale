const config = require('../config/gameConfig');

class LootTable {
    /**
     * Roll a random item from a loot crate.
     * Returns { item: string, quantity: number }
     */
    static rollCrate() {
        const entry = this.weightedRandom(config.CRATE_LOOT_TABLE);
        // Crate items are single items (weapons/potions), quantity = 1
        return { item: entry.item, quantity: 1 };
    }

    /**
     * Roll a random item from a barrel.
     * Returns { item: string, quantity: number }
     */
    static rollBarrel() {
        const entry = this.weightedRandom(config.BARREL_LOOT_TABLE);
        // Barrels drop resources with a random quantity range
        const qty = entry.quantity
            ? Math.floor(Math.random() * (entry.quantity[1] - entry.quantity[0] + 1)) + entry.quantity[0]
            : 1;
        return { item: entry.item, quantity: qty };
    }

    /**
     * Weighted random selection from a table of { item, weight, ... } entries.
     */
    static weightedRandom(table) {
        const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const entry of table) {
            roll -= entry.weight;
            if (roll <= 0) return entry;
        }
        return table[table.length - 1]; // Fallback to last entry (float rounding)
    }
}

module.exports = LootTable;
