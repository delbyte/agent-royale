"""
LLM-powered strategy — model-agnostic AI brain for Protocol: SURVIVAL.

This strategy is designed to work with ANY LLM provider. You bring the brain,
we handle the game plumbing.

Architecture:
    The LLM runs in a BACKGROUND THREAD to avoid blocking the 1-second tick loop.

    Each tick:
    1. If the LLM has a pending action, VALIDATE it against the CURRENT state
       — adapt or discard if the world has changed since the LLM saw it
    2. If no LLM action is ready, use a lightweight rule-based fallback for
       emergencies (zone escape, HP critical, self-defense)
    3. If the LLM is idle, kick off a new background think request with latest state

    The LLM provides STRATEGIC INTENT. The validation layer ADAPTS it to reality.

    ┌─ Game Loop (1s/tick) ──────────────────────────────────────────┐
    │ tick 42: LLM thinking... → fallback (escape zone)             │
    │ tick 43: LLM thinking... → fallback (idle, regen stamina)     │
    │ tick 44: LLM thinking... → fallback (self-defense attack)     │
    │ tick 45: LLM responded!                                       │
    │          Intent: ATTACK player_xyz                             │
    │          Validate: player_xyz visible but 3 tiles away (moved) │
    │          Adapt: MOVE toward player_xyz instead                 │
    │ tick 45: kick off new think with latest state                  │
    │ tick 46: LLM thinking... → fallback                           │
    └────────────────────────────────────────────────────────────────┘

    VALIDATION LAYER — 22 checks across all action types:
    ┌────────────────────────────────────────────────────────────────┐
    │ GLOBAL (all actions):                                          │
    │  ✓ Agent dead → skip all                                       │
    │  ✓ Unknown action type → map to IDLE                           │
    │                                                                │
    │ MOVE:                                                          │
    │  ✓ Stamina < 3 → force IDLE (regen)                            │
    │  ✓ Invalid direction → snap to nearest valid                   │
    │  ✓ Target tile blocked (BARRICADE/RESOURCE) → slide to alt dir │
    │  ✓ Outside zone → override to zone center                      │
    │  ✓ Map boundary → clamp direction away from edge               │
    │  ✓ AFK risk (idle_ticks approaching 30) → force displacement   │
    │                                                                │
    │ ATTACK:                                                        │
    │  ✓ Stamina < 10 → force IDLE                                   │
    │  ✓ Target moved (not adjacent) → MOVE toward                   │
    │  ✓ Target died/invisible → substitute nearest player           │
    │  ✓ Target is RESOURCE/WORKBENCH → convert to HARVEST           │
    │  ✓ Self-attack → substitute nearest player                     │
    │                                                                │
    │ HARVEST:                                                       │
    │  ✓ Stamina < 5 → force IDLE                                    │
    │  ✓ Inventory full → skip (avoid wasting items)                 │
    │  ✓ Target is WORKBENCH → can't harvest, find nearest resource  │
    │  ✓ Target moved/gone → substitute nearest resource/loot        │
    │                                                                │
    │ CRAFT:                                                         │
    │  ✓ Invalid recipe name → discard                               │
    │  ✓ Materials depleted → discard                                │
    │  ✓ No workbench nearby → MOVE toward workbench                 │
    │                                                                │
    │ USE:                                                           │
    │  ✓ Slot out of bounds → find valid slot                        │
    │  ✓ Slot empty → find same item in another slot                 │
    │  ✓ Non-consumable item (wood/stone) → skip                     │
    │  ✓ HP already full → skip (don't waste potion)                 │
    │                                                                │
    │ TALK:                                                          │
    │  ✓ Message too long (>200) → truncate                          │
    │  ✓ Chat on cooldown (< 3 ticks) → convert to IDLE              │
    └────────────────────────────────────────────────────────────────┘

Usage with Google Gemini:
    from survival_sdk.strategies.llm import LLMStrategy, create_gemini_backend
    strategy = LLMStrategy(backend=create_gemini_backend("gemini-2.5-flash"))
    agent.run(strategy)

Usage with OpenAI:
    from openai import OpenAI
    client = OpenAI()
    def openai_backend(prompt: str) -> str:
        resp = client.chat.completions.create(
            model="gpt-4o", messages=[{"role": "user", "content": prompt}]
        )
        return resp.choices[0].message.content
    strategy = LLMStrategy(backend=openai_backend)
    agent.run(strategy)

Usage with any HTTP API:
    import requests
    def my_backend(prompt: str) -> str:
        resp = requests.post("http://my-llm/generate", json={"prompt": prompt})
        return resp.json()["text"]
    strategy = LLMStrategy(backend=my_backend)
    agent.run(strategy)
"""

import copy
import json
import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from survival_sdk.agent import SurvivalAgent

logger = logging.getLogger("survival_sdk.strategies.llm")

# ────────────────────────────────────────────────
#  CONSTANTS (mirrored from server gameConfig.js)
# ────────────────────────────────────────────────

MAP_SIZE = 50
STAMINA_COST_MOVE = 3
STAMINA_COST_ATTACK = 10
STAMINA_COST_HARVEST = 5
PLAYER_INVENTORY_SLOTS = 5
AFK_KILL_TICKS = 30
CHAT_MAX_LENGTH = 200
CHAT_COOLDOWN_TICKS = 3
PLAYER_MAX_HP = 100

