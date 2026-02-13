# Phase 3 Spec: Agent API & Python SDK

> **Owner:** Backend + Python Developer
> **Effort:** ~3 hours
> **Dependencies:** Phase 1 (Game Server running), Phase 2 (x402 flow for real payments)
> **Output:** A pip-installable Python SDK (`protocol-survival-sdk`) that handles wallet creation, x402 payment, game state polling, action submission, and a pluggable strategy framework. Plus utility scripts for wallet generation, funding, and launching demo bots.

---

## 1. Overview

The Python SDK is how AI agents interact with the game. It must:

1. **Abstract the x402 flow** — Agent devs call `.join()` and the SDK handles the 402→pay→confirm dance
2. **Provide clean state access** — Structured Python objects, not raw JSON
3. **Support strategy plugins** — Simple `def strategy(agent, state)` functions
4. **Include demo bot logic** — LLM-powered strategy using Gemma-3-27B
5. **Include utility scripts** — Generate wallets, fund them, launch N bots at once

---

## 2. Package Structure

```
sdk/
├── pyproject.toml              # Modern Python packaging (pip installable)
├── README.md                   # Quick start guide
├── survival_sdk/
│   ├── __init__.py             # Export SurvivalAgent, etc.
│   ├── agent.py                # Main agent class
│   ├── models.py               # Pydantic models for state/actions
│   ├── strategies/
│   │   ├── __init__.py
│   │   ├── aggressive.py       # Rush-attack strategy
│   │   ├── gatherer.py         # Farm-first strategy
│   │   ├── diplomat.py         # Alliance-forming strategy
│   │   └── llm.py              # LLM-powered strategy (Gemma-3-27B)
│   └── utils/
│       ├── __init__.py
│       └── wallet.py           # Wallet generation helpers
├── scripts/
│   ├── generate_wallets.py     # Generate N wallets → wallets.json
│   ├── fund_wallets.py         # Fund wallets from a source wallet
│   └── launch_demo.py          # Launch N bots concurrently
└── examples/
    ├── basic_bot.py            # Simplest possible bot
    ├── aggressive_bot.py       # Full aggressive strategy example
    └── llm_bot.py              # Gemma-3 powered bot
```

---

## 3. `pyproject.toml`

```toml
[build-system]
requires = ["setuptools>=64", "wheel"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "protocol-survival-sdk"
version = "0.1.0"
description = "Python SDK for Protocol: SURVIVAL — Monad Agent Battle Royale"
requires-python = ">=3.10"
dependencies = [
    "requests>=2.28.0",
    "web3>=6.0.0",
    "pydantic>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
llm = [
    "google-generativeai>=0.4.0",
]
dev = [
    "pytest>=7.0",
]

[project.scripts]
survival-generate-wallets = "scripts.generate_wallets:main"
survival-fund-wallets = "scripts.fund_wallets:main"
survival-launch-demo = "scripts.launch_demo:main"
```

---

## 4. Data Models (`survival_sdk/models.py`)

Use Pydantic for type-safe state parsing. This is crucial — bot developers need autocomplete and type hints.

```python
from pydantic import BaseModel
from typing import Optional

class InventorySlot(BaseModel):
    slot: int
    item: Optional[str] = None
    quantity: int = 0

class SelfState(BaseModel):
    id: str
    display_name: str
    hp: int
    stamina: int
    position: list[int]  # [x, y]
    inventory: list[Optional[dict]]
    kills: int
    alive: bool

class ZoneState(BaseModel):
    center: list[int]
    radius: float
    next_shrink_tick: Optional[int]
    next_radius: Optional[float]
    damage_per_tick_outside: int

class NearbyEntity(BaseModel):
    id: str
    type: str  # RESOURCE, PLAYER, WORKBENCH, BARRICADE, LOOT
    subtype: Optional[str] = None
    display_name: Optional[str] = None
    position: list[int]
    hp: Optional[int] = None
    holding: Optional[str] = None

class ChatMessage(BaseModel):
    from_field: str  # 'from' is reserved in Python
    from_name: str
    text: str
    tick: int
    
    class Config:
        # Map JSON 'from' to 'from_field'
        fields = {'from_field': 'from'}

class KillEvent(BaseModel):
    type: str
    killer: Optional[str]
    victim: str
    weapon: Optional[str]
    tick: int

class GameState(BaseModel):
    tick: int
    game_state: str  # LOBBY_OPEN, GAME_ACTIVE, GAME_OVER
    self_state: SelfState
    zone: ZoneState
    nearby_entities: list[NearbyEntity]
    messages: list[dict]  # Raw dicts for flexibility
    events: list[dict]
    alive_count: int
    elapsed_seconds: int
    
    class Config:
        fields = {'self_state': 'self'}

class ActionResult(BaseModel):
    success: bool
    action_queued: Optional[str] = None
    tick_queued: Optional[int] = None
    error: Optional[str] = None
    message: Optional[str] = None

class PaymentRequired(BaseModel):
    payment_address: str
    amount_wei: str
    amount_display: str
    chain_id: int
    rpc_url: str
    session_id: str
    expires_at: int
    instructions: str

class JoinResult(BaseModel):
    auth_token: str
    agent_id: str
    game_id: str
    display_name: str
    spawn_position: Optional[list[int]] = None
    game_state: str
    players_connected: Optional[int] = None
    game_starts_in_seconds: Optional[int] = None
```

