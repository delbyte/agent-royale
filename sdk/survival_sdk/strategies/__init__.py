"""
Built-in strategies for Protocol: SURVIVAL.

Usage:
    from survival_sdk.strategies.aggressive import aggressive_strategy
    from survival_sdk.strategies.gatherer import gatherer_strategy
    from survival_sdk.strategies.diplomat import diplomat_strategy
    from survival_sdk.strategies.llm import LLMStrategy

    # Rule-based:
    agent.run(aggressive_strategy)

    # LLM-powered (any provider):
    strategy = LLMStrategy(backend=your_llm_callable)
    agent.run(strategy)
"""

from .aggressive import aggressive_strategy
from .gatherer import gatherer_strategy
from .diplomat import diplomat_strategy

__all__ = [
    "aggressive_strategy",
    "gatherer_strategy",
    "diplomat_strategy",
]
