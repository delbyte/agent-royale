"""
Unit tests for SurvivalAgent helper methods.

Tests the pure-logic helpers without network calls (no server needed).
"""

import pytest
from unittest.mock import patch, MagicMock
from survival_sdk.agent import SurvivalAgent


@pytest.fixture
def agent():
    """Create a SurvivalAgent with a dummy key, without actually connecting."""
    with patch.object(SurvivalAgent, "__init__", lambda self, *a, **kw: None):
        a = SurvivalAgent.__new__(SurvivalAgent)
        a.server = "http://test:3001"
        a.address = "0x" + "aa" * 20
        a.token = "fake.jwt.token"
        a.agent_id = "agent_test"
        a.game_id = "game_test"
        a.display_name = "TestBot"
        a._last_state = {
            "self": {
                "id": "agent_test",
                "display_name": "TestBot",
                "hp": 80,
                "stamina": 50,
                "position": [20, 20],
                "inventory": [
                    {"item": "wooden-club", "quantity": 1},
                    {"item": "wood", "quantity": 8},
                    {"item": "stone", "quantity": 6},
                    None,
                    None,
                ],
                "kills": 0,
                "alive": True,
            },
            "zone": {
                "center": [25, 25],
                "radius": 20.0,
                "damage_per_tick_outside": 10,
            },
        }
        return a


class TestManhattanDist:
    def test_same_point(self):
        assert SurvivalAgent._manhattan_dist([5, 5], [5, 5]) == 0

    def test_horizontal(self):
        assert SurvivalAgent._manhattan_dist([0, 0], [10, 0]) == 10

    def test_diagonal(self):
        assert SurvivalAgent._manhattan_dist([0, 0], [3, 4]) == 7

    def test_negative_coords(self):
        assert SurvivalAgent._manhattan_dist([-5, -3], [5, 3]) == 16


class TestDirectionToward:
    def test_north(self, agent):
        agent._last_state["self"]["position"] = [25, 25]
        assert agent.direction_toward([25, 20]) == "N"

    def test_south(self, agent):
        agent._last_state["self"]["position"] = [25, 25]
        assert agent.direction_toward([25, 30]) == "S"

    def test_east(self, agent):
        agent._last_state["self"]["position"] = [25, 25]
        assert agent.direction_toward([30, 25]) == "E"

    def test_west(self, agent):
        agent._last_state["self"]["position"] = [25, 25]
        assert agent.direction_toward([20, 25]) == "W"

    def test_same_position(self, agent):
        agent._last_state["self"]["position"] = [25, 25]
        # Should return something valid, not crash
        result = agent.direction_toward([25, 25])
        assert result in {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}


class TestHasWeapon:
    def test_has_weapon(self, agent):
        assert agent.has_weapon() is True

    def test_no_weapon(self, agent):
        agent._last_state["self"]["inventory"] = [
            {"item": "wood", "quantity": 5},
            None, None, None, None,
        ]
        assert agent.has_weapon() is False

    def test_empty_inventory(self, agent):
        agent._last_state["self"]["inventory"] = [None, None, None, None, None]
        assert agent.has_weapon() is False


class TestGetBestWeapon:
    def test_single_weapon(self, agent):
        assert agent.get_best_weapon() == "wooden-club"

    def test_multiple_weapons(self, agent):
        agent._last_state["self"]["inventory"] = [
            {"item": "wooden-club", "quantity": 1},
            {"item": "stone-hammer", "quantity": 1},
            None, None, None,
        ]
        assert agent.get_best_weapon() == "stone-hammer"

    def test_no_weapons(self, agent):
        agent._last_state["self"]["inventory"] = [
            {"item": "wood", "quantity": 10},
            None, None, None, None,
        ]
        assert agent.get_best_weapon() is None


class TestIsOutsideZone:
    def test_inside_zone(self, agent):
        agent._last_state["self"]["position"] = [25, 25]
        assert agent.is_outside_zone() is False

    def test_outside_zone(self, agent):
        # Zone center [25, 25], radius 20
        # Position [50, 50] is ~35.4 from center
        agent._last_state["self"]["position"] = [50, 50]
        assert agent.is_outside_zone() is True

    def test_on_edge(self, agent):
        # Position [45, 25] is exactly 20 from center — on the edge, not outside
        agent._last_state["self"]["position"] = [45, 25]
        assert agent.is_outside_zone() is False


class TestCanCraft:
    def test_can_craft_wooden_club(self, agent):
        # Has 8 wood, club needs 5 — should pass
        assert agent.can_craft("wooden-club") is True

    def test_can_craft_stone_axe(self, agent):
        # Has 8 wood (need 10), 6 stone (need 5) — fails on wood
        assert agent.can_craft("stone-axe") is False

    def test_can_craft_with_enough(self, agent):
        agent._last_state["self"]["inventory"] = [
            {"item": "wood", "quantity": 10},
            {"item": "stone", "quantity": 10},
            None, None, None,
        ]
        assert agent.can_craft("stone-hammer") is True

    def test_invalid_recipe(self, agent):
        assert agent.can_craft("laser-gun") is False


class TestCountResource:
    def test_count_wood(self, agent):
        assert agent.count_resource("wood") == 8

    def test_count_stone(self, agent):
        assert agent.count_resource("stone") == 6

    def test_count_missing(self, agent):
        assert agent.count_resource("diamonds") == 0


class TestFindNearest:
    def test_find_nearest_resource(self, agent):
        entities = [
            {"id": "tree_1", "type": "RESOURCE", "position": [22, 20]},
            {"id": "tree_2", "type": "RESOURCE", "position": [30, 30]},
            {"id": "player_1", "type": "PLAYER", "position": [21, 20]},
        ]
        result = agent.find_nearest(entities, "RESOURCE")
        assert result["id"] == "tree_1"

    def test_find_nearest_no_match(self, agent):
        entities = [
            {"id": "tree_1", "type": "RESOURCE", "position": [22, 20]},
        ]
        result = agent.find_nearest(entities, "PLAYER")
        assert result is None

    def test_find_nearest_empty(self, agent):
        result = agent.find_nearest([], "RESOURCE")
        assert result is None


class TestIsJoined:
    def test_joined(self, agent):
        assert agent.is_joined is True

    def test_not_joined(self, agent):
        agent.token = None
        assert agent.is_joined is False

    def test_require_joined_raises(self, agent):
        agent.token = None
        with pytest.raises(RuntimeError, match="not joined"):
            agent._require_joined()
