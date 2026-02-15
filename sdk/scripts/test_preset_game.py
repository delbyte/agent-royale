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
import requests

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


def wait_for_server(timeout_seconds: int = 20) -> bool:
    """Wait until /api/health is reachable."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            r = requests.get(f"{SERVER}/api/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def get_game_state():
    try:
        r = requests.get(f"{SERVER}/api/health", timeout=2)
        if r.status_code == 200:
            return r.json().get("game_state")
    except Exception:
        pass
    return None


def wait_for_lobby_open(timeout_seconds: int = 120) -> bool:
    """Wait until server reports LOBBY_OPEN so bots can join."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = get_game_state()
        if state == "LOBBY_OPEN":
            return True
        time.sleep(1)
    return False


def run_bot(index: int, strategy_name: str, strategy_fn):
    """Run a single bot in its own thread."""
    key = generate_dummy_key()
    try:
        agent = SurvivalAgent(SERVER, key)

        # If server is mid-game, wait and retry join for a bit.
        join_deadline = time.time() + 120
        joined = False
        while time.time() < join_deadline and not joined:
            try:
                agent.join(spawn_preference=[
                    random.randint(5, 45),
                    random.randint(5, 45),
                ])
                joined = True
            except Exception as e:
                if "GAME_NOT_IN_LOBBY" in str(e):
                    time.sleep(1)
                    continue
                raise

        if not joined:
            raise RuntimeError("Timed out waiting for lobby to open")

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

    if not wait_for_server():
        print(f"  ERROR: server is not reachable at {SERVER}")
        print("  Start server first (server terminal):")
        print("    cd server")
        print("    set DEV_SKIP_PAYMENT=true")
        print("    node index.js")
        return

    if not wait_for_lobby_open():
        print("  ERROR: server did not enter LOBBY_OPEN in time")
        print("  Wait for current match to end (or restart server), then re-run test.")
        return

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
