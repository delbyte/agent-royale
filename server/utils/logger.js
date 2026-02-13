/**
 * Simple timestamped logger.
 * Provides info/warn/error with ISO timestamps and component tags.
 */

function timestamp() {
    return new Date().toISOString();
}

const logger = {
    info(tag, ...args) {
        console.log(`[${timestamp()}] [${tag}]`, ...args);
    },
    warn(tag, ...args) {
        console.warn(`[${timestamp()}] [${tag}] ⚠`, ...args);
    },
    error(tag, ...args) {
        console.error(`[${timestamp()}] [${tag}] ✖`, ...args);
    },
};

module.exports = logger;
