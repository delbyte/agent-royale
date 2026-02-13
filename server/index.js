require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config/gameConfig');
const GameEngine = require('./engine/GameEngine');
const joinRoute = require('./api/joinRoute');
const stateRoute = require('./api/stateRoute');
const actionRoute = require('./api/actionRoute');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Initialize game engine
const engine = new GameEngine(io);

// Mount API routes — inject engine dependency
app.use('/api/join', joinRoute(engine));
app.use('/api/world/state', stateRoute(engine));
app.use('/api/action', actionRoute(engine));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        game_id: engine.getGameId(),
        game_state: engine.getStatus(),
        tick: engine.getCurrentTick(),
        players: engine.getPlayerCount(),
        alive: engine.getAlivePlayers().length,
        pool_wei: engine.getPool().toString(),
    });
});

// Socket.io connection handling (spectator namespace)
io.of('/game').on('connection', (socket) => {
    logger.info('Socket', `Spectator connected: ${socket.id}`);

    // Send current state on connect
    socket.emit('sync', engine.getFullState());

    socket.on('disconnect', () => {
        logger.info('Socket', `Spectator disconnected: ${socket.id}`);
    });
});

// Start server
server.listen(config.PORT, () => {
    logger.info('Server', `Protocol: SURVIVAL running on port ${config.PORT}`);
    engine.start(); // Begin the lobby
});
