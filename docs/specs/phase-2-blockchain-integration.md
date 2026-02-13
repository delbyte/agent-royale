# Phase 2 Spec: Blockchain Integration (x402 + Wallet Management)

> **Owner:** Backend/Blockchain Engineer
> **Effort:** ~3 hours
> **Dependencies:** Phase 1 (Game Server must be running with stubbed join flow)
> **Output:** Real x402 payment verification, ethers.js wallet management, automated winner payout on Monad Testnet.

---

## 1. Overview

This phase replaces the stubbed payment in Phase 1 with real Monad Testnet blockchain interactions:

1. **Session management** — Generate and track pending payment sessions
2. **Transaction verification** — Validate on-chain MON transfers via RPC
3. **Winner payout** — Automatically send 90% of the pool to the winner's wallet
4. **Double-spend protection** — Track used transaction hashes

---

## 2. Environment Variables

Add to `server/.env`:

```env
# Monad Testnet
MONAD_RPC_URL=https://testnet-rpc.monad.xyz/
MONAD_CHAIN_ID=10143
HOT_WALLET_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Economy
ENTRY_FEE_MON=1.0
WINNER_SHARE_PERCENT=90
```

---

## 3. Wallet Manager (`server/blockchain/walletManager.js`)

This module handles all ethers.js interactions with the Monad Testnet.