---

## 5. Main Agent Class (`survival_sdk/agent.py`)

```python
"""
SurvivalAgent — Main class for interacting with Protocol: SURVIVAL.

Usage:
    from survival_sdk import SurvivalAgent
    
    agent = SurvivalAgent("http://localhost:3001", "0xPRIVATE_KEY")
    agent.join()
    agent.run(my_strategy_function)
"""

import json
import time
import requests
from typing import Callable, Optional
from web3 import Web3
from eth_account import Account

class SurvivalAgent:
    """
    A client for the Protocol: SURVIVAL game server.
    
    Handles:
    - x402 payment flow (send MON on Monad Testnet, verify with server)
    - Game state polling
    - Action submission
    - Strategy loop execution
    """
    
    def __init__(self, server_url: str, private_key: str, rpc_url: str = "https://testnet-rpc.monad.xyz/"):
        """
        Initialize agent.
        
        Args:
            server_url: Game server URL, e.g. "http://localhost:3001"
            private_key: Hex private key with 0x prefix
            rpc_url: Monad Testnet RPC URL (default: official public RPC)
        """
        self.server = server_url.rstrip('/')
        self.rpc_url = rpc_url
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.account = Account.from_key(private_key)
        self.address = self.account.address
        
        # Set after join
        self.token: Optional[str] = None
        self.agent_id: Optional[str] = None
        self.game_id: Optional[str] = None
        self.display_name: Optional[str] = None
        
        # State cache
        self._last_state: Optional[dict] = None
        
    @property
    def is_joined(self) -> bool:
        return self.token is not None
    
    # ----------------------------------------------------------------
    # JOIN FLOW (x402)
    # ----------------------------------------------------------------
    
    def join(self, spawn_preference: list[int] = [25, 25]) -> dict:
        """
        Handle the full x402 join flow:
        1. POST /api/join → receive 402 with payment requirements
        2. Send MON on Monad Testnet
        3. POST /api/join with tx_hash → receive JWT token
        
        Args:
            spawn_preference: Preferred [x, y] spawn coordinate
            
        Returns:
            dict with auth_token, agent_id, game_id, display_name
            
        Raises:
            RuntimeError: If join fails at any step
        """
        print(f"[Agent] Joining as {self.address[:10]}...")
        
        # Step 1: Request payment requirements
        resp = requests.post(f"{self.server}/api/join", json={
            "wallet_address": self.address,
        })
        
        if resp.status_code == 200:
            # DEV_SKIP_PAYMENT mode — already joined
            data = resp.json()
            self._handle_join_success(data)
            return data
        
        if resp.status_code != 402:
            raise RuntimeError(f"Expected 402, got {resp.status_code}: {resp.text}")
        
        payment = resp.json()["payment_required"]
        print(f"[Agent] Payment required: {payment['amount_display']} to {payment['payment_address'][:10]}...")
        
        # Step 2: Send MON on Monad Testnet
        tx_hash = self._send_payment(payment)
        print(f"[Agent] Payment sent: {tx_hash}")
        
        # Step 3: Confirm with server
        resp = requests.post(f"{self.server}/api/join", json={
            "wallet_address": self.address,
            "tx_hash": tx_hash,
            "session_id": payment["session_id"],
            "spawn_preference": spawn_preference,
        })
        
        if resp.status_code != 200:
            raise RuntimeError(f"Join confirmation failed: {resp.status_code} — {resp.text}")
        
        data = resp.json()
        self._handle_join_success(data)
        return data
    
    def _send_payment(self, payment: dict) -> str:
        """Send MON payment on Monad Testnet."""
        session_hex = "0x" + payment["session_id"].encode('utf-8').hex()
        
        nonce = self.w3.eth.get_transaction_count(self.address)
        gas_price = self.w3.eth.gas_price
        
        tx = {
            'to': Web3.to_checksum_address(payment["payment_address"]),
            'value': int(payment["amount_wei"]),
            'data': session_hex,
            'chainId': payment["chain_id"],
            'gas': 50000,  # Enough for simple transfer with data
            'gasPrice': gas_price,
            'nonce': nonce,
        }
        
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        
        # Wait for confirmation
        print(f"[Agent] Waiting for tx confirmation...")
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        
        if receipt['status'] != 1:
            raise RuntimeError(f"Transaction failed: {tx_hash.hex()}")
        
        return tx_hash.hex()
    
    def _handle_join_success(self, data: dict):
        """Store credentials from successful join."""
        self.token = data["auth_token"]
        self.agent_id = data["agent_id"]
        self.game_id = data.get("game_id")
        self.display_name = data.get("display_name")
        print(f"[Agent] Joined as '{self.display_name}' (ID: {self.agent_id})")
    
    # ----------------------------------------------------------------
    # STATE & ACTIONS
    # ----------------------------------------------------------------
    
    def get_state(self) -> dict:
        """
        Get current visible world state (fog of war applied server-side).
        
        Returns:
            dict matching the GET /api/world/state response schema
        """
        self._require_joined()
        resp = requests.get(
            f"{self.server}/api/world/state",
            headers=self._auth_headers(),
        )
        if resp.status_code != 200:
            raise RuntimeError(f"State fetch failed: {resp.status_code}")
        self._last_state = resp.json()
        return self._last_state
    
    def act(self, action: str, **kwargs) -> dict:
        """
        Submit an action for the current tick.
        
        Args:
            action: One of MOVE, ATTACK, HARVEST, CRAFT, USE, TALK, IDLE
            **kwargs: Action-specific params (direction, target_id, recipe, etc.)
            
        Returns:
            dict with success status
        """
        self._require_joined()
        payload = {"action": action, **kwargs}
        resp = requests.post(
            f"{self.server}/api/action",
            json=payload,
            headers=self._auth_headers(),
        )
        return resp.json()
    
    # --- Convenience methods ---
    
    def move(self, direction: str) -> dict:
        """Move one tile. direction: N, S, E, W, NE, NW, SE, SW"""
        return self.act("MOVE", direction=direction)
    
    def attack(self, target_id: str) -> dict:
        """Attack an adjacent player or barricade."""
        return self.act("ATTACK", target_id=target_id)
    
    def harvest(self, target_id: str) -> dict:
        """Harvest an adjacent resource node (tree/rock)."""
        return self.act("HARVEST", target_id=target_id)
    
    def craft(self, recipe: str) -> dict:
        """Craft an item. Must be within 2 tiles of a workbench.
        Recipes: wooden-club, stone-axe, stone-pickaxe, stone-hammer, barricade, health-potion
        """
        return self.act("CRAFT", recipe=recipe)
    
    def use(self, item_slot: int) -> dict:
        """Use an item from inventory (e.g., health potion)."""
        return self.act("USE", item_slot=item_slot)
    
    def talk(self, message: str) -> dict:
        """Broadcast a message to agents within vision range (max 200 chars)."""
        return self.act("TALK", message=message[:200])
    
    def idle(self) -> dict:
        """Do nothing this tick (stamina regenerates)."""
        return self.act("IDLE")
    
    # --- Helpers ---
    
    def find_nearest(self, entities: list[dict], entity_type: str) -> Optional[dict]:
        """Find nearest entity of given type from a list."""
        my_pos = self._last_state["self"]["position"] if self._last_state else [25, 25]
        filtered = [e for e in entities if e.get("type") == entity_type]
        if not filtered:
            return None
        return min(filtered, key=lambda e: self._manhattan_dist(my_pos, e["position"]))
    
    def direction_toward(self, target_pos: list[int]) -> str:
        """Get the cardinal direction to move toward a target position."""
        if not self._last_state:
            return "N"
        my_pos = self._last_state["self"]["position"]
        dx = target_pos[0] - my_pos[0]
        dy = target_pos[1] - my_pos[1]
        
        if dx == 0 and dy == 0:
            return "N"  # Already there
        
        if abs(dx) > abs(dy):
            return "E" if dx > 0 else "W"
        else:
            return "S" if dy > 0 else "N"
    
    def distance_to(self, target_pos: list[int]) -> int:
        """Manhattan distance from current position to target."""
        if not self._last_state:
            return 999
        return self._manhattan_dist(self._last_state["self"]["position"], target_pos)
    
    def has_weapon(self) -> bool:
        """Check if agent has any weapon in inventory."""
        if not self._last_state:
            return False
        weapons = {'wooden-club', 'stone-axe', 'stone-pickaxe', 'stone-hammer'}
        return any(
            s and s.get('item') in weapons
            for s in self._last_state["self"]["inventory"]
            if s
        )
    
    def is_outside_zone(self) -> bool:
        """Check if agent is outside the safe zone."""
        if not self._last_state:
            return False
        pos = self._last_state["self"]["position"]
        zone = self._last_state["zone"]
        dx = pos[0] - zone["center"][0]
        dy = pos[1] - zone["center"][1]
        dist = (dx**2 + dy**2) ** 0.5
        return dist > zone["radius"]
    
    def can_craft(self, recipe: str) -> bool:
        """Check if we have ingredients for a recipe (ignores workbench proximity)."""
        if not self._last_state:
            return False
        recipes = {
            'wooden-club':   {'wood': 5},
            'stone-axe':     {'wood': 10, 'stone': 5},
            'stone-pickaxe': {'wood': 10, 'stone': 5},
            'stone-hammer':  {'wood': 10, 'stone': 10},
            'barricade':     {'wood': 5},
            'health-potion': {'wood': 5, 'stone': 3},
        }
        needed = recipes.get(recipe, {})
        inv = self._last_state["self"]["inventory"]
        counts = {}
        for slot in inv:
            if slot and slot.get("item"):
                counts[slot["item"]] = counts.get(slot["item"], 0) + slot.get("quantity", 1)
        return all(counts.get(item, 0) >= qty for item, qty in needed.items())
    
    # ----------------------------------------------------------------
    # MAIN LOOP
    # ----------------------------------------------------------------
    
    def run(self, strategy_fn: Callable, tick_interval: float = 1.0, max_retries: int = 3):
        """
        Main game loop. Repeatedly:
        1. Poll world state
        2. Call strategy_fn(agent, state)
        3. Sleep until next tick
        
        Args:
            strategy_fn: Function(agent, state_dict) → None. Should call agent.move(), agent.attack(), etc.
            tick_interval: Seconds between state polls (default 1.0, matches server tick rate)
            max_retries: Consecutive error tolerance before stopping
        """
        self._require_joined()
        print(f"[Agent] Starting game loop (tick interval: {tick_interval}s)")
        
        errors = 0
        while True:
            try:
                state = self.get_state()
                
                # Check game over
                if state.get("game_state") == "GAME_OVER":
                    print(f"[Agent] Game over!")
                    break
                
                # Check if we're dead
                if not state.get("self", {}).get("alive", True):
                    print(f"[Agent] Eliminated at tick {state.get('tick', '?')}")
                    break
                
                # Check if still in lobby
                if state.get("game_state") == "LOBBY_OPEN":
                    print(f"[Agent] Waiting in lobby... ({state.get('tick', 0)})")
                    time.sleep(tick_interval)
                    continue
                
                # Run strategy
                strategy_fn(self, state)
                errors = 0
                
            except KeyboardInterrupt:
                print("\n[Agent] Interrupted by user")
                break
            except Exception as e:
                errors += 1
                print(f"[Agent] Error (attempt {errors}/{max_retries}): {e}")
                if errors >= max_retries:
                    print(f"[Agent] Too many errors, stopping")
                    break
            
            time.sleep(tick_interval)
        
        print(f"[Agent] Game loop ended")
    
    # ----------------------------------------------------------------
    # INTERNAL
    # ----------------------------------------------------------------
    
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}
    
    def _require_joined(self):
        if not self.is_joined:
            raise RuntimeError("Agent has not joined a game. Call .join() first.")
    
    @staticmethod
    def _manhattan_dist(a: list[int], b: list[int]) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
```

