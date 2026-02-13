const config = require('../config/gameConfig');

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

    /**
     * Called every tick. Returns a shrink event if the zone shrank this tick, else null.
     */
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
            next_shrink_tick: nextShrink ? nextShrink.tick : null,
            next_radius: nextShrink ? nextShrink.radius : null,
            damage_per_tick_outside: config.ZONE_DAMAGE_PER_TICK,
        };
    }

    /**
     * Check if a position is inside the safe zone (Euclidean distance).
     */
    isInsideZone(position) {
        const dx = position[0] - this.center[0];
        const dy = position[1] - this.center[1];
        return Math.sqrt(dx * dx + dy * dy) <= this.radius;
    }
}

module.exports = ZoneManager;
