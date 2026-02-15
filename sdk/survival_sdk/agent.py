"""
SurvivalAgent — Main client for interacting with Protocol: SURVIVAL.

Handles:
- x402 payment flow (402 → on-chain MON payment → JWT auth)
- DEV_SKIP_PAYMENT mode (direct join for local dev)
- Game state polling with fog-of-war
- Action submission (one per tick)
- Pluggable strategy loop

Usage:
    from survival_sdk import SurvivalAgent

    agent = SurvivalAgent("http://localhost:3001", "0xYOUR_PRIVATE_KEY")
    agent.join()
    agent.run(your_strategy_function)
"""

import logging
import time
import requests
from typing import Callable, Optional

from web3 import Web3
from eth_account import Account

logger = logging.getLogger("survival_sdk")


class SurvivalAgent:
    """
    A client for the Protocol: SURVIVAL game server.

    Manages the full lifecycle: join → poll state → submit actions → handle game end.
    Strategy logic is pluggable via the `run(strategy_fn)` method.
    """

    def __init__(
        self,
        server_url: str,
        private_key: str,
        rpc_url: str = "https://testnet-rpc.monad.xyz/",
    ):
        """
        Initialize agent.

        Args:
            server_url: Game server URL, e.g. "http://localhost:3001"
            private_key: Hex private key (with or without 0x prefix)
            rpc_url: Monad Testnet RPC URL (default: official public RPC)
        """
        self.server = server_url.rstrip("/")
        self.rpc_url = rpc_url
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.account = Account.from_key(private_key)
        self.address = self.account.address

        # Set after join
        self.token: Optional[str] = None
        self.agent_id: Optional[str] = None
        self.game_id: Optional[str] = None
        self.display_name: Optional[str] = None

        # State cache — raw dict from last get_state() call
        self._last_state: Optional[dict] = None

        # HTTP retry tuning (for transient network/server issues)
        self.http_max_retries = 4
        self.http_backoff_seconds = 0.5

    def _request_with_retry(self, method: str, path: str, **kwargs) -> requests.Response:
        """HTTP request with retry on transient errors and 5xx/429 responses."""
        url = f"{self.server}{path}"
        timeout = kwargs.pop("timeout", 10)

        last_exc: Optional[Exception] = None
        last_resp: Optional[requests.Response] = None

        for attempt in range(self.http_max_retries):
            try:
                resp = requests.request(method, url, timeout=timeout, **kwargs)
                last_resp = resp

                # Retry only on transient server pressure/errors.
                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    if attempt < self.http_max_retries - 1:
                        time.sleep(self.http_backoff_seconds * (attempt + 1))
                        continue
                return resp
            except requests.exceptions.RequestException as exc:
                last_exc = exc
                if attempt < self.http_max_retries - 1:
                    time.sleep(self.http_backoff_seconds * (attempt + 1))
                    continue

        if last_resp is not None:
            return last_resp
        raise RuntimeError(f"HTTP request failed after retries: {method} {url} — {last_exc}")

    @property
    def is_joined(self) -> bool:
        """Whether the agent has successfully joined a game."""
        return self.token is not None

    # ────────────────────────────────────────────────
    #  JOIN FLOW (x402 + DEV_SKIP_PAYMENT)
    # ────────────────────────────────────────────────

    def join(self, spawn_preference: Optional[list[int]] = None) -> dict:
        """
        Handle the full join flow, supporting both modes:

        1. DEV_SKIP_PAYMENT — Server returns 200 directly, no payment needed.
        2. Real x402 — Server returns 402 with payment requirements;
           we send MON on Monad Testnet, then confirm with tx_hash.

        Args:
            spawn_preference: Preferred [x, y] spawn coordinate (default [25, 25])

        Returns:
            dict with auth_token, agent_id, game_id, display_name, etc.

        Raises:
            RuntimeError: If join fails at any step
        """
        if spawn_preference is None:
            spawn_preference = [25, 25]

        logger.info(f"Joining as {self.address[:10]}...")

        # Step 1: Initial request
        resp = self._request_with_retry(
            "POST",
            "/api/join",
            json={
                "wallet_address": self.address,
                "spawn_preference": spawn_preference,
            },
        )

        # DEV_SKIP_PAYMENT mode — server returns 200 directly
        if resp.status_code == 200:
            data = resp.json()
            self._handle_join_success(data)
            return data

        # Real x402 flow — expect 402
        if resp.status_code != 402:
            raise RuntimeError(
                f"Expected 200 (dev) or 402 (x402), got {resp.status_code}: {resp.text}"
            )

        payment = resp.json()["payment_required"]
        logger.info(
            f"Payment required: {payment['amount_display']} to {payment['payment_address'][:10]}..."
        )

        # Step 2: Send MON on Monad Testnet
        tx_hash = self._send_payment(payment)
        logger.info(f"Payment sent: {tx_hash}")

        # Step 3: Confirm with server
        resp = self._request_with_retry(
            "POST",
            "/api/join",
            json={
                "wallet_address": self.address,
                "tx_hash": tx_hash,
                "session_id": payment["session_id"],
                "spawn_preference": spawn_preference,
            },
        )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Join confirmation failed: {resp.status_code} — {resp.text}"
            )

        data = resp.json()
        self._handle_join_success(data)
        return data

    def _send_payment(self, payment: dict) -> str:
        """Send MON payment on Monad Testnet with session_id in tx data."""
        session_hex = "0x" + payment["session_id"].encode("utf-8").hex()

        nonce = self.w3.eth.get_transaction_count(self.address)
        gas_price = self.w3.eth.gas_price

        tx = {
            "to": Web3.to_checksum_address(payment["payment_address"]),
            "value": int(payment["amount_wei"]),
            "data": session_hex,
            "chainId": payment["chain_id"],
            "gas": 50000,  # Enough for simple transfer with data
            "gasPrice": gas_price,
            "nonce": nonce,
        }

        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)

        logger.info("Waiting for tx confirmation...")
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

        if receipt["status"] != 1:
            raise RuntimeError(f"Transaction failed: {tx_hash.hex()}")

        tx_hash_hex = tx_hash.hex()
        if not tx_hash_hex.startswith("0x"):
            tx_hash_hex = f"0x{tx_hash_hex}"
        return tx_hash_hex

    def _handle_join_success(self, data: dict):
        """Store credentials from a successful join response."""
        self.token = data["auth_token"]
        self.agent_id = data["agent_id"]
        self.game_id = data.get("game_id")
        self.display_name = data.get("display_name")
        logger.info(f"Joined as '{self.display_name}' (ID: {self.agent_id})")

    # ────────────────────────────────────────────────
    #  STATE & ACTIONS
    # ────────────────────────────────────────────────

    def get_state(self) -> dict:
        """
        Get current visible world state (fog-of-war applied server-side).

        Returns:
            dict matching the GET /api/world/state response schema
        """
        self._require_joined()
        resp = self._request_with_retry(
            "GET",
            "/api/world/state",
            headers=self._auth_headers(),
        )
        if resp.status_code != 200:
            raise RuntimeError(f"State fetch failed: {resp.status_code} — {resp.text}")
        self._last_state = resp.json()
        return self._last_state

    def act(self, action: str, **kwargs) -> dict:
        """
        Submit an action for the current tick.

        Only one action per tick is processed by the server.

        Args:
            action: One of MOVE, ATTACK, HARVEST, CRAFT, USE, TALK, IDLE
            **kwargs: Action-specific params (direction, target_id, recipe, etc.)

        Returns:
            dict with success status and action details
        """
        self._require_joined()
        payload = {"action": action, **kwargs}
        resp = self._request_with_retry(
            "POST",
            "/api/action",
            json=payload,
            headers=self._auth_headers(),
        )
        return resp.json()

    # ── Convenience action methods ──────────────────

    def move(self, direction: str) -> dict:
        """Move one tile. direction: N, S, E, W, NE, NW, SE, SW"""
        return self.act("MOVE", direction=direction)

    def attack(self, target_id: str) -> dict:
        """Attack an adjacent entity (player or barricade)."""
        return self.act("ATTACK", target_id=target_id)

    def harvest(self, target_id: str) -> dict:
        """Harvest an adjacent resource node (tree/rock)."""
        return self.act("HARVEST", target_id=target_id)

    def craft(self, recipe: str) -> dict:
        """
        Craft an item. Must be within 2 tiles of a workbench.
        Recipes: wooden-club, stone-axe, stone-pickaxe, stone-hammer,
                 barricade, health-potion
        """
        return self.act("CRAFT", recipe=recipe)

    def use(self, item_slot: int) -> dict:
        """Use an item from inventory (e.g. health potion)."""
        return self.act("USE", item_slot=item_slot)

    def talk(self, message: str) -> dict:
        """Broadcast a message to agents within vision range (max 200 chars)."""
        return self.act("TALK", message=message[:200])

    def idle(self) -> dict:
        """Do nothing this tick (stamina regenerates +5)."""
        return self.act("IDLE")

    # ── Helper methods for strategy logic ───────────

    def find_nearest(
        self, entities: list[dict], entity_type: str
    ) -> Optional[dict]:
        """
        Find the nearest entity of a given type from a list.

        Args:
            entities: List of entity dicts (from state["nearby_entities"])
            entity_type: One of RESOURCE, PLAYER, WORKBENCH, BARRICADE, LOOT

        Returns:
            Nearest entity dict, or None if no match
        """
        my_pos = (
            self._last_state["self"]["position"]
            if self._last_state
            else [25, 25]
        )
        filtered = [e for e in entities if e.get("type") == entity_type]
        if not filtered:
            return None
        return min(
            filtered,
            key=lambda e: self._manhattan_dist(my_pos, e["position"]),
        )

    def direction_toward(self, target_pos: list[int]) -> str:
        """
        Get the best cardinal/ordinal direction to move toward a target.

        Returns one of: N, S, E, W, NE, NW, SE, SW
        """
        if not self._last_state:
            return "N"
        my_pos = self._last_state["self"]["position"]
        dx = target_pos[0] - my_pos[0]
        dy = target_pos[1] - my_pos[1]

        if dx == 0 and dy == 0:
            return "N"  # Already at target

        # Prefer diagonal movement when both deltas are significant
        if abs(dx) > 0 and abs(dy) > 0:
            ns = "S" if dy > 0 else "N"
            ew = "E" if dx > 0 else "W"
            return ns + ew if abs(dy) >= abs(dx) else ew  # still pick the dominant axis if very skewed
            # Actually let's just always use diagonal when both deltas exist — it's faster

        if abs(dx) > abs(dy):
            return "E" if dx > 0 else "W"
        else:
            return "S" if dy > 0 else "N"

    def distance_to(self, target_pos: list[int]) -> int:
        """Manhattan distance from current position to target."""
        if not self._last_state:
            return 999
        return self._manhattan_dist(
            self._last_state["self"]["position"], target_pos
        )

    def has_weapon(self) -> bool:
        """Check if agent has any weapon in inventory."""
        if not self._last_state:
            return False
        weapons = {
            "wooden-club",
            "stone-axe",
            "stone-pickaxe",
            "stone-hammer",
        }
        for slot in self._last_state["self"]["inventory"]:
            if slot and slot.get("item") in weapons:
                return True
        return False

    def get_best_weapon(self) -> Optional[str]:
        """Get the name of the best weapon in inventory, or None."""
        if not self._last_state:
            return None
        weapon_priority = {
            "stone-hammer": 4,
            "stone-axe": 3,
            "stone-pickaxe": 2,
            "wooden-club": 1,
        }
        best = None
        best_rank = 0
        for slot in self._last_state["self"]["inventory"]:
            if slot and slot.get("item") in weapon_priority:
                rank = weapon_priority[slot["item"]]
                if rank > best_rank:
                    best = slot["item"]
                    best_rank = rank
        return best

    def is_outside_zone(self) -> bool:
        """Check if agent is outside the safe zone (Euclidean distance)."""
        if not self._last_state:
            return False
        pos = self._last_state["self"]["position"]
        zone = self._last_state["zone"]
        dx = pos[0] - zone["center"][0]
        dy = pos[1] - zone["center"][1]
        dist = (dx**2 + dy**2) ** 0.5
        return dist > zone["radius"]

    def can_craft(self, recipe: str) -> bool:
        """
        Check if we have sufficient ingredients for a recipe.
        Note: does NOT check workbench proximity — that's checked server-side.
        """
        if not self._last_state:
            return False
        recipes = {
            "wooden-club":   {"wood": 5},
            "stone-axe":     {"wood": 10, "stone": 5},
            "stone-pickaxe": {"wood": 10, "stone": 5},
            "stone-hammer":  {"wood": 10, "stone": 10},
            "barricade":     {"wood": 5},
            "health-potion": {"wood": 5, "stone": 3},
        }
        needed = recipes.get(recipe)
        if needed is None:
            return False

        # Count resources in inventory
        counts: dict[str, int] = {}
        for slot in self._last_state["self"]["inventory"]:
            if slot and slot.get("item"):
                item = slot["item"]
                counts[item] = counts.get(item, 0) + slot.get("quantity", 1)

        return all(counts.get(item, 0) >= qty for item, qty in needed.items())

    def count_resource(self, resource: str) -> int:
        """Count total quantity of a resource (wood, stone) in inventory."""
        if not self._last_state:
            return 0
        total = 0
        for slot in self._last_state["self"]["inventory"]:
            if slot and slot.get("item") == resource:
                total += slot.get("quantity", 1)
        return total

    # ────────────────────────────────────────────────
    #  MAIN GAME LOOP
    # ────────────────────────────────────────────────

    def run(
        self,
        strategy_fn: Callable,
        tick_interval: float = 1.0,
        max_retries: int = 3,
    ):
        """
        Main game loop. Repeatedly:
        1. Poll world state
        2. Call strategy_fn(agent, state)
        3. Sleep until next tick

        The strategy function receives (agent, state_dict) and should call
        agent.move(), agent.attack(), etc. to submit one action per tick.

        Args:
            strategy_fn: Function(agent, state_dict) → None.
                         Can also be a callable object (e.g. LLMStrategy instance).
            tick_interval: Seconds between state polls (default 1.0, matches server tick)
            max_retries: Consecutive error tolerance before stopping
        """
        self._require_joined()
        logger.info(f"Starting game loop (tick interval: {tick_interval}s)")

        errors = 0
        while True:
            try:
                state = self.get_state()

                # Game over
                if state.get("game_state") == "GAME_OVER":
                    logger.info("Game Over!")
                    self._log_game_over(state)
                    break

                # Dead
                if not state.get("self", {}).get("alive", True):
                    logger.info(
                        f"Eliminated at tick {state.get('tick', '?')}"
                    )
                    break

                # Still in lobby — wait
                if state.get("game_state") == "LOBBY_OPEN":
                    logger.debug(
                        f"Waiting in lobby... (tick {state.get('tick', 0)})"
                    )
                    time.sleep(tick_interval)
                    continue

                # Run strategy
                strategy_fn(self, state)
                errors = 0

            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                break
            except Exception as e:
                errors += 1
                logger.warning(f"Error (attempt {errors}/{max_retries}): {e}")
                if errors >= max_retries:
                    logger.error("Too many consecutive errors, stopping")
                    break

            time.sleep(tick_interval)

        logger.info("Game loop ended")

    def _log_game_over(self, state: dict):
        """Log final game stats if available."""
        winner = state.get("winner")
        if winner:
            logger.info(f"Winner: {winner.get('display_name', winner.get('id', '?'))}")

    # ────────────────────────────────────────────────
    #  INTERNAL
    # ────────────────────────────────────────────────

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def _require_joined(self):
        if not self.is_joined:
            raise RuntimeError(
                "Agent has not joined a game. Call .join() first."
            )

    @staticmethod
    def _manhattan_dist(a: list[int], b: list[int]) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