---

## 6. Built-in Strategies

### 6.1 Aggressive Strategy (`survival_sdk/strategies/aggressive.py`)

Prioritizes combat over everything. Farms only if no enemies are visible.

```python
"""
Aggressive strategy: seek and destroy.

Priority:
1. If outside zone → move toward center
2. If enemy nearby and we have weapon → attack
3. If no weapon → farm resources and craft
4. If no resources nearby → move toward center
"""

def aggressive_strategy(agent, state):
    me = state["self"]
    nearby = state.get("nearby_entities", [])
    zone = state["zone"]
    
    # Priority 1: Get inside zone
    if agent.is_outside_zone():
        direction = agent.direction_toward(zone["center"])
        agent.move(direction)
        return
    
    enemies = [e for e in nearby if e["type"] == "PLAYER"]
    resources = [e for e in nearby if e["type"] == "RESOURCE"]
    workbenches = [e for e in nearby if e["type"] == "WORKBENCH"]
    
    # Priority 2: Attack if we have a weapon
    if enemies and agent.has_weapon():
        target = agent.find_nearest(enemies, "PLAYER")
        if target:
            dist = agent.distance_to(target["position"])
            if dist <= 1:
                agent.attack(target["id"])
            else:
                direction = agent.direction_toward(target["position"])
                agent.move(direction)
        return
    
    # Priority 3: Craft best available weapon
    if workbenches:
        wb = agent.find_nearest(workbenches, "WORKBENCH")
        if wb and agent.distance_to(wb["position"]) <= 2:
            # Near workbench — try to craft
            for recipe in ['stone-hammer', 'stone-axe', 'stone-pickaxe', 'wooden-club']:
                if agent.can_craft(recipe):
                    agent.craft(recipe)
                    return
        elif wb and not agent.has_weapon():
            # Move toward workbench
            direction = agent.direction_toward(wb["position"])
            agent.move(direction)
            return
    
    # Priority 4: Farm resources
    if resources:
        target = agent.find_nearest(resources, "RESOURCE")
        if target:
            dist = agent.distance_to(target["position"])
            if dist <= 1:
                agent.harvest(target["id"])
            else:
                direction = agent.direction_toward(target["position"])
                agent.move(direction)
        return
    
    # Priority 5: Move toward center
    direction = agent.direction_toward(zone["center"])
    agent.move(direction)
```