VALID_DIRECTIONS = {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}

DIRECTION_DELTAS = {
    "N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0),
    "NE": (1, -1), "NW": (-1, -1), "SE": (1, 1), "SW": (-1, 1),
}

VALID_RECIPES = {
    "wooden-club", "stone-axe", "stone-pickaxe",
    "stone-hammer", "barricade", "health-potion",
}

# Items that do something when USEd. Everything else is a no-op on the server.
CONSUMABLE_ITEMS = {"health-potion"}

# Harvestable entity types
HARVESTABLE_TYPES = {"RESOURCE", "LOOT"}

# Attackable entity types (players handled separately)
ATTACKABLE_ENTITY_TYPES = {"BARRICADE"}

# ────────────────────────────────────────────────
#  SYSTEM PROMPT — Teaches the LLM to pick actions
# ────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an AI agent playing Protocol: SURVIVAL, a battle royale game.

RULES:
- 50×50 grid map. You can see entities within 15 tiles.
- You submit ONE action per tick (1 second per tick).
- Zone shrinks over time. Being outside the zone deals 10 damage per tick.
- Stamina: MOVE costs 3, ATTACK costs 10, HARVEST costs 5, IDLE regens +5.
- You die at 0 HP. Last agent standing wins the prize pool.
- Standing on the same tile for 30 ticks triggers wolf kill (AFK death).

IMPORTANT LATENCY NOTE:
Your response will be used ~3-6 ticks AFTER you see this state. The world WILL
have changed. Your action will be ADAPTED to the current reality:
- If you say ATTACK a target, but the target moved, you'll move TOWARD the target instead.
- If you say HARVEST a tree, but you moved, you'll move toward the tree instead.
- If you say USE an item that was already consumed, the action is skipped.
- If stamina is too low for your chosen action, you'll IDLE to regen instead.
- MOVE and IDLE are always safe — they don't depend on specific positions.

STRATEGY TIPS FOR HANDLING LATENCY:
- Prefer DIRECTIONAL thinking: "move NE toward resources" over "harvest tree_17"
- If you want to attack someone, the system will chase them for you
- MOVE actions are always valid. Target-specific actions may need adapting.
- Think in terms of GOALS, not precise micro-actions.
- Keep stamina above 10 when hunting — you need it to attack.
- Don't waste health potions at full HP.
- Check inventory space before harvesting — full inventory = wasted harvest.

ACTIONS (pick exactly ONE per tick):
- MOVE: direction must be one of N, S, E, W, NE, NW, SE, SW
- ATTACK: target_id must be an adjacent PLAYER or BARRICADE (will chase if not adjacent)
- HARVEST: target_id must be an adjacent RESOURCE or LOOT (will move toward if not adjacent)
- CRAFT: recipe must be one of: wooden-club, stone-axe, stone-pickaxe, stone-hammer, barricade, health-potion
         Requires being within 2 tiles of a WORKBENCH and having sufficient materials.
- USE: item_slot is the 0-based inventory index of a consumable item to use
- TALK: message is a string (max 200 chars, 3 tick cooldown between chats)
- IDLE: do nothing, regenerate +5 stamina

RECIPES:
- wooden-club:   5 wood → 8 damage weapon
- stone-axe:     10 wood, 5 stone → 15 damage weapon (2x tree harvest)
- stone-pickaxe: 10 wood, 5 stone → 12 damage weapon (2x rock harvest)
- stone-hammer:  10 wood, 10 stone → 20 damage weapon
- barricade:     5 wood → placeable shield with 30 HP
- health-potion: 5 wood, 3 stone → heals 30 HP

Respond with ONLY a JSON object. No markdown, no explanation.
Format: {"action": "<ACTION>", ...params}

Examples:
  {"action": "MOVE", "direction": "NE"}
  {"action": "ATTACK", "target_id": "player_abc123"}
  {"action": "HARVEST", "target_id": "tree_17"}
  {"action": "CRAFT", "recipe": "wooden-club"}
  {"action": "USE", "item_slot": 0}
  {"action": "TALK", "message": "Let's team up!"}
  {"action": "IDLE"}
"""


def _format_state_prompt(state: dict) -> str:
    """Convert game state dict into a readable prompt for the LLM."""
    me = state.get("self", {})
    zone = state.get("zone", {})
    entities = state.get("nearby_entities", [])

    # Summarize inventory
    inv_items = []
    for i, slot in enumerate(me.get("inventory", [])):
        if slot:
            qty = slot.get("quantity", 1)
            inv_items.append(f"  [{i}] {slot.get('item', '?')} x{qty}")
    inv_str = "\n".join(inv_items) if inv_items else "  (empty)"

    # Count filled slots
    filled_slots = sum(1 for s in me.get("inventory", []) if s is not None)
    total_slots = len(me.get("inventory", []))

    # Summarize nearby entities
    entity_lines = []
    for e in entities[:15]:  # Cap to avoid token overflow
        parts = [
            f"type={e.get('type', '?')}",
            f"subtype={e.get('subtype', '-')}",
            f"pos={e.get('position', [0, 0])}",
        ]
        if e.get("display_name"):
            parts.append(f"name={e['display_name']}")
        if e.get("hp") is not None:
            parts.append(f"hp={e['hp']}")
        if e.get("holding"):
            parts.append(f"holding={e['holding']}")
        entity_lines.append(
            f"  {e.get('id', '?')}: {', '.join(parts)}"
        )
    entities_str = (
        "\n".join(entity_lines) if entity_lines else "  (none visible)"
    )

    # Recent messages
    messages = state.get("messages", [])
    msg_lines = []
    for m in messages[-5:]:
        msg_lines.append(
            f"  [{m.get('from_name', '?')}]: {m.get('text', '')}"
        )
    msg_str = "\n".join(msg_lines) if msg_lines else "  (no messages)"

    return f"""CURRENT STATE (Tick {state.get('tick', 0)}):

