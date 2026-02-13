"""
Launch multiple SURVIVAL bots concurrently for demo or testing.

Usage:
    python -m scripts.launch_demo --wallets wallets.json --server http://localhost:3001 --strategy mixed
    survival-launch-demo --wallets wallets.json --server http://localhost:3001 --count 5
"""

import argparse
import json
import logging
import threading
import random

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.aggressive import aggressive_strategy
from survival_sdk.strategies.gatherer import gatherer_strategy
from survival_sdk.strategies.diplomat import diplomat_strategy

STRATEGIES = {
    "aggressive": aggressive_strategy,
    "gatherer": gatherer_strategy,
    "diplomat": diplomat_strategy,
}


def run_bot(wallet: dict, server: str, strategy_fn, bot_index: int):
    """Run a single bot in its own thread."""
    logger = logging.getLogger(f"bot_{bot_index}")
    try:
        agent = SurvivalAgent(server, wallet["private_key"])
        agent.join(spawn_preference=[
            random.randint(5, 45),
            random.randint(5, 45),
        ])
        logger.info(f"Bot {bot_index} joined as '{agent.display_name}'")
        agent.run(strategy_fn)
    except Exception as e:
        logger.error(f"Bot {bot_index} crashed: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Launch multiple SURVIVAL bots for demo"
    )
    parser.add_argument(
        "--wallets", "-w", required=True,
        help="Path to wallets.json"
    )
    parser.add_argument(
        "--server", "-s", type=str, default="http://localhost:3001",
        help="Game server URL (default: http://localhost:3001)"
    )
    parser.add_argument(
        "--count", "-n", type=int, default=0,
        help="Number of bots to launch (default: all wallets)"
    )
    parser.add_argument(
        "--strategy", type=str, default="mixed",
        choices=["aggressive", "gatherer", "diplomat", "mixed"],
        help="Strategy for all bots, or 'mixed' for random assignment (default: mixed)"
    )
    parser.add_argument(
        "--delay", "-d", type=float, default=1.0,
        help="Delay between bot launches in seconds (default: 1.0)"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    with open(args.wallets) as f:
        wallets = json.load(f)

    if args.count > 0:
        wallets = wallets[:args.count]

    strategy_names = list(STRATEGIES.keys())

    print(f"\n{'═' * 40}")
    print(f"  Protocol: SURVIVAL — Demo Launcher")
    print(f"  Server: {args.server}")
    print(f"  Bots: {len(wallets)}")
    print(f"  Strategy: {args.strategy}")
    print(f"{'═' * 40}\n")

    threads = []
    for i, wallet in enumerate(wallets):
        if args.strategy == "mixed":
            strat_name = strategy_names[i % len(strategy_names)]
        else:
            strat_name = args.strategy

        strategy_fn = STRATEGIES[strat_name]

        t = threading.Thread(
            target=run_bot,
            args=(wallet, args.server, strategy_fn, i),
            daemon=True,
        )
        threads.append(t)

        print(f"  Launch bot {i}: {wallet['address'][:16]}... [{strat_name}]")
        t.start()

        if args.delay > 0 and i < len(wallets) - 1:
            import time
            time.sleep(args.delay)

    print(f"\nAll {len(threads)} bots launched. Waiting for game to finish...\n")

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\nShutting down bots...")


if __name__ == "__main__":
    main()
