"""
Basic bot example — the simplest possible SURVIVAL agent.

This bot just moves toward the zone center every tick. It demonstrates
the minimal SDK setup required to get a bot running.

Usage:
    pip install -e ../sdk
    set DEV_SKIP_PAYMENT=true
    python basic_bot.py
"""

import os
import logging

from dotenv import load_dotenv

from survival_sdk import SurvivalAgent

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)


def simple_strategy(agent: SurvivalAgent, state: dict):
    """Move toward zone center. That's it."""
    zone_center = state.get("zone", {}).get("center", [25, 25])

    if agent.is_outside_zone():
        agent.move(agent.direction_toward(zone_center))
    elif agent.distance_to(zone_center) > 3:
        agent.move(agent.direction_toward(zone_center))
    else:
        agent.idle()


if __name__ == "__main__":
    server = os.getenv("SERVER_URL", "http://localhost:3001")
    key = os.getenv("AGENT_PRIVATE_KEY", "0x" + "ab" * 32)  # Dummy key for DEV mode

    agent = SurvivalAgent(server, key)
    agent.join()
    print(f"Joined as: {agent.display_name}")
    agent.run(simple_strategy)
