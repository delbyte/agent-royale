"""
Test game: MIXED — preset strategies + LLM agents.

Launches 6 bots total:
  - 1 Aggressive (rule-based)
  - 1 Gatherer (rule-based)
  - 1 Diplomat (rule-based)
  - 3 LLM agents (Gemini-powered)

This is the best test for seeing how the LLM's validation/adaptation
layer handles real combat against rule-based bots that act every tick.

Prerequisites:
    1. Start the game server:
           cd server
           set DEV_SKIP_PAYMENT=true
           node index.js

    2. Set your Gemini API key:
           set GOOGLE_AI_API_KEY=your-key-here

    3. Run this script:
           cd sdk
           python -m scripts.test_mixed_game

Environment Variables:
    GOOGLE_AI_API_KEY  — Required for LLM agents
    SERVER_URL         — Game server URL (default: http://localhost:3001)
    LLM_MODEL          — Gemini model to use (default: gemini-2.5-flash)
"""

import logging
import os
import random
import secrets
import sys
import threading
import time

from dotenv import load_dotenv

load_dotenv()

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.aggressive import aggressive_strategy
from survival_sdk.strategies.gatherer import gatherer_strategy
from survival_sdk.strategies.diplomat import diplomat_strategy
from survival_sdk.strategies.llm import LLMStrategy, create_gemini_backend

# ── Configuration ──
SERVER = os.getenv("SERVER_URL", "http://localhost:3001")
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-2.5-flash")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("test_mixed")


def generate_dummy_key():
    return "0x" + secrets.token_hex(32)


def create_llm_strategy():
    """Create a fresh LLM strategy instance (each bot gets its own)."""
    backend = create_gemini_backend(model=LLM_MODEL)
    return LLMStrategy(backend=backend)


def run_bot(index: int, label: str, strategy_fn):
    """Run a single bot in its own thread."""
    key = generate_dummy_key()
    try:
        agent = SurvivalAgent(SERVER, key)
        agent.join(spawn_preference=[
            random.randint(5, 45),
            random.randint(5, 45),
        ])
        logger.info(f"Bot {index} ({label}) joined as '{agent.display_name}'")
        agent.run(strategy_fn)

        # Print LLM stats if applicable
        if isinstance(strategy_fn, LLMStrategy):
            s = strategy_fn
            logger.info(
                f"Bot {index} ({label}) STATS: "
                f"llm={s._total_llm_actions} "
                f"adapted={s._total_adapted_actions} "
                f"fallback={s._total_fallback_actions} "
                f"stale={s._total_stale_discards} "
                f"invalid={s._total_invalid_discards} "
                f"stamina_gates={s._total_stamina_gates} "
                f"afk_saves={s._total_afk_saves}"
            )

        logger.info(f"Bot {index} ({label}) finished.")
    except Exception as e:
        logger.error(f"Bot {index} ({label}) error: {e}")


def main():
    # Verify API key
    api_key = os.getenv("GOOGLE_AI_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("\n  ✗ GOOGLE_AI_API_KEY not set!")
        print("    Set it: set GOOGLE_AI_API_KEY=your-key-here")
        print("    Or create a .env file in the sdk/ directory.\n")
        sys.exit(1)

    print()
    print("═" * 50)
    print("  Protocol: SURVIVAL — Mixed Game Test")
    print(f"  Server: {SERVER}")
    print(f"  Model:  {LLM_MODEL}")
    print(f"  Bots:   6 total")
    print(f"    • 1x Aggressive (rule-based)")
    print(f"    • 1x Gatherer   (rule-based)")
    print(f"    • 1x Diplomat   (rule-based)")
    print(f"    • 3x LLM        (Gemini)")
    print("═" * 50)
    print()

    bots = [
        ("Aggressive", aggressive_strategy),
        ("Gatherer", gatherer_strategy),
        ("Diplomat", diplomat_strategy),
        ("LLM-1", create_llm_strategy()),
        ("LLM-2", create_llm_strategy()),
        ("LLM-3", create_llm_strategy()),
    ]

    threads = []
    for i, (label, fn) in enumerate(bots):
        t = threading.Thread(
            target=run_bot, args=(i, label, fn), daemon=True
        )
        threads.append(t)
        print(f"  Launching bot {i}: [{label}]")
        t.start()
        time.sleep(0.5)

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
