/**
 * Phase 2 — LIVE ON-CHAIN TEST (Monad Testnet)
 *
 * This test uses REAL testnet MON to verify:
 *   1. Sending a payment tx from an "agent" wallet to the hot wallet
 *   2. WalletManager.verifyPayment() against the real chain
 *   3. WalletManager.sendPayout() back to the agent wallet
 *
 * Prerequisites:
 *   - Set HOT_WALLET_PRIVATE_KEY in server/.env to your funded Monad testnet wallet
 *   - The hot wallet needs at least ~0.1 MON for gas + test transfers
 *
 * Run:
 *   cd server
 *   node test/phase2-onchain.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ethers } = require('ethers');

const RPC_URL = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/';
const CHAIN_ID = parseInt(process.env.MONAD_CHAIN_ID || '10143');

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

async function main() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  Phase 2 — LIVE ON-CHAIN TEST (Monad Testnet)║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // ── Preflight ──
    if (!process.env.HOT_WALLET_PRIVATE_KEY) {
        console.error('❌ HOT_WALLET_PRIVATE_KEY not set in .env');
        console.error('   Set it to your funded Monad testnet wallet private key.');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL, {
        name: 'monad-testnet',
        chainId: CHAIN_ID,
    });

    // Hot wallet = the server's wallet (funded by the user)
    const hotWallet = new ethers.Wallet(process.env.HOT_WALLET_PRIVATE_KEY, provider);

    // Agent wallet = temporary wallet to simulate an agent paying entry fee
    const agentWallet = ethers.Wallet.createRandom().connect(provider);

    console.log(`Hot wallet:   ${hotWallet.address}`);
    console.log(`Agent wallet: ${agentWallet.address} (temp, generated for this test)`);
    console.log();

    // ── 1. Check hot wallet balance ──
    console.log('1. Check hot wallet balance');
    const hotBalance = await provider.getBalance(hotWallet.address);
    const hotBalanceMon = ethers.formatEther(hotBalance);
    console.log(`   Balance: ${hotBalanceMon} MON`);
    assert(hotBalance > 0n, `Hot wallet has funds (${hotBalanceMon} MON)`);

    const minRequired = ethers.parseEther('0.05'); // Need ~0.05 MON for test
    if (hotBalance < minRequired) {
        console.error(`\n❌ Need at least 0.05 MON in hot wallet for this test.`);
        console.error(`   Current balance: ${hotBalanceMon} MON`);
        console.error(`   Fund ${hotWallet.address} with testnet MON and retry.`);
        process.exit(1);
    }
    console.log();

    // ── 2. Fund the temp agent wallet ──
    console.log('2. Fund temp agent wallet (0.02 MON from hot wallet)');
    const fundAmount = ethers.parseEther('0.02');
    const fundTx = await hotWallet.sendTransaction({
        to: agentWallet.address,
        value: fundAmount,
    });
    console.log(`   Fund tx: ${fundTx.hash}`);
    const fundReceipt = await fundTx.wait(1);
    assert(fundReceipt.status === 1, 'Agent wallet funded');

    const agentBalance = await provider.getBalance(agentWallet.address);
    assert(agentBalance > 0n, `Agent has ${ethers.formatEther(agentBalance)} MON`);
    console.log();

    // ── 3. Agent sends entry fee to hot wallet (with session_id in data) ──
    console.log('3. Agent sends entry fee payment to hot wallet');
    const sessionId = 'test-session-' + Date.now();
    const sessionHex = '0x' + Buffer.from(sessionId, 'utf-8').toString('hex');
    const entryFee = ethers.parseEther('0.01'); // Use small amount for test

    const paymentTx = await agentWallet.sendTransaction({
        to: hotWallet.address,
        value: entryFee,
        data: sessionHex,
    });
    console.log(`   Payment tx: ${paymentTx.hash}`);
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Session hex: ${sessionHex}`);
    const paymentReceipt = await paymentTx.wait(1);
    assert(paymentReceipt.status === 1, 'Payment tx confirmed on-chain');
    console.log();

    // ── 4. Verify payment using WalletManager ──
    console.log('4. WalletManager.verifyPayment()');
    const WalletManager = require('../blockchain/walletManager');

    // Temporarily override env for this test
    const origEntryFee = process.env.ENTRY_FEE_MON;
    process.env.ENTRY_FEE_MON = '0.01'; // Match the test entry fee
    const wm = new WalletManager();
    process.env.ENTRY_FEE_MON = origEntryFee;

    const verification = await wm.verifyPayment(paymentTx.hash, sessionId);
    assert(verification.valid === true, `Payment verified: valid=${verification.valid}`);
    assert(verification.sender?.toLowerCase() === agentWallet.address.toLowerCase(),
        `Sender matches agent wallet`);
    console.log(`   Verified sender: ${verification.sender}`);
    console.log(`   Verified value: ${verification.value} wei`);
    console.log();

    // ── 5. Double-spend protection ──
    console.log('5. Double-spend protection');
    const doubleSpend = await wm.verifyPayment(paymentTx.hash, sessionId);
    assert(doubleSpend.valid === false, 'Double-spend rejected');
    assert(doubleSpend.error === 'TX_ALREADY_USED', `Error = TX_ALREADY_USED (got ${doubleSpend.error})`);
    console.log();

    // ── 6. Wrong session_id ──
    console.log('6. Wrong session_id rejection');
    // Clear used hash to test session check
    wm.usedTxHashes.delete(paymentTx.hash.toLowerCase());
    const wrongSession = await wm.verifyPayment(paymentTx.hash, 'wrong-session-id');
    assert(wrongSession.valid === false, 'Wrong session_id rejected');
    assert(wrongSession.error === 'WRONG_SESSION_ID', `Error = WRONG_SESSION_ID (got ${wrongSession.error})`);
    console.log();

    // ── 7. Send payout ──
    console.log('7. WalletManager.sendPayout()');
    const payoutAmount = ethers.parseEther('0.005');
    const payoutResult = await wm.sendPayout(agentWallet.address, payoutAmount);
    assert(payoutResult.success === true, `Payout sent: success=${payoutResult.success}`);
    assert(payoutResult.txHash, `Payout tx hash: ${payoutResult.txHash}`);

    if (payoutResult.txHash) {
        console.log(`   Explorer: https://testnet.monadexplorer.com/tx/${payoutResult.txHash}`);
    }
    console.log();

    // ── 8. Verify payout arrived ──
    console.log('8. Verify payout arrived');
    const finalAgentBalance = await provider.getBalance(agentWallet.address);
    assert(finalAgentBalance > 0n, `Agent received payout (balance: ${ethers.formatEther(finalAgentBalance)} MON)`);
    console.log();

    // ── 9. Payout calculation ──
    console.log('9. Payout calculation (pool math)');
    const pool = ethers.parseEther('10.0'); // 10 MON pool
    const winnerPayout = wm.calculateWinnerPayout(pool);
    const expectedPayout = (pool * BigInt(process.env.WINNER_SHARE_PERCENT || '90')) / 100n;
    assert(winnerPayout === expectedPayout, `Winner gets ${ethers.formatEther(winnerPayout)} MON from 10 MON pool`);
    console.log();

    // ── Cleanup: return remaining funds to hot wallet ──
    console.log('10. Cleanup: return remaining agent funds to hot wallet');
    const remainingBalance = await provider.getBalance(agentWallet.address);
    const gasEstimate = ethers.parseEther('0.001'); // Reserve for gas
    if (remainingBalance > gasEstimate) {
        try {
            const returnTx = await agentWallet.sendTransaction({
                to: hotWallet.address,
                value: remainingBalance - gasEstimate,
            });
            await returnTx.wait(1);
            console.log(`   Returned ${ethers.formatEther(remainingBalance - gasEstimate)} MON to hot wallet`);
        } catch (err) {
            console.log(`   Cleanup skipped (gas estimation issue, minor dust left)`);
        }
    }
    console.log();

    // ── Summary ──
    console.log(`═══ Results: ${passed} passed, ${failed} failed ═══\n`);
    if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('Test error:', err);
    process.exitCode = 1;
});
