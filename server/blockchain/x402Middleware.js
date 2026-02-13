const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * X402 Payment Session Manager.
 *
 * Manages the x402 "Payment Required" flow:
 * 1. Agent requests to join → server creates a session with a 5-min TTL
 * 2. Agent sends MON on-chain with the session_id in tx data
 * 3. Agent re-requests join with tx_hash → server consumes the session
 *
 * Sessions are consumed on use (single-use tokens).
 */
class X402Middleware {
    constructor() {
        // Map<sessionId, { walletAddress, createdAt, expiresAt }>
        this.pendingSessions = new Map();

        // Clean up expired sessions every 60 seconds
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    }

    /**
     * Create a new payment session for a wallet address.
     * Sessions expire after 5 minutes.
     *
     * @param {string} walletAddress - The agent's wallet address
     * @returns {{ sessionId: string, expiresAt: number }}
     */
    createSession(walletAddress) {
        const sessionId = uuidv4();
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 300; // 5 minutes

        this.pendingSessions.set(sessionId, {
            walletAddress: walletAddress.toLowerCase(),
            createdAt: now,
            expiresAt,
        });

        // Auto-cleanup after TTL as a safety net
        setTimeout(() => this.pendingSessions.delete(sessionId), 300_000);

        logger.info('x402', `Session created for ${walletAddress.slice(0, 10)}... (expires in 5 min)`);

        return { sessionId, expiresAt };
    }

    /**
     * Validate and consume a session ID.
     * Returns success if the session is valid, not expired, and wallet matches.
     * The session is deleted on consumption (single-use).
     *
     * @param {string} sessionId - The session ID to validate
     * @param {string} walletAddress - The wallet claiming the session
     * @returns {{ valid: boolean, error?: string }}
     */
    consumeSession(sessionId, walletAddress) {
        const session = this.pendingSessions.get(sessionId);

        if (!session) {
            return { valid: false, error: 'SESSION_NOT_FOUND' };
        }

        const now = Math.floor(Date.now() / 1000);
        if (now > session.expiresAt) {
            this.pendingSessions.delete(sessionId);
            return { valid: false, error: 'SESSION_EXPIRED' };
        }

        if (session.walletAddress !== walletAddress.toLowerCase()) {
            return { valid: false, error: 'WALLET_MISMATCH' };
        }

        // Consume — single-use, cannot be reused
        this.pendingSessions.delete(sessionId);
        return { valid: true };
    }

    /**
     * Get the count of pending sessions (for diagnostics).
     * @returns {number}
     */
    getPendingCount() {
        return this.pendingSessions.size;
    }

    /**
     * Remove all expired sessions.
     */
    cleanup() {
        const now = Math.floor(Date.now() / 1000);
        let cleaned = 0;
        for (const [id, session] of this.pendingSessions) {
            if (now > session.expiresAt) {
                this.pendingSessions.delete(id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger.info('x402', `Cleaned up ${cleaned} expired session(s)`);
        }
    }

    /**
     * Destroy the middleware (clear interval).
     * Call on server shutdown.
     */
    destroy() {
        clearInterval(this.cleanupInterval);
    }
}

module.exports = X402Middleware;
