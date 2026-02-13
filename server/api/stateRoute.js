const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');

module.exports = function (engine) {
    const router = Router();

    router.get('/', (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
        }

        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, config.JWT_SECRET);
            const state = engine.getPlayerState(decoded.agent_id);

            if (!state) {
                return res.status(404).json({ error: 'PLAYER_NOT_FOUND', message: 'No player found for this token' });
            }

            return res.json(state);
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Auth token has expired' });
            }
            return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Failed to verify auth token' });
        }
    });

    return router;
};