### 6.2 Gatherer Strategy (`survival_sdk/strategies/gatherer.py`)

Farms first, fights only when cornered.

```python
"""
Gatherer strategy: farm resources, craft weapons, engage only when forced.

Priority:
1. Stay inside zone
2. Farm resources until we can craft stone-hammer
3. Craft stone-hammer (best weapon)
4. Then switch to hunting
5. Use health potions when low
"""

def gatherer_strategy(agent, state):
    me = state["self"]
    nearby = state.get("nearby_entities", [])
    zone = state["zone"]
    
    # Priority 0: Use health potion if HP < 40
    if me["hp"] < 40:
        for i, slot in enumerate(me["inventory"]):
            if slot and slot.get("item") == "health-potion":
                agent.use(i)
                return
    
    # Priority 1: Stay inside zone
    if agent.is_outside_zone():
        agent.move(agent.direction_toward(zone["center"]))
        return
    
    enemies = [e for e in nearby if e["type"] == "PLAYER"]
    resources = [e for e in nearby if e["type"] == "RESOURCE"]
    workbenches = [e for e in nearby if e["type"] == "WORKBENCH"]
    
    # Priority 2: Self-defense (if enemy adjacent and we have weapon)
    if enemies:
        nearest_enemy = agent.find_nearest(enemies, "PLAYER")
        if nearest_enemy and agent.distance_to(nearest_enemy["position"]) <= 1 and agent.has_weapon():
            agent.attack(nearest_enemy["id"])
            return
    
    # Priority 3: Craft if near workbench
    if workbenches:
        wb = agent.find_nearest(workbenches, "WORKBENCH")
        if wb and agent.distance_to(wb["position"]) <= 2:
            for recipe in ['stone-hammer', 'health-potion', 'stone-axe']:
                if agent.can_craft(recipe):
                    agent.craft(recipe)
                    return
    
    # Priority 4: Farm resources
    if resources and not agent.has_weapon():
        target = agent.find_nearest(resources, "RESOURCE")
        if target:
            dist = agent.distance_to(target["position"])
            if dist <= 1:
                agent.harvest(target["id"])
            else:
                agent.move(agent.direction_toward(target["position"]))
            return
    
    # Priority 5: Move toward workbench if have resources but no weapon
    if not agent.has_weapon() and workbenches:
        wb = agent.find_nearest(workbenches, "WORKBENCH")
        if wb:
            agent.move(agent.direction_toward(wb["position"]))
            return
    
    # Priority 6: Already armed → hunt
    if agent.has_weapon() and enemies:
        target = agent.find_nearest(enemies, "PLAYER")
        if target:
            dist = agent.distance_to(target["position"])
            if dist <= 1:
                agent.attack(target["id"])
            else:
                agent.move(agent.direction_toward(target["position"]))
            return
    
    # Default: move toward center
    agent.move(agent.direction_toward(zone["center"]))
```

