require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config/gameConfig');
const GameEngine = require('./engine/GameEngine');
const WalletManager = require('./blockchain/walletManager');
const X402Middleware = require('./blockchain/x402Middleware');
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

// Initialize blockchain modules
let walletManager;
try {
    walletManager = new WalletManager();
} catch (err) {
    if (process.env.DEV_SKIP_PAYMENT === 'true') {
        logger.warn('Server', `WalletManager init failed in DEV mode; continuing without on-chain features. (${err.message})`);
        walletManager = {
            getHotWalletAddress: () => '0x0000000000000000000000000000000000000000',
            getEntryFeeWei: () => 0n,
            getBalance: async () => '0',
        };
    } else {
        throw err;
    }
}
const x402 = new X402Middleware();

// Initialize game engine & inject wallet manager for payouts
const engine = new GameEngine(io);
engine.walletManager = walletManager;

// Mount API routes — inject engine + blockchain dependencies
app.use('/api/join', joinRoute(engine, walletManager, x402));
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

// Wallet info endpoint — diagnostics & agent-facing payment config
app.get('/api/wallet/info', async (req, res) => {
    try {
        if (!walletManager) {
            return res.status(503).json({
                error: 'WALLET_UNAVAILABLE',
                message: 'Wallet manager is not initialized',
            });
        }
        const balance = await walletManager.getBalance();
        res.json({
            hot_wallet_address: walletManager.getHotWalletAddress(),
            balance_mon: balance,
            entry_fee_wei: walletManager.getEntryFeeWei().toString(),
            entry_fee_mon: process.env.ENTRY_FEE_MON || '1.0',
            winner_share_percent: parseInt(process.env.WINNER_SHARE_PERCENT || '90'),
            chain_id: parseInt(process.env.MONAD_CHAIN_ID || '10143'),
            rpc_url: process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/',
            dev_skip_payment: process.env.DEV_SKIP_PAYMENT === 'true',
        });
    } catch (err) {
        logger.error('API', `Wallet info error: ${err.message}`);
        res.status(500).json({ error: 'WALLET_INFO_FAILED', message: err.message });
    }
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
    if (process.env.DEV_SKIP_PAYMENT === 'true') {
        logger.warn('Server', 'DEV_SKIP_PAYMENT=true — blockchain verification disabled');
    }
    engine.start(); // Begin the lobby
});
