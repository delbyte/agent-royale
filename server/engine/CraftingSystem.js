const config = require('../config/gameConfig');

class CraftingSystem {
    getRecipe(name) {
        return config.RECIPES[name] || null;
    }

    /**
     * Check if a player has enough resources to craft a recipe.
     */
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

    /**
     * Returns the list of recipe names the player can currently afford to craft.
     */
    getAvailableRecipes(player) {
        return Object.keys(config.RECIPES).filter(name => this.canCraft(player, name));
    }
}

module.exports = CraftingSystem;
