const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');

const VALID_ACTIONS = new Set(['MOVE', 'ATTACK', 'HARVEST', 'CRAFT', 'USE', 'TALK', 'IDLE']);

module.exports = function (engine) {
    const router = Router();

    router.post('/', (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
        }

        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, config.JWT_SECRET);
            const action = req.body;

            if (!action || typeof action.action !== 'string') {
                return res.status(400).json({ error: 'INVALID_ACTION', message: 'action field required (string)' });
            }

            if (!VALID_ACTIONS.has(action.action)) {
                return res.status(400).json({
                    error: 'INVALID_ACTION',
                    message: `action must be one of: ${[...VALID_ACTIONS].join(', ')}`,
                });
            }

            const result = engine.queueAction(decoded.agent_id, action);

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.json({
                success: true,
                action_queued: action.action,
                tick_queued: result.tick_queued,
            });
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Auth token has expired' });
            }
            return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Failed to verify auth token' });
        }
    });

    return router;
};
