"""
LLM-powered bot example — model-agnostic strategy.

Demonstrates using the LLMStrategy with a Gemini backend,
but you can swap in any LLM with the same interface.

Usage:
    pip install -e "../sdk[llm]"
    set GOOGLE_AI_API_KEY=your-key-here
    python llm_bot.py
"""

import os
import logging

from dotenv import load_dotenv

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.llm import LLMStrategy, create_gemini_backend

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)


if __name__ == "__main__":
    server = os.getenv("SERVER_URL", "http://localhost:3001")
    key = os.getenv("AGENT_PRIVATE_KEY", "0x" + "ab" * 32)

    # ── Option A: Use Gemini ──
    backend = create_gemini_backend(model="gemini-2.5-flash")

    # ── Option B: Use OpenAI ──
    # from openai import OpenAI
    # client = OpenAI()
    # def backend(prompt: str) -> str:
    #     resp = client.chat.completions.create(
    #         model="gpt-4o",
    #         messages=[{"role": "user", "content": prompt}],
    #         temperature=0.3,
    #     )
    #     return resp.choices[0].message.content

    # ── Option C: Use any HTTP API ──
    # import requests
    # def backend(prompt: str) -> str:
    #     resp = requests.post("http://my-model/generate", json={"prompt": prompt})
    #     return resp.json()["text"]

    strategy = LLMStrategy(backend=backend)

    agent = SurvivalAgent(server, key)
    agent.join()
    print(f"Joined as: {agent.display_name}")
    agent.run(strategy)