YOUR STATUS:
  Name: {me.get('display_name', '?')}
  HP: {me.get('hp', 0)}/100
  Stamina: {me.get('stamina', 0)}/100
  Position: {me.get('position', [0, 0])}
  Kills: {me.get('kills', 0)}

INVENTORY ({filled_slots}/{total_slots} slots used):
{inv_str}

ZONE:
  Center: {zone.get('center', [25, 25])}
  Radius: {zone.get('radius', 35)}
  Damage outside: {zone.get('damage_per_tick_outside', 10)}/tick

NEARBY ENTITIES:
{entities_str}

RECENT CHAT:
{msg_str}

ALIVE PLAYERS: {state.get('alive_count', '?')}

Choose your action. Respond with ONLY a JSON object."""


# ────────────────────────────────────────────────
#  PROVIDER BACKENDS
# ────────────────────────────────────────────────


def create_gemini_backend(
    model: str = "gemini-2.5-flash",
    api_key: Optional[str] = None,
) -> Callable[[str], str]:
    """
    Create a Gemini backend callable for LLMStrategy.

    Requires: pip install google-generativeai

    Args:
        model: Gemini model name (default: gemini-2.5-flash)
        api_key: API key. If None, reads from GOOGLE_AI_API_KEY env var.

    Returns:
        Callable that takes a prompt string and returns the LLM's response string.
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError(
            "google-generativeai is required for the Gemini backend. "
            "Install with: pip install protocol-survival-sdk[llm]"
        )

    import os

    key = (
        api_key
        or os.environ.get("GOOGLE_AI_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )
    if not key:
        raise ValueError(
            "Gemini API key required. Set GOOGLE_AI_API_KEY env var or pass api_key."
        )

    client = genai.Client(api_key=key)

    def backend(prompt: str) -> str:
        full_prompt = SYSTEM_PROMPT + "\n\n" + prompt
        response = client.models.generate_content(
            model=model,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=256,
            ),
        )
        return response.text

    return backend


# ────────────────────────────────────────────────
#  HELPER UTILITIES
# ────────────────────────────────────────────────


def _chebyshev_dist(a: list, b: list) -> int:
    """Chebyshev distance (king-move distance) — used by server for adjacency."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def _snap_direction(raw: str) -> str:
    """Map a potentially invalid direction to the nearest valid one."""
    raw_upper = raw.upper().strip() if isinstance(raw, str) else "N"
    if raw_upper in VALID_DIRECTIONS:
        return raw_upper
    # Fuzzy match: try common typos / partial matches
    fuzzy_map = {
        "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
        "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE", "SOUTHWEST": "SW",
        "UP": "N", "DOWN": "S", "LEFT": "W", "RIGHT": "E",
    }
    if raw_upper in fuzzy_map:
        return fuzzy_map[raw_upper]
    return "N"  # ultimate fallback


def _tile_after_move(pos: list, direction: str) -> tuple:
    """Calculate the resulting tile [x, y] after moving in direction."""
    dx, dy = DIRECTION_DELTAS.get(direction, (0, 0))
    return (pos[0] + dx, pos[1] + dy)


def _is_out_of_bounds(x: int, y: int) -> bool:
    """Check if tile is outside the 50x50 map."""
    return x < 0 or x >= MAP_SIZE or y < 0 or y >= MAP_SIZE


def _inventory_has_room(inventory: list) -> bool:
    """Check if there's at least one empty inventory slot or room to stack."""
    for slot in inventory:
        if slot is None:
            return True
    return False


def _count_consecutive_idle_ticks(state: dict) -> int:
    """
    Estimate AFK risk from state. The server tracks idleTicks internally;
    we approximate by checking if our last known position hasn't changed.
    This is stored in the strategy instance, but we also check state hints.
    """
    # The server doesn't expose idleTicks directly, so this is a best-effort
    # heuristic. The strategy tracks it internally.
    return 0  # overridden by instance tracking


# ────────────────────────────────────────────────
#  LLM STRATEGY CLASS (Async, Validated)
# ────────────────────────────────────────────────


class LLMStrategy:
    """
    Model-agnostic LLM strategy with async background thinking and
    comprehensive action validation against current game state.

    The LLM runs in a background thread so it never blocks the tick loop.
    When an LLM action arrives, it goes through a validation & adaptation
    layer that checks whether the action is still valid given the CURRENT
    game state (not the stale state the LLM saw).

    22 distinct validations across all action types prevent wasted ticks:
    - Stamina gates (MOVE < 3, ATTACK < 10, HARVEST < 5)
    - Map boundary / blocked tile detection
    - Zone override for survival
    - AFK wolf-kill prevention
    - Target death/movement adaptation
    - Entity type mismatch correction (ATTACK tree → HARVEST)
    - Inventory full detection for HARVEST
    - Non-consumable USE prevention
    - Over-heal waste prevention
    - Chat cooldown / length enforcement
    - Invalid direction / recipe name handling
    - Self-attack prevention

    The backend callable signature: (prompt: str) → str
    """

    def __init__(
        self,
        backend: Callable[[str], str],
        max_stale_ticks: int = 8,
    ):
        """
        Args:
            backend: Callable(prompt_str) → response_str.
                     Must return a JSON string with an action.
            max_stale_ticks: Maximum tick age before discarding an LLM response.
                            Default 8 — generous enough for slow LLMs (2-5s).
                            Actions are validated anyway, so staleness is a
                            last-resort discard for wildly outdated responses.
        """
        self.backend = backend
        self.max_stale_ticks = max_stale_ticks

        # ── Background thinking state ──
        self._pending_action: Optional[dict] = None
        self._pending_tick: Optional[int] = None
        self._thinking = False
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._last_consumed_tick: Optional[int] = None

        # ── AFK tracking ──
        self._last_position: Optional[list] = None
        self._consecutive_idle_ticks = 0

        # ── Chat cooldown tracking ──
        self._last_chat_tick = -999

        # ── Stats ──
        self._total_llm_actions = 0
        self._total_adapted_actions = 0
        self._total_fallback_actions = 0
        self._total_stale_discards = 0
        self._total_invalid_discards = 0
        self._total_stamina_gates = 0
        self._total_afk_saves = 0

    def __call__(self, agent: "SurvivalAgent", state: dict):
        """
        Called by agent.run() each tick. Non-blocking.

        Flow:
        1. Check for pending LLM action → validate against CURRENT state → execute
        2. If no valid action → emergency fallback
        3. If LLM is idle → start new think cycle
        """
        current_tick = state.get("tick", 0)
        me = state.get("self", {})

        # ── Update AFK tracking ──
        current_pos = me.get("position", [25, 25])
        if self._last_position and current_pos == self._last_position:
            self._consecutive_idle_ticks += 1
        else:
            self._consecutive_idle_ticks = 0
        self._last_position = list(current_pos)

        # ── GLOBAL CHECK: Dead agent ──
        if not me.get("alive", True):
            logger.debug(f"[Tick {current_tick}] Agent is dead. Skipping.")
            return

        # ── 1. Check for ready LLM action ──
        raw_action = self._consume_pending_action(current_tick)
        if raw_action is not None:
            validated = self._validate_and_adapt(raw_action, agent, state)
            if validated is not None:
                try:
                    was_adapted = validated != raw_action
                    self._execute_action(agent, validated)
                    self._total_llm_actions += 1
                    if was_adapted:
                        self._total_adapted_actions += 1

                    label = "adapted" if was_adapted else "exact"
                    logger.info(
                        f"[Tick {current_tick}] LLM {label}: "
                        f"{raw_action.get('action')} → {validated.get('action')} "
                        f"(thought at tick {self._last_consumed_tick})"
                    )
                    self._maybe_start_thinking(state, current_tick)
                    return
                except Exception as e:
                    logger.warning(f"LLM action execution failed: {e}")
            else:
                self._total_invalid_discards += 1
                logger.debug(
                    f"[Tick {current_tick}] LLM action fully invalid, "
                    f"using fallback"
                )

        # ── 2. No valid LLM action — kick off thinking if idle ──
        self._maybe_start_thinking(state, current_tick)

        # ── 3. Emergency fallback ──
        self._emergency_fallback(agent, state)
        self._total_fallback_actions += 1

        if current_tick % 10 == 0:
            logger.info(
                f"[Tick {current_tick}] Stats: "
                f"llm={self._total_llm_actions} "
                f"adapted={self._total_adapted_actions} "
                f"fallback={self._total_fallback_actions} "
                f"stale={self._total_stale_discards} "
                f"invalid={self._total_invalid_discards} "
                f"stamina_gates={self._total_stamina_gates} "
                f"afk_saves={self._total_afk_saves}"
            )

    # ────────────────────────────
    #  Background Thinking
    # ────────────────────────────

    def _maybe_start_thinking(self, state: dict, current_tick: int):
        """Start a new LLM request if not already thinking."""
        with self._lock:
            if self._thinking:
                return
            self._thinking = True

        state_snapshot = copy.deepcopy(state)
        self._executor.submit(self._think, state_snapshot, current_tick)

    def _think(self, state_snapshot: dict, request_tick: int):
        """Background thread: call the LLM and store the result."""
        try:
            prompt = _format_state_prompt(state_snapshot)
            raw_response = self.backend(prompt)
            action_data = self._parse_action(raw_response)

            with self._lock:
                self._pending_action = action_data
                self._pending_tick = request_tick

            logger.debug(
                f"LLM responded for tick {request_tick}: "
                f"{action_data.get('action', '?')}"
            )
        except Exception as e:
            logger.warning(f"LLM think failed: {e}")
        finally:
            with self._lock:
                self._thinking = False

    def _consume_pending_action(self, current_tick: int) -> Optional[dict]:
        """Atomically consume a pending LLM action if fresh enough."""
        with self._lock:
            if self._pending_action is None:
                return None

            age = current_tick - (self._pending_tick or 0)

            if age > self.max_stale_ticks:
                logger.debug(
                    f"Discarding stale LLM action from tick "
                    f"{self._pending_tick} (age={age} > max={self.max_stale_ticks})"
                )
                self._pending_action = None
                self._pending_tick = None
                self._total_stale_discards += 1
                return None

            action = self._pending_action
            self._last_consumed_tick = self._pending_tick
            self._pending_action = None
            self._pending_tick = None
            return action

    # ────────────────────────────────────────
    #  Action Validation & Adaptation Layer
    # ────────────────────────────────────────

    def _validate_and_adapt(
        self,
        action_data: dict,
        agent: "SurvivalAgent",
        current_state: dict,
    ) -> Optional[dict]:
        """
        Validate an LLM action against the CURRENT game state.
        Adapt if still achievable, return None if completely invalid.

        This method is the core safety net between LLM intent and reality.
        It mirrors the server's rejection conditions so we never waste a tick
        sending an action the server will silently discard.

        Returns:
            Adapted action dict, or None if the action is completely invalid
            and should be discarded (fallback will be used instead).
        """
        action = action_data.get("action", "IDLE").upper()
        me = current_state.get("self", {})
        entities = current_state.get("nearby_entities", [])
        my_pos = me.get("position", [25, 25])
        stamina = me.get("stamina", 0)

        # ── AFK OVERRIDE ──
        # If we're about to be wolf-killed (25+ ticks idle), force a MOVE.
        # We override even if the LLM wants to MOVE, to ensure it's a SAFE move
        # (the LLM might be repeatedly trying to move into a wall).
        if self._consecutive_idle_ticks >= AFK_KILL_TICKS - 5:
            # Force a move to avoid AFK death
            self._total_afk_saves += 1
            if stamina >= STAMINA_COST_MOVE:
                direction = self._pick_safe_move_direction(
                    agent, my_pos, current_state
                )
                return {"action": "MOVE", "direction": direction}
            # Even if stamina is low, try to move — it'll regen next tick or fail safely
            return {"action": "MOVE", "direction": "N"}


        # ── Dispatch to type-specific validators ──
        if action == "ATTACK":
            return self._validate_attack(
                action_data, agent, entities, my_pos, me
            )
        elif action == "HARVEST":
            return self._validate_harvest(
                action_data, agent, entities, my_pos, me
            )
        elif action == "USE":
            return self._validate_use(action_data, me)
        elif action == "CRAFT":
            return self._validate_craft(
                action_data, agent, entities, my_pos
            )
        elif action == "MOVE":
            return self._validate_move(
                action_data, agent, current_state, my_pos
            )
        elif action == "TALK":
            return self._validate_talk(
                action_data, current_state
            )
        elif action == "IDLE":
            return {"action": "IDLE"}
        else:
            # Unknown action type → map to IDLE
            logger.debug(f"Unknown LLM action type '{action}', mapping to IDLE")
            return {"action": "IDLE"}

    # ── MOVE validation ──

    def _validate_move(
        self,
        action_data: dict,
        agent: "SurvivalAgent",
        current_state: dict,
        my_pos: list,
    ) -> dict:
        """
        Validate MOVE intent.

        Checks:
        1. Stamina ≥ 3 (STAMINA_COST_MOVE) → IDLE if insufficient
        2. Valid direction string → snap if invalid
        3. Outside zone → override to zone center direction
        4. Target tile in-bounds (0-49 on each axis) → find alt direction
        5. Target tile not blocked by BARRICADE/RESOURCE → find alt direction
        """
        me = current_state.get("self", {})
        stamina = me.get("stamina", 0)

        # 1. Stamina gate
        if stamina < STAMINA_COST_MOVE:
            self._total_stamina_gates += 1
            logger.debug(
                f"MOVE stamina gate: {stamina} < {STAMINA_COST_MOVE}, "
                f"forcing IDLE to regen"
            )
            return {"action": "IDLE"}

        # 2. Snap direction
        raw_dir = action_data.get("direction", "N")
        direction = _snap_direction(raw_dir)

        # 3. Zone override — if outside zone, always move toward center
        if agent.is_outside_zone():
            zone_center = current_state.get("zone", {}).get(
                "center", [25, 25]
            )
            return {
                "action": "MOVE",
                "direction": agent.direction_toward(zone_center),
            }

        # 4. Map boundary check
        nx, ny = _tile_after_move(my_pos, direction)
        if _is_out_of_bounds(nx, ny):
            # Try to find an alternative direction that's in-bounds
            alt = self._find_alt_direction(my_pos, direction)
            if alt:
                return {"action": "MOVE", "direction": alt}
            # All directions blocked — idle instead
            return {"action": "IDLE"}

        # 5. Blocked tile check — we don't have the full grid, but we can
        # check nearby_entities for BARRICADE/RESOURCE at target tile
        entities = current_state.get("nearby_entities", [])
        for e in entities:
            epos = e.get("position", [-1, -1])
            etype = e.get("type", "")
            if epos[0] == nx and epos[1] == ny:
                if etype in ("BARRICADE", "RESOURCE"):
                    # Target tile is blocked — find alt or idle
                    alt = self._find_alt_direction(
                        my_pos, direction, blocked_tiles=[(nx, ny)]
                    )
                    if alt:
                        return {"action": "MOVE", "direction": alt}
                    return {"action": "IDLE"}

        return {"action": "MOVE", "direction": direction}

    def _find_alt_direction(
        self,
        my_pos: list,
        original: str,
        blocked_tiles: list = None,
    ) -> Optional[str]:
        """
        Find an alternative valid direction when the original is blocked.
        Tries nearby directions first (clockwise rotation).
        """
        # Direction rotation order for finding alternatives
        rotation_order = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        blocked = set(blocked_tiles or [])

        try:
            idx = rotation_order.index(original)
        except ValueError:
            idx = 0

        # Try ±1, ±2, etc. from original direction
        for offset in [1, -1, 2, -2, 3, -3, 4]:
            alt_dir = rotation_order[(idx + offset) % 8]
            nx, ny = _tile_after_move(my_pos, alt_dir)
            if not _is_out_of_bounds(nx, ny) and (nx, ny) not in blocked:
                return alt_dir

        return None

    def _pick_safe_move_direction(
        self,
        agent: "SurvivalAgent",
        my_pos: list,
        state: dict,
    ) -> str:
        """Pick a valid move direction — for AFK escape or generic displacement."""
        # Prefer moving toward zone center
        zone_center = state.get("zone", {}).get("center", [25, 25])
        direction = agent.direction_toward(zone_center)

        # Verify it's not blocked
        nx, ny = _tile_after_move(my_pos, direction)
        if not _is_out_of_bounds(nx, ny):
            return direction

        # Find any valid direction
        alt = self._find_alt_direction(my_pos, direction)
        return alt or "N"

    # ── ATTACK validation ──

    def _validate_attack(
        self,
        action_data: dict,
        agent: "SurvivalAgent",
        entities: list,
        my_pos: list,
        me: dict,
    ) -> Optional[dict]:
        """
        Validate ATTACK intent.

        Checks:
        1. Stamina ≥ 10 (STAMINA_COST_ATTACK) → IDLE if insufficient
        2. Self-attack → substitute nearest player
        3. Target exists in nearby entities?
           a. Target is PLAYER or BARRICADE + adjacent → attack (exact)
           b. Target is PLAYER but not adjacent → MOVE toward (adapt)
           c. Target is RESOURCE/WORKBENCH → convert to HARVEST if adjacent
        4. Target gone → attack nearest visible player/barricade
        5. No attackable entities → None (fully invalid)
        """
        stamina = me.get("stamina", 0)

        # 1. Stamina gate
        if stamina < STAMINA_COST_ATTACK:
            self._total_stamina_gates += 1
            logger.debug(
                f"ATTACK stamina gate: {stamina} < {STAMINA_COST_ATTACK}, "
                f"forcing IDLE"
            )
            return {"action": "IDLE"}

        target_id = action_data.get("target_id")

        # 2. Self-attack prevention
        my_id = me.get("id", "")
        if target_id and target_id == my_id:
            logger.debug("Self-attack prevented, substituting nearest player")
            target_id = None  # Fall through to nearest-player logic

        # 3. Find target in CURRENT entities
        target = None
        if target_id:
            target = next(
                (e for e in entities if e.get("id") == target_id), None
            )

        if target is not None:
            target_type = target.get("type", "")
            dist = _chebyshev_dist(my_pos, target["position"])

            # 3c. Entity type mismatch: ATTACK on RESOURCE/WORKBENCH
            if target_type in ("RESOURCE", "LOOT"):
                if dist <= 1:
                    return {"action": "HARVEST", "target_id": target_id}
                else:
                    direction = agent.direction_toward(target["position"])
                    return {"action": "MOVE", "direction": direction}
            elif target_type == "WORKBENCH":
                # Can't attack or harvest workbenches — ignore
                target = None  # Fall through to nearest player
            elif target_type in ("PLAYER",) or target_type in ATTACKABLE_ENTITY_TYPES:
                if dist <= 1:
                    # 3a. Adjacent and attackable
                    return action_data
                else:
                    # 3b. Not adjacent — chase
                    direction = agent.direction_toward(target["position"])
                    return {"action": "MOVE", "direction": direction}
            else:
                target = None  # Unknown entity type

        # 4. Target disappeared — try nearest visible player
        nearest_player = agent.find_nearest(entities, "PLAYER")
        if nearest_player:
            # Don't substitute with self
            if nearest_player.get("id") != my_id:
                dist = _chebyshev_dist(my_pos, nearest_player["position"])
                if dist <= 1:
                    return {
                        "action": "ATTACK",
                        "target_id": nearest_player["id"],
                    }
                else:
                    direction = agent.direction_toward(
                        nearest_player["position"]
                    )
                    return {"action": "MOVE", "direction": direction}

        # Try barricades as fallback attack targets
        for e in entities:
            if e.get("type") == "BARRICADE":
                dist = _chebyshev_dist(my_pos, e["position"])
                if dist <= 1:
                    return {"action": "ATTACK", "target_id": e["id"]}

        # 5. No attackable entities visible
        return None

    # ── HARVEST validation ──

    def _validate_harvest(
        self,
        action_data: dict,
        agent: "SurvivalAgent",
        entities: list,
        my_pos: list,
        me: dict,
    ) -> Optional[dict]:
        """
        Validate HARVEST intent.

        Checks:
        1. Stamina ≥ 5 (STAMINA_COST_HARVEST) → IDLE if insufficient
        2. Inventory full → skip to avoid losing items
        3. Target exists?
           a. Target is RESOURCE/LOOT + adjacent → harvest (exact)
           b. Target is RESOURCE/LOOT but not adjacent → MOVE toward
           c. Target is WORKBENCH → can't harvest, find alt
        4. Target gone → find nearest resource/loot
        5. No harvestable entities → None
        """
        stamina = me.get("stamina", 0)
        inventory = me.get("inventory", [])

        # 1. Stamina gate
        if stamina < STAMINA_COST_HARVEST:
            self._total_stamina_gates += 1
            logger.debug(
                f"HARVEST stamina gate: {stamina} < {STAMINA_COST_HARVEST}, "
                f"forcing IDLE"
            )
            return {"action": "IDLE"}

        # 2. Inventory full check
        if not _inventory_has_room(inventory):
            logger.debug(
                "HARVEST blocked: inventory full — items would be lost"
            )
            return None

        target_id = action_data.get("target_id")

        # 3. Find target
        target = next(
            (e for e in entities if e.get("id") == target_id), None
        )

        if target is not None:
            target_type = target.get("type", "")

            # 3c. Can't harvest workbenches
            if target_type == "WORKBENCH":
                logger.debug("Can't harvest WORKBENCH, finding alternative")
                target = None  # Fall through to nearest resource
            elif target_type in HARVESTABLE_TYPES:
                dist = _chebyshev_dist(my_pos, target["position"])
                if dist <= 1:
                    return action_data
                else:
                    direction = agent.direction_toward(target["position"])
                    return {"action": "MOVE", "direction": direction}
            elif target_type == "PLAYER":
                # LLM confused harvest with attack
                dist = _chebyshev_dist(my_pos, target["position"])
                if dist <= 1:
                    return {"action": "ATTACK", "target_id": target_id}
                else:
                    direction = agent.direction_toward(target["position"])
                    return {"action": "MOVE", "direction": direction}
            else:
                target = None

        # 4. Target gone — find nearest resource or loot
        nearest_resource = agent.find_nearest(entities, "RESOURCE")
        if not nearest_resource:
            # Also try LOOT (crates/barrels)
            nearest_resource = agent.find_nearest(entities, "LOOT")

        if nearest_resource:
            dist = _chebyshev_dist(my_pos, nearest_resource["position"])
            if dist <= 1:
                return {
                    "action": "HARVEST",
                    "target_id": nearest_resource["id"],
                }
            else:
                direction = agent.direction_toward(
                    nearest_resource["position"]
                )
                return {"action": "MOVE", "direction": direction}

        # 5. Nothing to harvest
        return None

    # ── USE validation ──

    def _validate_use(
        self, action_data: dict, me: dict
    ) -> Optional[dict]:
        """
        Validate USE intent.

        Checks:
        1. Slot index in bounds (0-4) → search for item elsewhere
        2. Slot has an item → search for same item elsewhere
        3. Item is consumable → skip non-consumables (wood, stone, weapons)
        4. USE is beneficial (HP < 100 for potions) → skip if wasteful
        """
        slot = action_data.get("item_slot", -1)
        inventory = me.get("inventory", [])
        hp = me.get("hp", 100)

        # Try the exact slot first
        if 0 <= slot < len(inventory) and inventory[slot] is not None:
            item = inventory[slot]
            item_name = item.get("item", "")

            # 3. Non-consumable check
            if item_name not in CONSUMABLE_ITEMS:
                logger.debug(
                    f"USE blocked: '{item_name}' is not consumable"
                )
                return None

            # 4. Over-heal check: health-potion heals 30 HP
            if item_name == "health-potion" and hp >= PLAYER_MAX_HP:
                logger.debug(
                    "USE blocked: HP already full, don't waste potion"
                )
                return None

            return action_data

        # 1/2. Slot empty or out of bounds — search for any consumable
        original_item = None
        if 0 <= slot < len(inventory) and inventory[slot] is not None:
            original_item = inventory[slot].get("item")

        # Search for the original item in other slots, or any consumable
        for i, item in enumerate(inventory):
            if item is None:
                continue
            item_name = item.get("item", "")

            # Prefer the exact same item the LLM intended
            if original_item and item_name == original_item:
                if item_name in CONSUMABLE_ITEMS:
                    # Check wastefulness
                    if item_name == "health-potion" and hp >= PLAYER_MAX_HP:
                        continue
                    return {"action": "USE", "item_slot": i}

        # Try any consumable
        for i, item in enumerate(inventory):
            if item is None:
                continue
            item_name = item.get("item", "")
            if item_name in CONSUMABLE_ITEMS:
                if item_name == "health-potion" and hp >= PLAYER_MAX_HP:
                    continue
                return {"action": "USE", "item_slot": i}

        # No valid consumable found
        return None

    # ── CRAFT validation ──

    def _validate_craft(
        self, action_data: dict, agent, entities: list, my_pos: list
    ) -> Optional[dict]:
        """
        Validate CRAFT intent.

        Checks:
        1. Recipe name is valid → discard if nonsense
        2. Have materials (can_craft) → discard if not
        3. Near workbench (≤ 2 tiles) → MOVE toward if too far
        4. No workbench visible → discard
        """
        recipe = action_data.get("recipe")

        # 1. Recipe name validation
        if not recipe or recipe not in VALID_RECIPES:
            logger.debug(f"CRAFT blocked: invalid recipe '{recipe}'")
            return None

        # 2. Materials check
        if not agent.can_craft(recipe):
            logger.debug(
                f"CRAFT blocked: insufficient materials for '{recipe}'"
            )
            return None

        # 3. Workbench proximity
        workbench = agent.find_nearest(entities, "WORKBENCH")
        if workbench:
            dist = _chebyshev_dist(my_pos, workbench["position"])
            if dist <= 2:
                return action_data  # Can craft right now
            else:
                # Move toward workbench
                direction = agent.direction_toward(workbench["position"])
                return {"action": "MOVE", "direction": direction}

        # 4. No workbench visible
        return None

    # ── TALK validation ──

    def _validate_talk(
        self, action_data: dict, current_state: dict,
    ) -> dict:
        """
        Validate TALK intent.

        Checks:
        1. Chat cooldown (3 ticks between messages) → IDLE if on cooldown
        2. Message length ≤ 200 chars → truncate if too long
        3. Message is a non-empty string → IDLE if empty
        """
        current_tick = current_state.get("tick", 0)

        # 1. Cooldown check
        if current_tick - self._last_chat_tick < CHAT_COOLDOWN_TICKS:
            logger.debug(
                f"TALK blocked: chat cooldown "
                f"({current_tick - self._last_chat_tick} < {CHAT_COOLDOWN_TICKS} ticks)"
            )
            return {"action": "IDLE"}

        message = action_data.get("message", "")

        # 3. Empty message check
        if not message or not isinstance(message, str):
            return {"action": "IDLE"}

        # 2. Length truncation
        if len(message) > CHAT_MAX_LENGTH:
            message = message[:CHAT_MAX_LENGTH]
            logger.debug(f"TALK message truncated to {CHAT_MAX_LENGTH} chars")

        self._last_chat_tick = current_tick
        return {"action": "TALK", "message": message}

    # ────────────────────────────
    #  Action Parsing & Execution
    # ────────────────────────────

    def _parse_action(self, response: str) -> dict:
        """Extract JSON action from LLM response text."""
        text = response.strip()

        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1]).strip()

        # Find JSON object in the response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])

        raise ValueError(
            f"No valid JSON found in LLM response: {text[:100]}..."
        )

    def _execute_action(self, agent: "SurvivalAgent", action_data: dict):
        """Map parsed+validated action data to agent method calls."""
        action = action_data.get("action", "IDLE").upper()

        if action == "MOVE":
            agent.move(action_data.get("direction", "N"))
        elif action == "ATTACK":
            target_id = action_data.get("target_id")
            if target_id:
                agent.attack(target_id)
            else:
                agent.idle()
        elif action == "HARVEST":
            target_id = action_data.get("target_id")
            if target_id:
                agent.harvest(target_id)
            else:
                agent.idle()
        elif action == "CRAFT":
            recipe = action_data.get("recipe")
            if recipe:
                agent.craft(recipe)
            else:
                agent.idle()
        elif action == "USE":
            item_slot = action_data.get("item_slot")
            if item_slot is not None:
                agent.use(item_slot)
            else:
                agent.idle()
        elif action == "TALK":
            agent.talk(action_data.get("message", ""))
        else:
            agent.idle()

    # ────────────────────────────
    #  Emergency Fallback Logic
    # ────────────────────────────

    def _emergency_fallback(self, agent: "SurvivalAgent", state: dict):
        """
        Lightweight rule-based fallback for when the LLM is thinking.

        CONSERVATIVE by design — only handles emergencies.
        Does NOT do proactive things like harvesting, because that would
        change the game state in ways that make the LLM's upcoming
        response more likely to be invalidated.

        Priority:
        1. AFK wolf-kill prevention (25+ idle ticks → forced move)
        2. Zone escape (10 dmg/tick — #1 killer)
        3. Health potion if HP critical (<30) and not at full HP
        4. Self-defense: attack adjacent enemy (only if stamina allows)
        5. Idle (regen stamina, don't change state unnecessarily)
        """
        me = state.get("self", {})
        entities = state.get("nearby_entities", [])
        zone = state.get("zone", {})
        my_pos = me.get("position", [25, 25])
        stamina = me.get("stamina", 0)
        hp = me.get("hp", 100)

        # 1. AFK Prevention — about to be wolf-killed
        if self._consecutive_idle_ticks >= AFK_KILL_TICKS - 5:
            if stamina >= STAMINA_COST_MOVE:
                direction = self._pick_safe_move_direction(
                    agent, my_pos, state
                )
                agent.move(direction)
                self._total_afk_saves += 1
                return

        # 2. URGENT: Zone escape
        if agent.is_outside_zone():
            if stamina >= STAMINA_COST_MOVE:
                zone_center = zone.get("center", [25, 25])
                agent.move(agent.direction_toward(zone_center))
                return
            # No stamina to escape — idle to regen, hope we survive
            agent.idle()
            return

        # 3. HP critical — use health potion (check consumable and not at full)
        if hp < 30 and hp < PLAYER_MAX_HP:
            for i, slot in enumerate(me.get("inventory", [])):
                if slot and slot.get("item") == "health-potion":
                    agent.use(i)
                    return

        # 4. Self-defense — fight back if literally adjacent AND have stamina
        if stamina >= STAMINA_COST_ATTACK:
            for entity in entities:
                if entity.get("type") == "PLAYER":
                    dist = _chebyshev_dist(my_pos, entity["position"])
                    if dist <= 1:
                        agent.attack(entity["id"])
                        return

        # 5. Idle — don't change state, let LLM guide strategy
        agent.idle()