```javascript
const { ethers } = require('ethers');

class WalletManager {
  constructor() {
    this.rpcUrl = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/';
    this.chainId = parseInt(process.env.MONAD_CHAIN_ID || '10143');
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, {
      name: 'monad-testnet',
      chainId: this.chainId,
    });
    
    // Hot wallet — receives entry fees, sends payouts
    const privateKey = process.env.HOT_WALLET_PRIVATE_KEY;
    if (!privateKey) {
      console.warn('[Wallet] WARNING: HOT_WALLET_PRIVATE_KEY not set. Using random wallet for dev.');
      this.wallet = ethers.Wallet.createRandom().connect(this.provider);
    } else {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
    
    console.log(`[Wallet] Hot wallet address: ${this.wallet.address}`);
    
    // Entry fee in wei (1 MON = 10^18 wei)
    const entryFeeMon = parseFloat(process.env.ENTRY_FEE_MON || '1.0');
    this.entryFeeWei = ethers.parseEther(entryFeeMon.toString());
    
    // Track used tx hashes to prevent double-spend
    this.usedTxHashes = new Set();
  }

  getHotWalletAddress() {
    return this.wallet.address;
  }

  getEntryFeeWei() {
    return this.entryFeeWei;
  }

  /**
   * Verify an on-chain transaction meets our payment requirements.
   * 
   * Checks:
   * 1. Transaction exists and is confirmed (>= 1 confirmation)
   * 2. Recipient is our hot wallet
   * 3. Value is >= entry fee
   * 4. Transaction data contains the expected session_id
   * 5. Transaction hash has not been used before
   * 
   * @param {string} txHash - The transaction hash to verify
   * @param {string} expectedSessionId - The session ID that should be in tx data
   * @returns {Promise<{valid: boolean, error?: string, sender?: string}>}
   */
  async verifyPayment(txHash, expectedSessionId) {
    // Check double-spend
    if (this.usedTxHashes.has(txHash)) {
      return { valid: false, error: 'TX_ALREADY_USED' };
    }
    
    try {
      // Get transaction with retry logic
      let tx = null;
      let receipt = null;
      
      for (let attempt = 0; attempt < 10; attempt++) {
        tx = await this.provider.getTransaction(txHash);
        if (tx) {
          receipt = await this.provider.getTransactionReceipt(txHash);
          if (receipt && receipt.status === 1) break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      
      if (!tx) {
        return { valid: false, error: 'TX_NOT_FOUND' };
      }
      
      if (!receipt || receipt.status !== 1) {
        return { valid: false, error: 'TX_NOT_CONFIRMED' };
      }
      
      // Check recipient
      if (tx.to?.toLowerCase() !== this.wallet.address.toLowerCase()) {
        return { valid: false, error: 'WRONG_RECIPIENT' };
      }
      
      // Check value
      if (tx.value < this.entryFeeWei) {
        return {
          valid: false,
          error: 'INSUFFICIENT_PAYMENT',
          message: `Expected ${ethers.formatEther(this.entryFeeWei)} MON, got ${ethers.formatEther(tx.value)} MON`,
        };
      }
      
      // Check session ID in tx data
      if (expectedSessionId) {
        const expectedHex = '0x' + Buffer.from(expectedSessionId, 'utf-8').toString('hex');
        if (tx.data?.toLowerCase() !== expectedHex.toLowerCase()) {
          return { valid: false, error: 'WRONG_SESSION_ID' };
        }
      }
      
      // Mark tx as used
      this.usedTxHashes.add(txHash);
      
      return {
        valid: true,
        sender: tx.from,
        value: tx.value.toString(),
      };
      
    } catch (err) {
      console.error('[Wallet] Verification error:', err.message);
      return { valid: false, error: 'VERIFICATION_FAILED', message: err.message };
    }
  }

  /**
   * Send MON payout to the winner.
   * 
   * @param {string} toAddress - Winner's wallet address
   * @param {bigint} amountWei - Amount to send in wei
   * @returns {Promise<{success: boolean, txHash?: string, error?: string}>}
   */
  async sendPayout(toAddress, amountWei) {
    try {
      console.log(`[Wallet] Sending payout: ${ethers.formatEther(amountWei)} MON to ${toAddress}`);
      
      const tx = await this.wallet.sendTransaction({
        to: toAddress,
        value: amountWei,
      });
      
      console.log(`[Wallet] Payout tx submitted: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      if (receipt.status === 1) {
        console.log(`[Wallet] Payout confirmed: ${tx.hash}`);
        return { success: true, txHash: tx.hash };
      } else {
        return { success: false, error: 'TX_REVERTED' };
      }
    } catch (err) {
      console.error('[Wallet] Payout error:', err.message);
      return { success: false, error: 'PAYOUT_FAILED', message: err.message };
    }
  }

  /**
   * Calculate winner payout from pool.
   * @param {bigint} poolWei - Total pool in wei
   * @returns {bigint} Winner's share in wei
   */
  calculateWinnerPayout(poolWei) {
    const sharePercent = parseInt(process.env.WINNER_SHARE_PERCENT || '90');
    return (poolWei * BigInt(sharePercent)) / 100n;
  }

  /**
   * Get hot wallet balance.
   * @returns {Promise<string>} Balance in MON (human-readable)
   */
  async getBalance() {
    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }
}

