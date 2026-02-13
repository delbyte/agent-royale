/**
 * Phase 2 Smoke Test — Blockchain Integration
 *
 * Tests are split into:
 *   Part A: Unit tests (no server required) — X402Middleware, WalletManager basics
 *   Part B: Integration tests (server must be running with DEV_SKIP_PAYMENT=true)
 *
 * Run:
 *   node test/phase2-smoke.js            # Unit tests only
 *   node test/phase2-smoke.js --server   # Unit + integration tests (server must be on :3001)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`  ✖ FAIL: ${message}`);
        failed++;
    } else {
        console.log(`  ✔ ${message}`);
        passed++;
    }
}

// ══════════════════════════════════════════════════════════
// PART A: Unit Tests (no server)
// ══════════════════════════════════════════════════════════

async function unitTests() {
    console.log('\n═══ Phase 2 — Unit Tests ═══\n');

    // ── X402Middleware ──
    console.log('A1. X402Middleware — Session Lifecycle');
    const X402Middleware = require('../blockchain/x402Middleware');
    const x402 = new X402Middleware();

    // Create session
    const session = x402.createSession('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    assert(session.sessionId && session.sessionId.length > 0, 'Session ID created');
    assert(session.expiresAt > Math.floor(Date.now() / 1000), 'Session has future expiry');
    assert(x402.getPendingCount() === 1, `Pending count = 1 (got ${x402.getPendingCount()})`);

    // Consume session — wrong wallet
    const wrongWallet = x402.consumeSession(session.sessionId, '0xWRONG_WALLET');
    assert(!wrongWallet.valid, 'Rejects wrong wallet');
    assert(wrongWallet.error === 'WALLET_MISMATCH', `Error = WALLET_MISMATCH (got ${wrongWallet.error})`);

    // Consume session — correct wallet
    const consumed = x402.consumeSession(session.sessionId, '0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    assert(consumed.valid, 'Accepts correct wallet');
    assert(x402.getPendingCount() === 0, `Pending count = 0 after consumption (got ${x402.getPendingCount()})`);

    // Double-consume
    const double = x402.consumeSession(session.sessionId, '0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    assert(!double.valid, 'Rejects double consumption');
    assert(double.error === 'SESSION_NOT_FOUND', `Error = SESSION_NOT_FOUND (got ${double.error})`);

    // Non-existent session
    const ghost = x402.consumeSession('not-a-real-uuid', '0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    assert(!ghost.valid, 'Rejects non-existent session');
    console.log();

    // ── X402Middleware — Expired Session ──
    console.log('A2. X402Middleware — Expired Session');
    // Manually inject an expired session
    const expiredId = 'expired-session-test';
    x402.pendingSessions.set(expiredId, {
        walletAddress: '0xtest',
        createdAt: Math.floor(Date.now() / 1000) - 600,
        expiresAt: Math.floor(Date.now() / 1000) - 300, // expired 5 min ago
    });
    const expired = x402.consumeSession(expiredId, '0xtest');
    assert(!expired.valid, 'Rejects expired session');
    assert(expired.error === 'SESSION_EXPIRED', `Error = SESSION_EXPIRED (got ${expired.error})`);

    x402.destroy(); // Cleanup interval
    console.log();

    // ── WalletManager ──
    console.log('A3. WalletManager — Construction & Calculations');
    const WalletManager = require('../blockchain/walletManager');
    const wm = new WalletManager();

    assert(wm.getHotWalletAddress().startsWith('0x'), `Hot wallet address starts with 0x`);
    assert(wm.getHotWalletAddress().length === 42, `Hot wallet address is 42 chars`);
    assert(wm.getEntryFeeWei() > 0n, `Entry fee > 0`);

    // Payout calculation
    const pool = 10000000000000000000n; // 10 MON in wei
    const payout = wm.calculateWinnerPayout(pool);
    // Default WINNER_SHARE_PERCENT=90
    const expectedPayout = (pool * 90n) / 100n;
    assert(payout === expectedPayout, `Payout = 90% of pool (${payout} === ${expectedPayout})`);

    // Double-spend tracking
    wm.usedTxHashes.add('0xtest_tx_1234');
    assert(wm.usedTxHashes.has('0xtest_tx_1234'), 'Used tx hash is tracked');
    console.log();

    console.log('A4. WalletManager — Entry Fee from ENV');
    const { ethers } = require('ethers');
    const expected = ethers.parseEther(process.env.ENTRY_FEE_MON || '1.0');
    assert(wm.getEntryFeeWei() === expected, `Entry fee matches ENTRY_FEE_MON env (${ethers.formatEther(wm.getEntryFeeWei())} MON)`);
    console.log();
}

// ══════════════════════════════════════════════════════════
// PART B: Integration Tests (server must be running)
// ══════════════════════════════════════════════════════════

async function integrationTests() {
    const BASE = 'http://localhost:3001';

    console.log('═══ Phase 2 — Integration Tests (DEV_SKIP_PAYMENT) ═══\n');

    async function get(url) {
        const resp = await fetch(url);
        return { status: resp.status, data: await resp.json() };
    }

    async function post(url, body, headers = {}) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        });
        return { status: resp.status, data: await resp.json() };
    }

    // ── B1. Wallet Info Endpoint ──
    console.log('B1. GET /api/wallet/info');
    const walletInfo = await get(`${BASE}/api/wallet/info`);
    assert(walletInfo.status === 200, `Status 200 (got ${walletInfo.status})`);
    assert(walletInfo.data.hot_wallet_address, `Has hot_wallet_address`);
    assert(walletInfo.data.entry_fee_wei, `Has entry_fee_wei`);
    assert(walletInfo.data.entry_fee_mon, `Has entry_fee_mon`);
    assert(walletInfo.data.winner_share_percent, `Has winner_share_percent`);
    assert(walletInfo.data.chain_id === 10143, `Chain ID = 10143`);
    assert(walletInfo.data.dev_skip_payment === true, `DEV_SKIP_PAYMENT = true`);
    console.log();

    // ── B2. Health Check ──
    console.log('B2. Health check');
    const health = await get(`${BASE}/api/health`);
    assert(health.status === 200, `Status 200`);
    assert(health.data.status === 'ok', 'Server OK');
    assert(health.data.pool_wei === '0', `Pool starts at 0 (got ${health.data.pool_wei})`);
    console.log();

    // ── B3. Dev Skip Join ──
    console.log('B3. Dev-mode join (DEV_SKIP_PAYMENT=true)');
    const wallet = `0xTEST_PHASE2_${Date.now()}`;
    const join = await post(`${BASE}/api/join`, { wallet_address: wallet });
    assert(join.status === 200, `Direct join succeeds (status ${join.status})`);
    assert(join.data.auth_token, 'Got JWT');
    assert(join.data.agent_id, `Got agent_id: ${join.data.agent_id}`);
    assert(join.data.display_name, `Got display_name: ${join.data.display_name}`);
    console.log();

    // ── B4. Pool remains 0 in dev mode ──
    console.log('B4. Pool unchanged in dev mode');
    const health2 = await get(`${BASE}/api/health`);
    assert(health2.data.pool_wei === '0', `Pool still 0 in dev mode (got ${health2.data.pool_wei})`);
    console.log();
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

async function main() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  Protocol: SURVIVAL — Phase 2 Smoke Test     ║');
    console.log('╚══════════════════════════════════════════════╝');

    await unitTests();

    if (process.argv.includes('--server')) {
        await integrationTests();
    } else {
        console.log('ℹ Skipping integration tests (run with --server flag when server is on :3001)\n');
    }

    console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
    if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('Test runner error:', err);
    process.exitCode = 1;
});
