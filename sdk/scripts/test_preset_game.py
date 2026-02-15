"""
Test game: ALL preset strategies (no AI).

Launches 6 bots — 2 aggressive, 2 gatherers, 2 diplomats — and
lets them play a full game against each other. No LLM API key needed.

Prerequisites:
    1. Start the game server in a separate terminal:
           cd server
           set DEV_SKIP_PAYMENT=true
           node index.js

    2. Run this script:
           cd sdk
           python -m scripts.test_preset_game

    You can watch the game at http://localhost:3001 if the frontend is running.
"""

import logging
import random
import secrets
import threading
import time
import sys

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.aggressive import aggressive_strategy
from survival_sdk.strategies.gatherer import gatherer_strategy
from survival_sdk.strategies.diplomat import diplomat_strategy

# ── Configuration ──
SERVER = "http://localhost:3001"
NUM_BOTS = 10  # Total bots to launch

STRATEGIES = [
    ("Aggressive", aggressive_strategy),
    ("Gatherer", gatherer_strategy),
    ("Diplomat", diplomat_strategy),
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("test_preset")


def generate_dummy_key():
    """Generate a random private key for DEV_SKIP_PAYMENT mode."""
    return "0x" + secrets.token_hex(32)


def run_bot(index: int, strategy_name: str, strategy_fn):
    """Run a single bot in its own thread."""
    key = generate_dummy_key()
    try:
        agent = SurvivalAgent(SERVER, key)
        agent.join(spawn_preference=[
            random.randint(5, 45),
            random.randint(5, 45),
        ])
        logger.info(
            f"Bot {index} ({strategy_name}) joined as '{agent.display_name}'"
        )
        agent.run(strategy_fn)
        logger.info(f"Bot {index} ({strategy_name}) finished.")
    except Exception as e:
        logger.error(f"Bot {index} ({strategy_name}) error: {e}")


def main():
    print()
    print("═" * 50)
    print("  Protocol: SURVIVAL — Preset Strategies Test")
    print(f"  Server: {SERVER}")
    print(f"  Bots: {NUM_BOTS} (cycled Aggressive/Gatherer/Diplomat)")
    print("  AI: None (all rule-based)")
    print("═" * 50)
    print()

    threads = []
    for i in range(NUM_BOTS):
        name, fn = STRATEGIES[i % len(STRATEGIES)]
        t = threading.Thread(
            target=run_bot, args=(i, name, fn), daemon=True
        )
        threads.append(t)
        print(f"  Launching bot {i}: [{name}]")
        t.start()
        time.sleep(0.5)  # Stagger joins

    print(f"\n  All {len(threads)} bots launched. Waiting for game...\n")

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\n  Interrupted. Shutting down.")
        sys.exit(0)

    print("\n  Game complete!")


if __name__ == "__main__":
    main()