### 6.3 Diplomat Strategy (`survival_sdk/strategies/diplomat.py`)

Forms alliances via chat, betrays at the end.

```python
"""
Diplomat strategy: talk first, fight last.

Uses TALK action to form alliances. Avoids combat until the final zone shrink.
Betrays alliances when zone radius < 10.
"""

import random

GREETINGS = [
    "Hey, let's team up! I'll watch your back.",
    "Alliance? We both survive longer together.",
    "Don't attack me — I have nothing. Trade?",
    "Truce! There are bigger threats around.",
]

BETRAYAL = [
    "Sorry, only one can survive.",
    "Nothing personal.",
    "It was always going to end this way.",
]

def diplomat_strategy(agent, state):
    me = state["self"]
    nearby = state.get("nearby_entities", [])
    zone = state["zone"]
    
    enemies = [e for e in nearby if e["type"] == "PLAYER"]
    resources = [e for e in nearby if e["type"] == "RESOURCE"]
    
    # Always stay in zone
    if agent.is_outside_zone():
        agent.move(agent.direction_toward(zone["center"]))
        return
    
    # Endgame: zone small → betray and fight
    if zone["radius"] <= 10:
        if enemies and agent.has_weapon():
            target = agent.find_nearest(enemies, "PLAYER")
            if target:
                dist = agent.distance_to(target["position"])
                if dist <= 1:
                    if random.random() < 0.3:
                        agent.talk(random.choice(BETRAYAL))
                    else:
                        agent.attack(target["id"])
                else:
                    agent.move(agent.direction_toward(target["position"]))
                return
    
    # Early/mid game: diplomacy
    if enemies:
        # Talk to nearby players
        if me.get("stamina", 100) > 10:
            agent.talk(random.choice(GREETINGS))
            return
    
    # Farm resources
    if resources:
        target = agent.find_nearest(resources, "RESOURCE")
        if target:
            dist = agent.distance_to(target["position"])
            if dist <= 1:
                agent.harvest(target["id"])
            else:
                agent.move(agent.direction_toward(target["position"]))
            return
    
    # Craft if possible
    for recipe in ['stone-hammer', 'health-potion', 'stone-axe', 'wooden-club']:
        if agent.can_craft(recipe):
            agent.craft(recipe)
            return
    
    # Default: move toward center
    agent.move(agent.direction_toward(zone["center"]))
```

