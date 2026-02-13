const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');
const logger = require('../utils/logger');

/**
 * Join route with full x402 payment flow.
 *
 * Phase 2: Real blockchain verification via WalletManager + X402Middleware.
 * DEV_SKIP_PAYMENT=true bypasses blockchain for local dev (Phase 1 backward compat).
 *
 * @param {import('../engine/GameEngine')} engine
 * @param {import('../blockchain/walletManager')} walletManager
 * @param {import('../blockchain/x402Middleware')} x402
 */
module.exports = function (engine, walletManager, x402) {
    const router = Router();

    router.post('/', async (req, res) => {
        const { wallet_address, tx_hash, session_id, spawn_preference } = req.body;

        if (!wallet_address || typeof wallet_address !== 'string') {
            return res.status(400).json({ error: 'MISSING_WALLET', message: 'wallet_address is required (string)' });
        }

        // Validate spawn_preference shape
        let spawn = [25, 25];
        if (Array.isArray(spawn_preference) && spawn_preference.length === 2) {
            const [x, y] = spawn_preference;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                spawn = [Math.floor(x), Math.floor(y)];
            }
        }

        // ──────────────────────────────────────────────
        // DEV MODE: Skip blockchain entirely
        // ──────────────────────────────────────────────
        if (process.env.DEV_SKIP_PAYMENT === 'true' && !tx_hash) {
            const result = engine.addPlayer(wallet_address, spawn);
            if (result.error) return res.status(400).json(result);

            const token = jwt.sign(
                { agent_id: result.agent_id, wallet_address, game_id: result.game_id },
                config.JWT_SECRET,
                { expiresIn: '1h' }
            );

            logger.info('Join', `[DEV] ${result.display_name} joined (wallet: ${wallet_address.slice(0, 10)}...)`);

            return res.json({
                auth_token: token,
                ...result,
                game_state: engine.getStatus(),
                game_starts_in_seconds: config.LOBBY_DURATION_SECONDS,
            });
        }

        // ──────────────────────────────────────────────
        // STEP 1: No tx_hash → Return 402 Payment Required
        // ──────────────────────────────────────────────
        if (!tx_hash) {
            const session = x402.createSession(wallet_address);

            return res.status(402).json({
                status: 402,
                payment_required: {
                    payment_address: walletManager.getHotWalletAddress(),
                    amount_wei: walletManager.getEntryFeeWei().toString(),
                    amount_display: `${process.env.ENTRY_FEE_MON || '1.0'} MON`,
                    chain_id: parseInt(process.env.MONAD_CHAIN_ID || '10143'),
                    rpc_url: process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/',
                    session_id: session.sessionId,
                    expires_at: session.expiresAt,
                    instructions: 'Send the specified amount of MON to payment_address. Encode the session_id as UTF-8 hex (0x prefix) in the transaction data field. Then retry this endpoint with tx_hash and session_id.',
                },
            });
        }

        // ──────────────────────────────────────────────
        // STEP 2: tx_hash provided → Verify payment and join
        // ──────────────────────────────────────────────

        if (!session_id) {
            return res.status(400).json({ error: 'MISSING_SESSION_ID', message: 'session_id is required when tx_hash is provided' });
        }

        // Validate session
        const sessionResult = x402.consumeSession(session_id, wallet_address);
        if (!sessionResult.valid) {
            return res.status(400).json({ error: sessionResult.error });
        }

        // Verify on-chain payment
        const verification = await walletManager.verifyPayment(tx_hash, session_id);
        if (!verification.valid) {
            return res.status(400).json({
                error: verification.error,
                message: verification.message || 'Payment verification failed',
            });
        }

        // Payment verified — add player to game
        const result = engine.addPlayer(wallet_address, spawn);

        if (result.error) {
            return res.status(400).json(result);
        }

        // Track payment in pool
        engine.addToPool(walletManager.getEntryFeeWei());

        // Issue JWT
        const token = jwt.sign(
            { agent_id: result.agent_id, wallet_address, game_id: result.game_id },
            config.JWT_SECRET,
            { expiresIn: '1h' }
        );

        logger.info('Join', `${result.display_name} joined (wallet: ${wallet_address.slice(0, 10)}..., tx: ${tx_hash.slice(0, 12)}...)`);

        return res.json({
            auth_token: token,
            ...result,
            game_state: engine.getStatus(),
            game_starts_in_seconds: config.LOBBY_DURATION_SECONDS,
        });
    });

    return router;
};
