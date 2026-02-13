"""
Protocol: SURVIVAL — Python SDK

Usage:
    from survival_sdk import SurvivalAgent

    agent = SurvivalAgent("http://localhost:3001", "0xYOUR_PRIVATE_KEY")
    agent.join()
    agent.run(your_strategy_fn)
"""

from .agent import SurvivalAgent

__all__ = ["SurvivalAgent"]
__version__ = "0.1.0"
