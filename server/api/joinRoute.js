const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/gameConfig');
const logger = require('../utils/logger');

module.exports = function (engine) {
    const router = Router();

    router.post('/', (req, res) => {
        const { wallet_address, tx_hash, session_id, spawn_preference } = req.body;

        if (!wallet_address || typeof wallet_address !== 'string') {
            return res.status(400).json({ error: 'MISSING_WALLET', message: 'wallet_address is required (string)' });
        }

        // ──────────────────────────────────────────────
        // Step 1: No tx_hash → return 402 Payment Required
        // Phase 1 stub: the "payment" is fake, any tx_hash works.
        // Phase 2 will replace this with real on-chain verification.
        // ──────────────────────────────────────────────
        if (!tx_hash) {
            return res.status(402).json({
                status: 402,
                payment_required: {
                    payment_address: '0x0000000000000000000000000000000000000000',
                    amount_wei: '1000000000000000000',
                    amount_display: '1.0 MON',
                    chain_id: 10143,
                    rpc_url: 'https://testnet-rpc.monad.xyz/',
                    session_id: uuidv4(),
                    expires_at: Math.floor(Date.now() / 1000) + 300,
                    instructions: 'PHASE_1_STUB: Send any tx_hash to proceed',
                },
            });
        }

        // ──────────────────────────────────────────────
        // Step 2: Has tx_hash → "verify" and add player
        // ──────────────────────────────────────────────

        // Validate spawn_preference shape if provided
        let spawn = [25, 25];
        if (Array.isArray(spawn_preference) && spawn_preference.length === 2) {
            const [x, y] = spawn_preference;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                spawn = [Math.floor(x), Math.floor(y)];
            }
        }

        const result = engine.addPlayer(wallet_address, spawn);

        if (result.error) {
            return res.status(400).json(result);
        }

        // Issue JWT
        const token = jwt.sign(
            { agent_id: result.agent_id, wallet_address, game_id: result.game_id },
            config.JWT_SECRET,
            { expiresIn: '1h' }
        );

        logger.info('Join', `${result.display_name} joined (wallet: ${wallet_address.slice(0, 10)}...)`);

        return res.json({
            auth_token: token,
            ...result,
            game_state: engine.getStatus(),
            game_starts_in_seconds: config.LOBBY_DURATION_SECONDS,
        });
    });

    return router;
};
