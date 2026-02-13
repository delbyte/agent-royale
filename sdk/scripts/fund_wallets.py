"""
Fund generated wallets from a source wallet on Monad Testnet.

Usage:
    python -m scripts.fund_wallets --source-key 0x... --wallets wallets.json --amount 1.1
    survival-fund-wallets --source-key 0x... --wallets wallets.json --amount 1.1
"""

import argparse
import json
import time

from web3 import Web3
from eth_account import Account


def main():
    parser = argparse.ArgumentParser(
        description="Fund wallets on Monad Testnet for SURVIVAL bots"
    )
    parser.add_argument(
        "--source-key", required=True,
        help="Private key of the funding wallet (hex, with or without 0x)"
    )
    parser.add_argument(
        "--wallets", "-w", required=True,
        help="Path to wallets.json from generate_wallets"
    )
    parser.add_argument(
        "--amount", "-a", type=float, default=1.1,
        help="Amount of MON to send per wallet (default: 1.1)"
    )
    parser.add_argument(
        "--rpc", type=str, default="https://testnet-rpc.monad.xyz/",
        help="Monad Testnet RPC URL"
    )
    args = parser.parse_args()

    w3 = Web3(Web3.HTTPProvider(args.rpc))
    source = Account.from_key(args.source_key)
    amount_wei = w3.to_wei(args.amount, "ether")

    with open(args.wallets) as f:
        wallets = json.load(f)

    print(f"Funding {len(wallets)} wallets with {args.amount} MON each")
    print(f"Source: {source.address}")
    print(f"Source balance: {w3.from_wei(w3.eth.get_balance(source.address), 'ether')} MON")
    print()

    nonce = w3.eth.get_transaction_count(source.address)

    for wallet in wallets:
        target = wallet["address"]
        tx = {
            "to": Web3.to_checksum_address(target),
            "value": amount_wei,
            "chainId": 10143,
            "gas": 21000,
            "gasPrice": w3.eth.gas_price,
            "nonce": nonce,
        }

        signed = source.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)

        print(f"  [{wallet['index']}] {target[:16]}... → tx: {tx_hash.hex()[:16]}...")
        nonce += 1

        # Small delay to avoid nonce issues
        time.sleep(0.5)

    print(f"\nDone! Funded {len(wallets)} wallets.")


if __name__ == "__main__":
    main()
