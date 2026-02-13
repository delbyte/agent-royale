const config = require('../config/gameConfig');

class CombatSystem {
    /**
     * Calculate damage dealt by an attacker based on their best weapon.
     * Bare hands = 1 dmg. Weapons get ±10% variance.
     */
    calculateDamage(attacker) {
        const weapon = this.getBestWeapon(attacker);
        const baseDamage = weapon ? config.WEAPON_DAMAGE[weapon] : config.BARE_HANDS_DAMAGE;

        // ±10% random variance (minimum 1 damage)
        const variance = 1 + 0.1 * (Math.random() * 2 - 1);
        return Math.max(1, Math.round(baseDamage * variance));
    }

    /**
     * Returns the highest-damage weapon in the player's inventory.
     * Priority: stone-hammer (20) > stone-axe (15) > stone-pickaxe (12) > wooden-club (8)
     */
    getBestWeapon(player) {
        const priority = ['stone-hammer', 'stone-axe', 'stone-pickaxe', 'wooden-club'];
        for (const w of priority) {
            if (player.inventory.some(s => s && s.item === w)) return w;
        }
        return null;
    }
}

module.exports = CombatSystem;
