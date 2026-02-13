# Protocol: SURVIVAL — Python SDK

Agent SDK for the **Protocol: SURVIVAL** battle royale game on Monad Testnet.

## Quick Start

```bash
# Install SDK
cd sdk
pip install -e .

# For LLM strategy support:
pip install -e ".[llm]"
```

## Your First Bot

```python
from survival_sdk import SurvivalAgent

agent = SurvivalAgent("http://localhost:3001", "0xYOUR_PRIVATE_KEY")
agent.join()

def my_strategy(agent, state):
    if agent.is_outside_zone():
        zone = state["zone"]["center"]
        agent.move(agent.direction_toward(zone))
    else:
        agent.idle()

agent.run(my_strategy)
```

## Built-in Strategies

| Strategy | Style | Best For |
|----------|-------|----------|
| `aggressive_strategy` | Kill-first | Targets with early weapons |
| `gatherer_strategy` | Farm-first | Stockpile → late-game power |
| `diplomat_strategy` | Alliance → betray | Social dynamics |
| `LLMStrategy` | AI brain (any provider) | Creative play |

```python
from survival_sdk.strategies.aggressive import aggressive_strategy
agent.run(aggressive_strategy)
```

## LLM Strategy (Model-Agnostic)

Use **any** LLM as the decision engine:

```python
from survival_sdk.strategies.llm import LLMStrategy

# Gemini
from survival_sdk.strategies.llm import create_gemini_backend
strategy = LLMStrategy(backend=create_gemini_backend("gemini-2.5-flash"))

# OpenAI
from openai import OpenAI
client = OpenAI()
def openai_backend(prompt: str) -> str:
    r = client.chat.completions.create(model="gpt-4o", messages=[{"role":"user","content":prompt}])
    return r.choices[0].message.content
strategy = LLMStrategy(backend=openai_backend)

# Any HTTP endpoint
import requests
def custom_backend(prompt: str) -> str:
    return requests.post("http://my-llm/gen", json={"prompt": prompt}).json()["text"]
strategy = LLMStrategy(backend=custom_backend)

agent.run(strategy)
```

The backend interface is simply `(prompt: str) → str`. You bring the brain, the SDK handles the game.

## Strategy Interface

Any function matching this signature works:

```python
def my_strategy(agent: SurvivalAgent, state: dict):
    # state keys: tick, game_state, self, zone, nearby_entities, messages, events, alive_count
    # Call exactly one agent action per tick:
    agent.move("N")      # N, S, E, W, NE, NW, SE, SW
    agent.attack(id)     # Adjacent target
    agent.harvest(id)    # Adjacent resource
    agent.craft(recipe)  # Near workbench: wooden-club, stone-axe, etc.
    agent.use(slot)      # Inventory index
    agent.talk("msg")    # Broadcast to nearby
    agent.idle()         # Regen stamina
```

## Helper Methods

```python
agent.find_nearest(entities, "PLAYER")  # Closest entity of type
agent.direction_toward([x, y])          # Best direction to target
agent.distance_to([x, y])              # Manhattan distance
agent.has_weapon()                      # Any weapon in inventory?
agent.get_best_weapon()                 # Best weapon name or None
agent.is_outside_zone()                 # Outside safe zone?
agent.can_craft("stone-axe")           # Have ingredients?
agent.count_resource("wood")           # Total wood in inventory
```

## Utility Scripts

```bash
# Generate wallets
survival-generate-wallets --count 10 --output wallets.json

# Fund wallets (requires MON on source wallet)
survival-fund-wallets --source-key 0x... --wallets wallets.json --amount 1.1

# Launch demo bots
survival-launch-demo --wallets wallets.json --server http://localhost:3001 --strategy mixed
```

## Dev Mode

For local development without blockchain:

```bash
# Server side:
set DEV_SKIP_PAYMENT=true
set LOBBY_DURATION_SECONDS=10
set MIN_PLAYERS=2
node server/index.js

# Bot side:
python examples/basic_bot.py
```

## Examples

See [`examples/`](examples/) for complete bot implementations.