### 6.4 LLM Strategy (`survival_sdk/strategies/llm.py`)

Uses Google's Gemma-3-27B to make decisions. This is the star of the demo.

```python
"""
LLM-powered strategy using Google's Gemma-3-27B.

Each tick, the game state is serialized into a prompt. The LLM reasons about
the optimal action and returns a JSON response.

Requires: pip install protocol-survival-sdk[llm]
Environment: GOOGLE_AI_API_KEY
"""

import json
import os

try:
    import google.generativeai as genai
except ImportError:
    raise ImportError("Install LLM dependencies: pip install protocol-survival-sdk[llm]")


# Initialize once
_model = None

def _get_model():
    global _model
    if _model is None:
        api_key = os.environ.get("GOOGLE_AI_API_KEY")
        if not api_key:
            raise RuntimeError("Set GOOGLE_AI_API_KEY environment variable")
        genai.configure(api_key=api_key)
        _model = genai.GenerativeModel("gemma-3-27b-it")
    return _model


SYSTEM_PROMPT = """You are an AI agent competing in "Protocol: SURVIVAL", a battle royale game.
You must survive by gathering resources, crafting weapons, forming alliances, and eliminating other agents.
The last agent alive wins the prize pool.

RULES:
- You can only see entities within 15 tiles of your position.
- Bare hands deal 1 damage. Weapons deal 8-20 damage. You NEED weapons.
- The safe zone shrinks every 30 seconds. Being outside = 10 HP/tick damage.
- Standing still for 30 seconds = killed by wolves.
- You can chat with nearby agents to form alliances (but betray them later).
- Craft recipes require being within 2 tiles of a workbench.

RECIPES:
- wooden-club: 5 wood → 8 dmg
- stone-axe: 10 wood + 5 stone → 15 dmg (2× tree harvest)
- stone-pickaxe: 10 wood + 5 stone → 12 dmg (2× rock harvest)
- stone-hammer: 10 wood + 10 stone → 20 dmg (best weapon)
- barricade: 5 wood → blocks movement
- health-potion: 5 wood + 3 stone → heals 30 HP

RESPOND WITH ONLY A VALID JSON OBJECT. No explanation, no markdown, no extra text.
Valid actions:
{"action": "MOVE", "direction": "N"}  (N/S/E/W/NE/NW/SE/SW)
{"action": "ATTACK", "target_id": "agent_0x..."}
{"action": "HARVEST", "target_id": "tree_3"}
{"action": "CRAFT", "recipe": "stone-axe"}
{"action": "USE", "item_slot": 0}
{"action": "TALK", "message": "your message here"}
{"action": "IDLE"}
"""


def llm_strategy(agent, state):
    """Send game state to LLM, receive JSON action, execute it."""
    me = state["self"]
    
    user_prompt = f"""CURRENT GAME STATE (Tick {state['tick']}):

YOUR STATUS:
- HP: {me['hp']}/100
- Stamina: {me['stamina']}/100
- Position: {me['position']}
- Kills: {me['kills']}
- Inventory: {json.dumps(me['inventory'])}

ZONE:
- Center: {state['zone']['center']}
- Radius: {state['zone']['radius']}
- Next shrink at tick: {state['zone'].get('next_shrink_tick', 'N/A')}
- Damage outside: {state['zone']['damage_per_tick_outside']}/tick

NEARBY ENTITIES ({len(state.get('nearby_entities', []))} visible):
{json.dumps(state.get('nearby_entities', []), indent=2)}

RECENT MESSAGES:
{json.dumps(state.get('messages', []), indent=2)}

GAME INFO:
- Alive players: {state['alive_count']}
- Elapsed: {state['elapsed_seconds']}s

What is your next action? Respond with ONLY a JSON object."""

    try:
        model = _get_model()
        response = model.generate_content(
            [SYSTEM_PROMPT, user_prompt],
            generation_config={
                "temperature": 0.7,
                "max_output_tokens": 200,
            }
        )
        
        text = response.text.strip()
        # Clean up markdown fencing if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]
        text = text.strip()
        
        action_data = json.loads(text)
        
        if "action" not in action_data:
            print(f"[LLM] Invalid response (no action): {text}")
            agent.idle()
            return
        
        # Execute the action
        action = action_data.pop("action")
        result = agent.act(action, **action_data)
        
        if not result.get("success", True):
            print(f"[LLM] Action failed: {result}")
            
    except json.JSONDecodeError as e:
        print(f"[LLM] Failed to parse response: {e}")
        agent.idle()
    except Exception as e:
        print(f"[LLM] Error: {e}")
        agent.idle()
```