module.exports = WalletManager;
```

---

## 4. x402 Middleware (`server/blockchain/x402Middleware.js`)

Manages pending payment sessions with TTL.

```javascript
const { v4: uuidv4 } = require('uuid');

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
   */
  createSession(walletAddress) {
    const sessionId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 300; // 5 minutes
    
    this.pendingSessions.set(sessionId, {
      walletAddress,
      createdAt: now,
      expiresAt,
    });
    
    // Also cleanup after TTL
    setTimeout(() => this.pendingSessions.delete(sessionId), 300_000);
    
    return { sessionId, expiresAt };
  }

  /**
   * Validate and consume a session ID.
   * Returns the associated wallet address if valid.
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
    
    if (session.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return { valid: false, error: 'WALLET_MISMATCH' };
    }
    
    // Consume — cannot reuse
    this.pendingSessions.delete(sessionId);
    return { valid: true };
  }

  cleanup() {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, session] of this.pendingSessions) {
      if (now > session.expiresAt) {
        this.pendingSessions.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

module.exports = X402Middleware;
```

---

## 5. Updated Join Route (`api/joinRoute.js`)

Replace the Phase 1 stubbed version with real blockchain verification:

```javascript
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/gameConfig');

module.exports = function(engine, walletManager, x402) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { wallet_address, tx_hash, session_id, spawn_preference } = req.body;

    if (!wallet_address) {
      return res.status(400).json({ error: 'MISSING_WALLET', message: 'wallet_address required' });
    }

    // --- STEP 1: No tx_hash → Return 402 payment requirements ---
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

    // --- STEP 2: tx_hash provided → Verify payment and join ---
    
    if (!session_id) {
      return res.status(400).json({ error: 'MISSING_SESSION_ID' });
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
    const result = engine.addPlayer(wallet_address, spawn_preference || [25, 25]);
    
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

    return res.json({
      auth_token: token,
      ...result,
      game_state: engine.getStatus(),
      game_starts_in_seconds: config.LOBBY_DURATION_SECONDS,
    });
  });

  return router;
};
```

---

## 6. Pool Management & Payout Integration

Add these methods to `GameEngine.js`:

```javascript
// Add to GameEngine constructor:
this.walletManager = null; // Set externally after construction

// New method:
addToPool(amountWei) {
  this.pool += amountWei;
  console.log(`[Engine] Pool increased. Total: ${ethers.formatEther(this.pool)} MON`);
}

// Modify endGame() to trigger payout:
async endGame(alivePlayers) {
  clearInterval(this.tickInterval);
  this.status = STATES.GAME_OVER;
  
  let winner = null;
  if (alivePlayers.length === 1) {
    winner = alivePlayers[0];
  } else if (alivePlayers.length > 1) {
    alivePlayers.sort((a, b) => (b.hp !== a.hp ? b.hp - a.hp : b.kills - a.kills));
    winner = alivePlayers[0];
  }

  let payoutTxHash = null;
  
  // Send payout if winner exists and pool > 0 and wallet manager is available
  if (winner && this.pool > 0n && this.walletManager) {
    const winnerPayout = this.walletManager.calculateWinnerPayout(this.pool);
    const payoutResult = await this.walletManager.sendPayout(winner.walletAddress, winnerPayout);
    if (payoutResult.success) {
      payoutTxHash = payoutResult.txHash;
      console.log(`[Engine] Payout sent: ${ethers.formatEther(winnerPayout)} MON to ${winner.walletAddress}`);
    } else {
      console.error(`[Engine] Payout FAILED: ${payoutResult.error}`);
    }
  }

  const result = {
    winner: winner ? {
      id: winner.id,
      display_name: winner.displayName,
      wallet_address: winner.walletAddress,
      hp: winner.hp,
      kills: winner.kills,
    } : null,
    total_ticks: this.tick,
    kill_log: this.killLog,
    pool_wei: this.pool.toString(),
    pool_display: `${ethers.formatEther(this.pool)} MON`,
    payout_tx_hash: payoutTxHash,
    payout_explorer_url: payoutTxHash 
      ? `https://testnet.monadexplorer.com/tx/${payoutTxHash}`
      : null,
  };

  this.io.of('/game').emit('game_over', result);
  setTimeout(() => this.start(), 30_000);
  return result;
}
```

---

## 7. Updated `index.js` Wiring

```javascript
// Add to index.js:
const WalletManager = require('./blockchain/walletManager');
const X402Middleware = require('./blockchain/x402Middleware');

const walletManager = new WalletManager();
const x402 = new X402Middleware();

// Inject wallet manager into engine for payouts
engine.walletManager = walletManager;

// Update route mounting:
app.use('/api/join', joinRoute(engine, walletManager, x402));

// Add wallet info endpoint:
app.get('/api/wallet/info', async (req, res) => {
  const balance = await walletManager.getBalance();
  res.json({
    hot_wallet_address: walletManager.getHotWalletAddress(),
    balance_mon: balance,
    entry_fee_mon: process.env.ENTRY_FEE_MON || '1.0',
    chain_id: parseInt(process.env.MONAD_CHAIN_ID || '10143'),
    rpc_url: process.env.MONAD_RPC_URL,
  });
});
```

---

## 8. npm Dependencies (Phase 2 Addition)

```bash
cd server
npm install ethers
```

Only `ethers` is new. All other deps (`express`, `socket.io`, `cors`, `dotenv`, `uuid`, `jsonwebtoken`) were installed in Phase 1.

---

## 9. Dev Mode: Bypassing Blockchain

For local development without real Monad tokens, set this env var:

```env
DEV_SKIP_PAYMENT=true
```

Add to `joinRoute.js` at the top of the handler:

```javascript
if (process.env.DEV_SKIP_PAYMENT === 'true' && !tx_hash) {
  // Dev mode: skip payment, auto-join
  const result = engine.addPlayer(wallet_address, spawn_preference || [25, 25]);
  if (result.error) return res.status(400).json(result);
  
  const token = jwt.sign(
    { agent_id: result.agent_id, wallet_address, game_id: result.game_id },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  return res.json({ auth_token: token, ...result, game_state: engine.getStatus() });
}
```

This lets you run the full game loop without needing testnet tokens during development.

---

## 10. Wallet Setup for Demo

### 10.1 Your Main Wallet

You have 1 wallet with 10 MON on Monad Testnet. This is the **funding source** for demo bots.

### 10.2 Hot Wallet

Generate a separate hot wallet for the game server:

```bash
node -e "const {ethers} = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('Address:', w.address); console.log('Private Key:', w.privateKey);"
```

Save the private key as `HOT_WALLET_PRIVATE_KEY` in `.env`. Fund it with 0.5 MON for gas (payout transactions).

### 10.3 Agent Wallets

The Python SDK (Phase 3) includes scripts to generate and fund agent wallets. Each agent wallet needs `1.0 MON` (entry fee) + `~0.01 MON` (gas for the payment transaction).

---

## 11. Security Considerations

| Risk | Mitigation |
|---|---|
| **Private key exposure** | `HOT_WALLET_PRIVATE_KEY` loaded from env var, never committed to git. `.env` is in `.gitignore`. |
| **Double spend** | `usedTxHashes` Set prevents reusing the same tx hash for multiple joins. |
| **Session hijacking** | Session IDs are UUIDv4 (128-bit). Sessions expire in 5 minutes. Consumed on use. |
| **Replay attack** | JWT includes `game_id` — tokens are scoped to a single game instance. |
| **Insufficient payout funds** | Check hot wallet balance before payout. Log warning if insufficient. |
| **RPC rate limiting** | Retry with exponential backoff. Use dedicated RPC node if at-scale. |

---

## 12. Testing Plan

1. **Unit test WalletManager.verifyPayment()** — Mock ethers provider, test all failure modes
2. **Unit test X402Middleware** — Create session, consume, expire, double-consume
3. **Integration test: Full join flow on Monad Testnet** — Use a funded test wallet, send 1 MON, verify server accepts
4. **Integration test: Payout** — Complete a game, verify winner receives MON
5. **Check Monad Explorer** — Verify transactions appear on `https://testnet.monadexplorer.com/`

---

## 13. Definition of Done

- [ ] `ethers.js` connected to Monad Testnet RPC
- [ ] `POST /api/join` returns real 402 with hot wallet address
- [ ] Server verifies on-chain MON transfer (to, value, data, confirmations)
- [ ] Session IDs → 5-minute TTL, consumed on use
- [ ] Double-spend protection via tx hash tracking
- [ ] Winner receives 90% payout automatically on game end
- [ ] Payout tx hash included in `game_over` Socket.io event
- [ ] `DEV_SKIP_PAYMENT=true` bypasses blockchain for local dev
- [ ] `GET /api/wallet/info` returns hot wallet balance and config
