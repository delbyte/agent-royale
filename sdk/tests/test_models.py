"""
Unit tests for Pydantic models — validates parsing of real server response shapes.
"""

import pytest
from survival_sdk.models import (
    GameState, SelfState, ZoneState, NearbyEntity,
    ActionResult, JoinResult, PaymentRequired,
)


# ── Realistic server response fixtures ──

SAMPLE_STATE = {
    "tick": 42,
    "game_state": "GAME_ACTIVE",
    "self": {
        "id": "agent_abc123",
        "display_name": "SilentFox",
        "hp": 85,
        "stamina": 60,
        "position": [20, 30],
        "inventory": [
            {"item": "wooden-club", "quantity": 1},
            {"item": "wood", "quantity": 7},
            None,
            None,
            None,
        ],
        "kills": 1,
        "alive": True,
    },
    "zone": {
        "center": [25, 25],
        "radius": 20.0,
        "damage_per_tick_outside": 10,
    },
    "nearby_entities": [
        {
            "id": "tree_17",
            "type": "RESOURCE",
            "subtype": "tree",
            "position": [21, 30],
            "hp": 40,
        },
        {
            "id": "player_xyz",
            "type": "PLAYER",
            "display_name": "DarkWolf",
            "position": [22, 31],
            "hp": 100,
            "holding": "stone-hammer",
        },
        {
            "id": "workbench_3",
            "type": "WORKBENCH",
            "position": [19, 28],
        },
    ],
    "messages": [],
    "events": [],
    "alive_count": 5,
    "elapsed_seconds": 42,
}


class TestGameState:
    def test_parse_full_state(self):
        state = GameState.model_validate(SAMPLE_STATE)
        assert state.tick == 42
        assert state.game_state == "GAME_ACTIVE"
        assert state.alive_count == 5

    def test_self_alias(self):
        """self → self_state alias via Field(alias='self')"""
        state = GameState.model_validate(SAMPLE_STATE)
        assert state.self_state.id == "agent_abc123"
        assert state.self_state.display_name == "SilentFox"
        assert state.self_state.hp == 85

    def test_inventory_parsing(self):
        state = GameState.model_validate(SAMPLE_STATE)
        inv = state.self_state.inventory
        assert len(inv) == 5
        assert inv[0]["item"] == "wooden-club"
        assert inv[2] is None

    def test_nearby_entities(self):
        state = GameState.model_validate(SAMPLE_STATE)
        assert len(state.nearby_entities) == 3
        tree = state.nearby_entities[0]
        assert tree.type == "RESOURCE"
        assert tree.subtype == "tree"
        assert tree.hp == 40

    def test_player_entity_with_weapon(self):
        state = GameState.model_validate(SAMPLE_STATE)
        player = state.nearby_entities[1]
        assert player.type == "PLAYER"
        assert player.holding == "stone-hammer"
        assert player.display_name == "DarkWolf"

    def test_zone_parsing(self):
        state = GameState.model_validate(SAMPLE_STATE)
        assert state.zone.center == [25, 25]
        assert state.zone.radius == 20.0

    def test_minimal_state(self):
        """Can parse a minimal response with just required fields."""
        minimal = {
            "tick": 0,
            "game_state": "LOBBY_OPEN",
            "self": {"id": "x"},
            "alive_count": 1,
        }
        state = GameState.model_validate(minimal)
        assert state.self_state.id == "x"
        assert state.self_state.hp == 100  # Default


class TestActionResult:
    def test_success(self):
        r = ActionResult.model_validate({
            "success": True,
            "action_queued": "MOVE",
            "tick_queued": 42,
        })
        assert r.success is True
        assert r.action_queued == "MOVE"

    def test_failure(self):
        r = ActionResult.model_validate({
            "success": False,
            "error": "ACTION_ALREADY_QUEUED",
            "message": "Already queued for this tick",
        })
        assert r.success is False
        assert r.error == "ACTION_ALREADY_QUEUED"


class TestJoinResult:
    def test_parse(self):
        r = JoinResult.model_validate({
            "auth_token": "jwt.token.here",
            "agent_id": "agent_abc",
            "game_id": "game_001",
            "display_name": "SilentFox",
            "position": [15, 15],
            "game_state": "LOBBY_OPEN",
            "game_starts_in_seconds": 120,
        })
        assert r.auth_token == "jwt.token.here"
        assert r.display_name == "SilentFox"


class TestPaymentRequired:
    def test_parse(self):
        p = PaymentRequired.model_validate({
            "payment_address": "0xABCDEF",
            "amount_wei": "1000000000000000000",
            "amount_display": "1.0 MON",
            "chain_id": 10143,
            "rpc_url": "https://testnet-rpc.monad.xyz/",
            "session_id": "sess_123",
            "expires_at": 1700000000,
        })
        assert p.chain_id == 10143
        assert p.amount_wei == "1000000000000000000"