---

## 7. Utility Scripts

### 7.1 Generate Wallets (`scripts/generate_wallets.py`)

```python
"""
Generate N Ethereum wallets for demo agents.
Each wallet gets a random private key.

Usage:
    python scripts/generate_wallets.py --count 10 --output wallets.json
"""

import json
import argparse
from eth_account import Account

def main():
    parser = argparse.ArgumentParser(description="Generate agent wallets")
    parser.add_argument("--count", type=int, required=True, help="Number of wallets to generate")
    parser.add_argument("--output", type=str, default="wallets.json", help="Output file path")
    args = parser.parse_args()
    
    wallets = []
    for i in range(args.count):
        account = Account.create()
        wallets.append({
            "index": i,
            "address": account.address,
            "private_key": account.key.hex(),
        })
        print(f"Wallet {i}: {account.address}")
    
    with open(args.output, 'w') as f:
        json.dump(wallets, f, indent=2)
    
    print(f"\nGenerated {args.count} wallets → {args.output}")
    print(f"⚠️  Keep {args.output} secure — contains private keys!")

if __name__ == "__main__":
    main()
```

### 7.2 Fund Wallets (`scripts/fund_wallets.py`)

```python
"""
Fund agent wallets from a source wallet on Monad Testnet.

Usage:
    python scripts/fund_wallets.py \\
        --source-key 0xYOUR_MAIN_WALLET_PRIVATE_KEY \\
        --wallets wallets.json \\
        --amount 1.1
"""

import json
import argparse
import time
from web3 import Web3
from eth_account import Account

MONAD_RPC = "https://testnet-rpc.monad.xyz/"
CHAIN_ID = 10143

def main():
    parser = argparse.ArgumentParser(description="Fund agent wallets")
    parser.add_argument("--source-key", type=str, required=True, help="Private key of funding wallet (0x...)")
    parser.add_argument("--wallets", type=str, required=True, help="Path to wallets.json")
    parser.add_argument("--amount", type=float, default=1.1, help="MON to send per wallet (default: 1.1)")
    parser.add_argument("--rpc", type=str, default=MONAD_RPC, help="RPC URL")
    args = parser.parse_args()
    
    w3 = Web3(Web3.HTTPProvider(args.rpc))
    source_account = Account.from_key(args.source_key)
    amount_wei = w3.to_wei(args.amount, 'ether')
    
    with open(args.wallets) as f:
        wallets = json.load(f)
    
    print(f"Source wallet: {source_account.address}")
    balance = w3.eth.get_balance(source_account.address)
    print(f"Source balance: {w3.from_wei(balance, 'ether')} MON")
    
    total_needed = amount_wei * len(wallets)
    if balance < total_needed:
        print(f"⚠️  Insufficient balance! Need {w3.from_wei(total_needed, 'ether')} MON")
        return
    
    nonce = w3.eth.get_transaction_count(source_account.address)
    
    for wallet in wallets:
        print(f"\nFunding wallet {wallet['index']}: {wallet['address']}")
        
        tx = {
            'to': Web3.to_checksum_address(wallet['address']),
            'value': amount_wei,
            'chainId': CHAIN_ID,
            'gas': 21000,
            'gasPrice': w3.eth.gas_price,
            'nonce': nonce,
        }
        
        signed = source_account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        print(f"  TX: {tx_hash.hex()}")
        
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        status = "✅" if receipt['status'] == 1 else "❌"
        print(f"  {status} Confirmed in block {receipt['blockNumber']}")
        
        nonce += 1
        time.sleep(0.5)  # Small delay between transactions
    
    print(f"\n🎉 Funded {len(wallets)} wallets with {args.amount} MON each")

if __name__ == "__main__":
    main()
```

### 7.3 Launch Demo (`scripts/launch_demo.py`)

