"""
Generate Ethereum wallets for Protocol: SURVIVAL bots.

Usage:
    python -m scripts.generate_wallets --count 10 --output wallets.json
    survival-generate-wallets --count 10 --output wallets.json
"""

import argparse
import json
import sys

from survival_sdk.utils.wallet import generate_wallets


def main():
    parser = argparse.ArgumentParser(
        description="Generate Ethereum wallets for SURVIVAL bots"
    )
    parser.add_argument(
        "--count", "-n", type=int, default=10,
        help="Number of wallets to generate (default: 10)"
    )
    parser.add_argument(
        "--output", "-o", type=str, default="wallets.json",
        help="Output file path (default: wallets.json)"
    )
    args = parser.parse_args()

    wallets = generate_wallets(args.count)

    with open(args.output, "w") as f:
        json.dump(wallets, f, indent=2)

    print(f"Generated {args.count} wallets → {args.output}")
    for w in wallets:
        print(f"  [{w['index']}] {w['address']}")


if __name__ == "__main__":
    main()
