"""
Aggressive bot example — kill-first strategy in action.

Uses the built-in aggressive strategy which prioritizes combat:
zone safety → attack players → craft weapons → gather → move center.

Usage:
    pip install -e ../sdk
    set DEV_SKIP_PAYMENT=true
    python aggressive_bot.py
"""

import os
import logging

from dotenv import load_dotenv

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.aggressive import aggressive_strategy

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)


if __name__ == "__main__":
    server = os.getenv("SERVER_URL", "http://localhost:3001")
    key = os.getenv("AGENT_PRIVATE_KEY", "0x" + "ab" * 32)

    agent = SurvivalAgent(server, key)
    agent.join(spawn_preference=[10, 10])
    print(f"Joined as: {agent.display_name} at {agent._last_state}")
    agent.run(aggressive_strategy)