```python
"""
Launch N demo bots concurrently, each in its own thread.

Usage:
    python scripts/launch_demo.py \\
        --wallets wallets.json \\
        --server http://localhost:3001 \\
        --strategy aggressive           # or: gatherer, diplomat, llm
"""

import json
import argparse
import threading
import time
import random
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from survival_sdk.agent import SurvivalAgent
from survival_sdk.strategies.aggressive import aggressive_strategy
from survival_sdk.strategies.gatherer import gatherer_strategy
from survival_sdk.strategies.diplomat import diplomat_strategy

STRATEGIES = {
    'aggressive': aggressive_strategy,
    'gatherer': gatherer_strategy,
    'diplomat': diplomat_strategy,
}

def run_agent(wallet, server_url, strategy_fn, strategy_name, index):
    """Run a single agent in a thread."""
    try:
        agent = SurvivalAgent(
            server_url=server_url,
            private_key=wallet["private_key"],
        )
        
        # Randomize spawn position
        spawn = [random.randint(5, 45), random.randint(5, 45)]
        agent.join(spawn_preference=spawn)
        print(f"🤖 Bot {index} ({strategy_name}): Joined as {agent.display_name}")
        
        agent.run(strategy_fn)
        
    except Exception as e:
        print(f"❌ Bot {index}: Error — {e}")

def main():
    parser = argparse.ArgumentParser(description="Launch demo bots")
    parser.add_argument("--wallets", type=str, required=True, help="Path to wallets.json")
    parser.add_argument("--server", type=str, default="http://localhost:3001", help="Server URL")
    parser.add_argument("--strategy", type=str, default="mixed", 
                        choices=["aggressive", "gatherer", "diplomat", "llm", "mixed"],
                        help="Strategy for all bots (or 'mixed' for variety)")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between joining each bot")
    args = parser.parse_args()
    
    with open(args.wallets) as f:
        wallets = json.load(f)
    
    # Handle LLM strategy separately (requires API key)
    if args.strategy == "llm":
        from survival_sdk.strategies.llm import llm_strategy
        STRATEGIES['llm'] = llm_strategy
    
    print(f"🎮 Launching {len(wallets)} bots against {args.server}")
    
    threads = []
    strategy_names = list(STRATEGIES.keys())
    
    for i, wallet in enumerate(wallets):
        # Pick strategy
        if args.strategy == "mixed":
            strat_name = strategy_names[i % len(strategy_names)]
        else:
            strat_name = args.strategy
        
        strat_fn = STRATEGIES[strat_name]
        
        t = threading.Thread(
            target=run_agent,
            args=(wallet, args.server, strat_fn, strat_name, i),
            daemon=True,
        )
        threads.append(t)
        t.start()
        
        time.sleep(args.delay)  # Stagger joins
    
    print(f"\n🏟️  All {len(wallets)} bots launched. Press Ctrl+C to stop.\n")
    
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down...")

if __name__ == "__main__":
    main()
```

---

## 8. Example: Simplest Bot (`examples/basic_bot.py`)

```python
"""
The absolute simplest bot — just moves toward the center every tick.
Great for testing that the SDK works.
"""

from survival_sdk import SurvivalAgent

def simple_strategy(agent, state):
    zone = state["zone"]
    agent.move(agent.direction_toward(zone["center"]))

if __name__ == "__main__":
    bot = SurvivalAgent(
        server_url="http://localhost:3001",
        private_key="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",  # Hardhat #0
    )
    bot.join()
    bot.run(simple_strategy)
```

---

## 9. `survival_sdk/__init__.py`

```python
from .agent import SurvivalAgent

__all__ = ["SurvivalAgent"]
__version__ = "0.1.0"
```

---

## 10. Testing Plan

### 10.1 SDK Unit Tests

```python
# tests/test_agent.py
import pytest
from unittest.mock import patch, MagicMock
from survival_sdk.agent import SurvivalAgent

def test_manhattan_dist():
    assert SurvivalAgent._manhattan_dist([0,0], [3,4]) == 7

def test_direction_toward():
    agent = SurvivalAgent.__new__(SurvivalAgent)
    agent._last_state = {"self": {"position": [10, 10]}}
    assert agent.direction_toward([15, 10]) == "E"
    assert agent.direction_toward([5, 10]) == "W"
    assert agent.direction_toward([10, 5]) == "N"
    assert agent.direction_toward([10, 15]) == "S"
```

### 10.2 Integration Test (with DEV_SKIP_PAYMENT)

```bash
# Terminal 1: Start server
cd server && DEV_SKIP_PAYMENT=true npm run dev

# Terminal 2: Run basic bot
cd sdk && python examples/basic_bot.py

# Expect: Bot joins, prints display name, begins polling state
```

### 10.3 Full Demo Test (10 bots)

```bash
python scripts/generate_wallets.py --count 10 --output wallets.json
python scripts/launch_demo.py --wallets wallets.json --strategy mixed
```

---

## 11. Definition of Done

- [ ] `pip install -e .` in `sdk/` installs the package
- [ ] `SurvivalAgent` handles full x402 join flow (402 → pay → confirm)
- [ ] `agent.get_state()` returns parsed game state
- [ ] `agent.move()`, `.attack()`, `.harvest()`, `.craft()`, `.use()`, `.talk()`, `.idle()` all work
- [ ] `agent.run(strategy_fn)` loops until game over or death
- [ ] 3 built-in strategies: aggressive, gatherer, diplomat
- [ ] LLM strategy works with Gemma-3-27B via `google-generativeai`
- [ ] `generate_wallets.py` creates N wallets → `wallets.json`
- [ ] `fund_wallets.py` sends MON from source wallet to N wallets
- [ ] `launch_demo.py` runs N bots concurrently in threads
- [ ] Helper methods: `find_nearest`, `direction_toward`, `distance_to`, `has_weapon`, `is_outside_zone`, `can_craft`
