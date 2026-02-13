"""
Wallet generation and management utilities for Protocol: SURVIVAL.

Uses eth_account to generate Ethereum-compatible keypairs for Monad Testnet.
"""

from eth_account import Account


def generate_wallet() -> dict:
    """
    Generate a single Ethereum wallet (private key + address).
    
    Returns:
        dict with 'address' and 'private_key' fields
    """
    account = Account.create()
    return {
        "address": account.address,
        "private_key": "0x" + account.key.hex(),
    }


def generate_wallets(count: int) -> list[dict]:
    """
    Generate N Ethereum wallets.
    
    Args:
        count: Number of wallets to generate
        
    Returns:
        List of dicts, each with 'index', 'address', and 'private_key'
    """
    wallets = []
    for i in range(count):
        w = generate_wallet()
        w["index"] = i
        wallets.append(w)
    return wallets
