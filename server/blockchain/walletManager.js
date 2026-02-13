const { ethers } = require('ethers');
const logger = require('../utils/logger');

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
            logger.warn('Wallet', 'HOT_WALLET_PRIVATE_KEY not set. Using random wallet for dev.');
            this.wallet = ethers.Wallet.createRandom().connect(this.provider);
        } else {
            this.wallet = new ethers.Wallet(privateKey, this.provider);
        }

        logger.info('Wallet', `Hot wallet address: ${this.wallet.address}`);

        // Entry fee in wei (1 MON = 10^18 wei)
        const entryFeeMon = parseFloat(process.env.ENTRY_FEE_MON || '1.0');
        this.entryFeeWei = ethers.parseEther(entryFeeMon.toString());

        // Winner share percentage
        this.winnerSharePercent = parseInt(process.env.WINNER_SHARE_PERCENT || '90');

        // Track used tx hashes to prevent double-spend (in-memory, resets on restart)
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
     * 1. Transaction hash not already used (double-spend protection)
     * 2. Transaction exists and is confirmed (>= 1 confirmation)
     * 3. Recipient is our hot wallet
     * 4. Value is >= entry fee
     * 5. Transaction data contains the expected session_id (UTF-8 hex)
     *
     * @param {string} txHash - The transaction hash to verify
     * @param {string} expectedSessionId - The session ID that should be in tx data
     * @returns {Promise<{valid: boolean, error?: string, message?: string, sender?: string, value?: string}>}
     */
    async verifyPayment(txHash, expectedSessionId) {
        if (this.usedTxHashes.has(txHash.toLowerCase())) {
            return { valid: false, error: 'TX_ALREADY_USED' };
        }

        try {
            // Poll for transaction with retry logic (Monad has fast blocks ~1s)
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

            // Check recipient is our hot wallet
            if (tx.to?.toLowerCase() !== this.wallet.address.toLowerCase()) {
                return { valid: false, error: 'WRONG_RECIPIENT' };
            }

            // Check value is >= entry fee
            if (tx.value < this.entryFeeWei) {
                return {
                    valid: false,
                    error: 'INSUFFICIENT_PAYMENT',
                    message: `Expected ${ethers.formatEther(this.entryFeeWei)} MON, got ${ethers.formatEther(tx.value)} MON`,
                };
            }

            // Check session_id embedded in tx data (UTF-8 encoded as hex)
            if (expectedSessionId) {
                const expectedHex = '0x' + Buffer.from(expectedSessionId, 'utf-8').toString('hex');
                if (tx.data?.toLowerCase() !== expectedHex.toLowerCase()) {
                    return { valid: false, error: 'WRONG_SESSION_ID' };
                }
            }

            // Mark tx as used — prevents replay
            this.usedTxHashes.add(txHash.toLowerCase());

            return {
                valid: true,
                sender: tx.from,
                value: tx.value.toString(),
            };
        } catch (err) {
            logger.error('Wallet', `Verification error: ${err.message}`);
            return { valid: false, error: 'VERIFICATION_FAILED', message: err.message };
        }
    }

    /**
     * Send MON payout to the winner.
     *
     * @param {string} toAddress - Winner's wallet address
     * @param {bigint} amountWei - Amount to send in wei
     * @returns {Promise<{success: boolean, txHash?: string, error?: string, message?: string}>}
     */
    async sendPayout(toAddress, amountWei) {
        try {
            // Check hot wallet balance first
            const balance = await this.provider.getBalance(this.wallet.address);
            if (balance < amountWei) {
                logger.warn('Wallet', `Insufficient balance for payout. Have: ${ethers.formatEther(balance)} MON, Need: ${ethers.formatEther(amountWei)} MON`);
                return { success: false, error: 'INSUFFICIENT_BALANCE' };
            }

            logger.info('Wallet', `Sending payout: ${ethers.formatEther(amountWei)} MON to ${toAddress}`);

            const tx = await this.wallet.sendTransaction({
                to: toAddress,
                value: amountWei,
            });

            logger.info('Wallet', `Payout tx submitted: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait(1);

            if (receipt.status === 1) {
                logger.info('Wallet', `Payout confirmed: ${tx.hash}`);
                return { success: true, txHash: tx.hash };
            } else {
                return { success: false, error: 'TX_REVERTED' };
            }
        } catch (err) {
            logger.error('Wallet', `Payout error: ${err.message}`);
            return { success: false, error: 'PAYOUT_FAILED', message: err.message };
        }
    }

    /**
     * Calculate winner payout from pool.
     * @param {bigint} poolWei - Total pool in wei
     * @returns {bigint} Winner's share in wei
     */
    calculateWinnerPayout(poolWei) {
        return (poolWei * BigInt(this.winnerSharePercent)) / 100n;
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
