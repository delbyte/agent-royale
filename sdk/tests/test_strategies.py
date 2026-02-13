"""
Unit tests for built-in strategies.

Tests each strategy with a mocked agent to verify it calls
appropriate actions under different game conditions.

Includes comprehensive validation layer tests for the LLM strategy,
covering all 22 server-side rejection conditions.
"""

import pytest
from unittest.mock import MagicMock, patch, call

from survival_sdk.strategies.aggressive import aggressive_strategy
from survival_sdk.strategies.gatherer import gatherer_strategy
from survival_sdk.strategies.diplomat import diplomat_strategy
from survival_sdk.strategies.llm import LLMStrategy


def make_agent(pos=(20, 20), hp=100, stamina=100, inventory=None, zone_radius=25):
    """Build a mock agent with controllable state."""
    agent = MagicMock()
    agent._manhattan_dist = lambda a, b: abs(a[0] - b[0]) + abs(a[1] - b[1])
    
    inv = inventory or [None] * 5
    state = {
        "self": {
            "id": "test_agent",
            "display_name": "TestBot",
            "hp": hp,
            "stamina": stamina,
            "position": list(pos),
            "inventory": inv,
            "kills": 0,
            "alive": True,
        },
        "zone": {
            "center": [25, 25],
            "radius": zone_radius,
            "damage_per_tick_outside": 10,
        },
        "nearby_entities": [],
        "messages": [],
        "events": [],
        "tick": 10,
        "alive_count": 5,
    }
    agent._last_state = state
    return agent, state


def add_entity(state, eid, etype, pos, **kwargs):
    """Add an entity to the state's nearby_entities."""
    entity = {"id": eid, "type": etype, "position": list(pos), **kwargs}
    state["nearby_entities"].append(entity)
    return entity


class TestAggressiveStrategy:
    def test_escapes_zone(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = True
        agent.direction_toward.return_value = "NE"
        
        aggressive_strategy(agent, state)
        
        agent.move.assert_called_once_with("NE")

    def test_attacks_adjacent_player(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "player_1", "PLAYER", [21, 20])
        agent.find_nearest.return_value = {"id": "player_1", "position": [21, 20]}
        
        aggressive_strategy(agent, state)
        
        agent.attack.assert_called_once_with("player_1")

    def test_chases_distant_player(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "player_1", "PLAYER", [30, 30])
        agent.find_nearest.return_value = {"id": "player_1", "position": [30, 30]}
        agent.direction_toward.return_value = "SE"
        
        aggressive_strategy(agent, state)
        
        agent.move.assert_called_once_with("SE")

    def test_crafts_when_near_workbench(self):
        agent, state = make_agent(inventory=[
            {"item": "wood", "quantity": 5}, None, None, None, None
        ])
        agent.is_outside_zone.return_value = False
        agent.has_weapon.return_value = False
        agent.can_craft.side_effect = lambda r: r == "wooden-club"
        add_entity(state, "wb_1", "WORKBENCH", [21, 20])
        agent.find_nearest.return_value = {"id": "wb_1", "position": [21, 20]}
        
        aggressive_strategy(agent, state)
        
        agent.craft.assert_called_once_with("wooden-club")

    def test_uses_potion_when_low_hp(self):
        agent, state = make_agent(hp=30, inventory=[
            {"item": "health-potion", "quantity": 1}, None, None, None, None
        ])
        state["self"]["hp"] = 30
        agent.is_outside_zone.return_value = False
        
        aggressive_strategy(agent, state)
        
        agent.use.assert_called_once_with(0)


class TestGathererStrategy:
    def test_uses_potion_when_hurt(self):
        agent, state = make_agent(hp=50, inventory=[
            {"item": "health-potion", "quantity": 1}, None, None, None, None
        ])
        state["self"]["hp"] = 50
        agent.is_outside_zone.return_value = False
        
        gatherer_strategy(agent, state)
        
        agent.use.assert_called_once_with(0)

    def test_escapes_zone(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = True
        agent.direction_toward.return_value = "N"
        
        gatherer_strategy(agent, state)
        
        agent.move.assert_called_once_with("N")

    def test_harvests_nearest_resource(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.count_resource.side_effect = lambda r: 3 if r == "wood" else 5
        # find_nearest returns None for WORKBENCH (none nearby), resource for RESOURCE
        agent.find_nearest.side_effect = lambda entities, t: (
            {"id": "tree_1", "position": [21, 20], "type": "RESOURCE", "subtype": "tree"}
            if t == "RESOURCE" else None
        )
        add_entity(state, "tree_1", "RESOURCE", [21, 20], subtype="tree")
        
        gatherer_strategy(agent, state)
        
        agent.harvest.assert_called_once_with("tree_1")


class TestDiplomatStrategy:
    def test_escapes_zone(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = True
        agent.direction_toward.return_value = "S"
        
        diplomat_strategy(agent, state)
        
        agent.move.assert_called_once_with("S")

    def test_chats_with_nearby_players(self):
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        state["tick"] = 10  # tick % 5 == 0
        add_entity(state, "player_1", "PLAYER", [23, 23])
        
        diplomat_strategy(agent, state)
        
        agent.talk.assert_called_once()

    def test_betrays_in_late_game(self):
        agent, state = make_agent(zone_radius=8)
        state["zone"]["radius"] = 8
        agent.is_outside_zone.return_value = False
        add_entity(state, "player_1", "PLAYER", [21, 20])
        agent.find_nearest.return_value = {"id": "player_1", "position": [21, 20]}
        state["tick"] = 11  # Not talk tick
        
        diplomat_strategy(agent, state)
        
        agent.attack.assert_called_once_with("player_1")


# ──────────────────────────────────────────────────
#  LLM STRATEGY — Core async flow tests
# ──────────────────────────────────────────────────


class TestLLMStrategy:
    """Tests for the LLM strategy's async architecture and action dispatch."""

    def _wait_for_thinking(self, strategy, timeout=2.0):
        import time
        deadline = time.time() + timeout
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    return
            time.sleep(0.01)
        raise TimeoutError("LLM backend did not complete in time")

    def test_first_tick_uses_fallback(self):
        """First tick starts thinking + uses fallback (LLM is not instant)."""
        def slow_backend(prompt):
            import time; time.sleep(0.5)
            return '{"action": "MOVE", "direction": "NE"}'

        strategy = LLMStrategy(backend=slow_backend)
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)  # Tick 1: start thinking, use fallback
        agent.idle.assert_called()

    def test_second_tick_consumes_llm_action(self):
        """LLM returns MOVE NE — consumed on second tick."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "NE"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)  # Tick 1: start thinking
        self._wait_for_thinking(strategy)

        agent.reset_mock()
        state["tick"] = 11
        strategy(agent, state)  # Tick 2: consume
        agent.move.assert_called_once_with("NE")

    def test_async_flow_attack(self):
        """LLM returns ATTACK — consumed on second tick."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "player_1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "player_1", "PLAYER", [21, 20])

        strategy(agent, state)
        self._wait_for_thinking(strategy)

        agent.reset_mock()
        state["tick"] = 11
        strategy(agent, state)
        agent.attack.assert_called_once_with("player_1")

    def test_markdown_fenced_json(self):
        """LLM returns JSON wrapped in markdown fences."""
        strategy = LLMStrategy(backend=lambda p: '```json\n{"action": "CRAFT", "recipe": "wooden-club"}\n```')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.can_craft.return_value = True
        add_entity(state, "wb", "WORKBENCH", [21, 20])
        agent.find_nearest.return_value = {"id": "wb", "position": [21, 20]}

        strategy(agent, state)
        self._wait_for_thinking(strategy)

        agent.reset_mock()
        agent.can_craft.return_value = True
        agent.find_nearest.return_value = {"id": "wb", "position": [21, 20]}
        state["tick"] = 11
        strategy(agent, state)
        agent.craft.assert_called_once_with("wooden-club")

    def test_fallback_on_parse_error(self):
        """LLM returns garbage — both ticks use fallback."""
        strategy = LLMStrategy(backend=lambda p: "I don't understand the game")
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_for_thinking(strategy)

        agent.idle.assert_called()

    def test_fallback_on_backend_exception(self):
        """Backend raises an exception — fallback used, no crash."""
        def boom(prompt):
            raise RuntimeError("API key expired")

        strategy = LLMStrategy(backend=boom)
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_for_thinking(strategy)
        agent.idle.assert_called()

    def test_stale_action_discarded(self):
        """Action older than max_stale_ticks is discarded."""
        strategy = LLMStrategy(
            backend=lambda p: '{"action": "MOVE", "direction": "N"}',
            max_stale_ticks=3,
        )
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_for_thinking(strategy)

        agent.reset_mock()
        state["tick"] = 20  # 10 ticks later — stale
        strategy(agent, state)
        agent.move.assert_not_called()
        assert strategy._total_stale_discards == 1

    def test_fallback_zone_escape(self):
        """Fallback escapes zone when outside."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = True
        agent.direction_toward.return_value = "NE"

        strategy(agent, state)
        agent.move.assert_called_once_with("NE")

    def test_fallback_self_defense(self):
        """Fallback attacks adjacent enemy."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent(stamina=100)
        agent.is_outside_zone.return_value = False
        add_entity(state, "player_1", "PLAYER", [21, 20])

        strategy(agent, state)
        agent.attack.assert_called_once_with("player_1")

    def test_dead_agent_skips(self):
        """Dead agent skips all processing."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "N"}')
        agent, state = make_agent(hp=0)
        state["self"]["alive"] = False
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        agent.move.assert_not_called()
        agent.idle.assert_not_called()

    def test_stats_tracking(self):
        """Verify stats counters increment correctly."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_for_thinking(strategy)
        assert strategy._total_fallback_actions == 1

        agent.reset_mock()
        state["tick"] = 11
        strategy(agent, state)
        assert strategy._total_llm_actions == 1


# ──────────────────────────────────────────────────
#  LLM STRATEGY — Action-type dispatch tests
# ──────────────────────────────────────────────────


class TestLLMActionDispatch:
    """Test that each action type dispatches correctly when valid."""

    def _wait_for_thinking(self, strategy, timeout=2.0):
        import time
        deadline = time.time() + timeout
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    return
            time.sleep(0.01)
        raise TimeoutError("LLM backend did not complete in time")

    def _run_llm_action(self, json_str, agent=None, state=None, **overrides):
        """Helper: run 2-tick cycle and return agent after LLM action consumed."""
        strategy = LLMStrategy(backend=lambda p: json_str)
        if agent is None:
            agent, state = make_agent(**overrides)
        agent.is_outside_zone.return_value = False

        strategy(agent, state)  # Tick 1: start thinking
        self._wait_for_thinking(strategy)

        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)  # Tick 2: consume
        return agent, strategy

    def test_move(self):
        agent, _ = self._run_llm_action('{"action": "MOVE", "direction": "S"}')
        agent.move.assert_called_once_with("S")

    def test_talk(self):
        agent, _ = self._run_llm_action('{"action": "TALK", "message": "hi"}')
        agent.talk.assert_called_once_with("hi")

    def test_idle(self):
        agent, _ = self._run_llm_action('{"action": "IDLE"}')
        agent.idle.assert_called()

    def test_attack_adjacent(self):
        agent, state = make_agent()
        add_entity(state, "p1", "PLAYER", [21, 20])
        agent, _ = self._run_llm_action(
            '{"action": "ATTACK", "target_id": "p1"}',
            agent=agent, state=state,
        )
        agent.attack.assert_called_once_with("p1")

    def test_harvest_adjacent(self):
        agent, state = make_agent()
        add_entity(state, "t1", "RESOURCE", [21, 20])
        agent, _ = self._run_llm_action(
            '{"action": "HARVEST", "target_id": "t1"}',
            agent=agent, state=state,
        )
        agent.harvest.assert_called_once_with("t1")

    def test_use_valid_slot(self):
        inv = [{"item": "health-potion", "quantity": 1}, None, None, None, None]
        agent, state = make_agent(hp=50, inventory=list(inv))
        agent, _ = self._run_llm_action(
            '{"action": "USE", "item_slot": 0}',
            agent=agent, state=state,
        )
        agent.use.assert_called_once_with(0)

    def test_craft_valid(self):
        agent, state = make_agent()
        agent.can_craft.return_value = True
        add_entity(state, "wb", "WORKBENCH", [21, 20])
        agent.find_nearest.return_value = {"id": "wb", "position": [21, 20]}

        strategy = LLMStrategy(backend=lambda p: '{"action": "CRAFT", "recipe": "wooden-club"}')
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_for_thinking(strategy)

        agent.reset_mock()
        agent.can_craft.return_value = True
        agent.find_nearest.return_value = {"id": "wb", "position": [21, 20]}
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)
        agent.craft.assert_called_once_with("wooden-club")


# ──────────────────────────────────────────────────
#  LLM STRATEGY — MOVE validation edge cases
# ──────────────────────────────────────────────────


class TestLLMMoveValidation:
    """Tests for MOVE-specific validation checks."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = agent.is_outside_zone.return_value
        state["tick"] = 11
        strategy(agent, state)

    def test_stamina_insufficient_idles(self):
        """MOVE with stamina < 3 → IDLE to regen."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "N"}')
        agent, state = make_agent(stamina=2)
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.move.assert_not_called()
        agent.idle.assert_called()
        assert strategy._total_stamina_gates >= 1

    def test_invalid_direction_snapped(self):
        """Invalid direction string → snapped to nearest valid."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "NORTH"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.move.assert_called_once_with("N")

    def test_zone_override(self):
        """MOVE SE while outside zone → override to zone center direction."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "SE"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = True
        agent.direction_toward.return_value = "NW"

        strategy(agent, state)  # Fallback handles zone too
        self._wait_and_consume(strategy, agent, state)

        agent.move.assert_called_with("NW")

    def test_map_boundary_redirect(self):
        """MOVE W at x=0 (edge of map) → find alternative direction."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "W"}')
        agent, state = make_agent(pos=(0, 25))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        # Should NOT move W (would go to x=-1, out of bounds)
        # Should find an alternative
        if agent.move.called:
            direction = agent.move.call_args[0][0]
            assert direction != "W"

    def test_map_corner_redirect(self):
        """MOVE SW at (0,49) corner → find non-boundary direction."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "SW"}')
        agent, state = make_agent(pos=(0, 49))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        if agent.move.called:
            direction = agent.move.call_args[0][0]
            # SW would go to (-1, 50) — both out of bounds
            assert direction not in ("SW", "W", "S")

    def test_blocked_tile_redirect(self):
        """MOVE E but barricade at target tile → find alternative."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "E"}')
        agent, state = make_agent(pos=(20, 20))
        agent.is_outside_zone.return_value = False
        add_entity(state, "barricade_1", "BARRICADE", [21, 20], hp=30)

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        if agent.move.called:
            direction = agent.move.call_args[0][0]
            assert direction != "E"

    def test_resource_blocks_movement(self):
        """MOVE N but tree at target tile → redirect."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "MOVE", "direction": "N"}')
        agent, state = make_agent(pos=(20, 20))
        agent.is_outside_zone.return_value = False
        add_entity(state, "tree_1", "RESOURCE", [20, 19], subtype="tree", hp=50)

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        if agent.move.called:
            direction = agent.move.call_args[0][0]
            assert direction != "N"


# ──────────────────────────────────────────────────
#  LLM STRATEGY — ATTACK validation edge cases
# ──────────────────────────────────────────────────


class TestLLMAttackValidation:
    """Tests for ATTACK-specific validation checks."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

    def test_stamina_insufficient_idles(self):
        """ATTACK with stamina < 10 → IDLE."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "p1"}')
        agent, state = make_agent(stamina=5)
        agent.is_outside_zone.return_value = False
        add_entity(state, "p1", "PLAYER", [21, 20])

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.attack.assert_not_called()
        agent.idle.assert_called()

    def test_target_moved_chases(self):
        """Target moved 5 tiles away → MOVE toward."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "p1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "p1", "PLAYER", [21, 20])

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)
        agent.reset_mock()

        # Tick 3: target moved
        state["nearby_entities"] = [{"id": "p1", "type": "PLAYER", "position": [25, 25]}]
        agent.direction_toward.return_value = "NE"
        agent.is_outside_zone.return_value = False
        state["tick"] = 12

        # Need new LLM action (previous consumed)
        strategy2 = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "p1"}')
        agent2, state2 = make_agent()
        agent2.is_outside_zone.return_value = False
        add_entity(state2, "p1", "PLAYER", [21, 20])
        strategy2(agent2, state2)

        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy2._lock:
                if not strategy2._thinking:
                    break
            time.sleep(0.01)

        agent2.reset_mock()
        agent2.is_outside_zone.return_value = False
        state2["nearby_entities"] = [{"id": "p1", "type": "PLAYER", "position": [25, 25]}]
        agent2.direction_toward.return_value = "NE"
        state2["tick"] = 11
        strategy2(agent2, state2)

        agent2.move.assert_called_once_with("NE")
        agent2.attack.assert_not_called()

    def test_target_died_substitutes_nearest(self):
        """Target died, p2 is adjacent → attack p2."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "p1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "p1", "PLAYER", [21, 20])

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        state["nearby_entities"] = [{"id": "p2", "type": "PLAYER", "position": [21, 20]}]
        agent.find_nearest.return_value = {"id": "p2", "position": [21, 20]}
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.attack.assert_called_once_with("p2")

    def test_self_attack_prevented(self):
        """LLM targets self → substitutes nearest other player."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "test_agent"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "p2", "PLAYER", [21, 20])
        agent.find_nearest.return_value = {"id": "p2", "position": [21, 20]}

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.find_nearest.return_value = {"id": "p2", "position": [21, 20]}
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.attack.assert_called_once_with("p2")

    def test_attack_resource_converts_to_harvest(self):
        """LLM says ATTACK tree → convert to HARVEST."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "tree_1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "tree_1", "RESOURCE", [21, 20], subtype="tree")

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.harvest.assert_called_once_with("tree_1")
        agent.attack.assert_not_called()

    def test_attack_workbench_ignored(self):
        """LLM says ATTACK workbench → can't attack, find player."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "wb_1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "wb_1", "WORKBENCH", [21, 20])
        agent.find_nearest.return_value = None

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.find_nearest.return_value = None
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        # Should fallback (no players to substitute)
        agent.attack.assert_not_called()

    def test_no_players_visible_invalid(self):
        """No attackable entities → fallback."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "ATTACK", "target_id": "p1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.find_nearest.return_value = None

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.find_nearest.return_value = None
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.attack.assert_not_called()
        assert strategy._total_invalid_discards >= 1


# ──────────────────────────────────────────────────
#  LLM STRATEGY — HARVEST validation edge cases
# ──────────────────────────────────────────────────


class TestLLMHarvestValidation:
    """Tests for HARVEST-specific validation checks."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

    def test_stamina_insufficient_idles(self):
        """HARVEST with stamina < 5 → IDLE."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "HARVEST", "target_id": "t1"}')
        agent, state = make_agent(stamina=3)
        agent.is_outside_zone.return_value = False
        add_entity(state, "t1", "RESOURCE", [21, 20])

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.harvest.assert_not_called()
        agent.idle.assert_called()

    def test_inventory_full_skips(self):
        """HARVEST with full inventory → skip (items would be lost)."""
        full_inv = [
            {"item": "wood", "quantity": 20},
            {"item": "stone", "quantity": 20},
            {"item": "wooden-club", "quantity": 1},
            {"item": "health-potion", "quantity": 1},
            {"item": "stone-axe", "quantity": 1},
        ]
        strategy = LLMStrategy(backend=lambda p: '{"action": "HARVEST", "target_id": "t1"}')
        agent, state = make_agent(inventory=list(full_inv))
        agent.is_outside_zone.return_value = False
        add_entity(state, "t1", "RESOURCE", [21, 20])

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.harvest.assert_not_called()

    def test_harvest_workbench_redirects(self):
        """HARVEST workbench → can't, find nearest resource instead."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "HARVEST", "target_id": "wb_1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "wb_1", "WORKBENCH", [21, 20])
        add_entity(state, "tree_1", "RESOURCE", [19, 20], subtype="tree")
        agent.find_nearest.return_value = {"id": "tree_1", "position": [19, 20], "type": "RESOURCE"}

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.harvest.assert_called_once_with("tree_1")

    def test_target_gone_substitutes_nearest(self):
        """Original target gone, nearest resource substituted."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "HARVEST", "target_id": "tree_1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "tree_1", "RESOURCE", [21, 20])

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        state["nearby_entities"] = [{"id": "tree_2", "type": "RESOURCE", "position": [19, 20]}]
        agent.find_nearest.return_value = {"id": "tree_2", "position": [19, 20], "type": "RESOURCE"}
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.harvest.assert_called_once_with("tree_2")

    def test_harvest_player_converts_to_attack(self):
        """LLM says HARVEST player → convert to ATTACK."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "HARVEST", "target_id": "p1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "p1", "PLAYER", [21, 20])

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.attack.assert_called_once_with("p1")
        agent.harvest.assert_not_called()

    def test_harvest_loot_works(self):
        """HARVEST a LOOT entity (crate/barrel) should work."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "HARVEST", "target_id": "crate_1"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        add_entity(state, "crate_1", "LOOT", [21, 20], subtype="chest")

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.harvest.assert_called_once_with("crate_1")


# ──────────────────────────────────────────────────
#  LLM STRATEGY — USE validation edge cases
# ──────────────────────────────────────────────────


class TestLLMUseValidation:
    """Tests for USE-specific validation checks."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

    def test_slot_out_of_bounds_finds_alt(self):
        """USE slot 99 → find health-potion in correct slot."""
        inv = [None, {"item": "health-potion", "quantity": 1}, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 99}')
        agent, state = make_agent(hp=50, inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.use.assert_called_once_with(1)

    def test_slot_consumed_finds_alt(self):
        """USE 0 but slot 0 empty, potion at slot 3."""
        inv = [{"item": "health-potion", "quantity": 1}, None, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 0}')
        agent, state = make_agent(hp=50, inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        state["self"]["inventory"] = [None, None, None, {"item": "health-potion", "quantity": 1}, None]
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.use.assert_called_once_with(3)

    def test_item_gone_entirely(self):
        """All potions gone → fallback."""
        inv = [{"item": "health-potion", "quantity": 1}, None, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 0}')
        agent, state = make_agent(hp=50, inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        state["self"]["inventory"] = [None] * 5
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.use.assert_not_called()

    def test_non_consumable_blocked(self):
        """USE on wood → no-op (server would ignore it)."""
        inv = [{"item": "wood", "quantity": 10}, None, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 0}')
        agent, state = make_agent(inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.use.assert_not_called()

    def test_use_weapon_blocked(self):
        """USE on wooden-club → no-op (not consumable)."""
        inv = [{"item": "wooden-club", "quantity": 1}, None, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 0}')
        agent, state = make_agent(inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.use.assert_not_called()

    def test_overheal_prevented(self):
        """USE health-potion at 100 HP → skip (wasteful)."""
        inv = [{"item": "health-potion", "quantity": 1}, None, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 0}')
        agent, state = make_agent(hp=100, inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.use.assert_not_called()

    def test_use_at_low_hp_works(self):
        """USE health-potion at 50 HP → valid."""
        inv = [{"item": "health-potion", "quantity": 1}, None, None, None, None]
        strategy = LLMStrategy(backend=lambda p: '{"action": "USE", "item_slot": 0}')
        agent, state = make_agent(hp=50, inventory=list(inv))
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.use.assert_called_once_with(0)


# ──────────────────────────────────────────────────
#  LLM STRATEGY — CRAFT validation edge cases
# ──────────────────────────────────────────────────


class TestLLMCraftValidation:
    """Tests for CRAFT-specific validation checks."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

    def test_invalid_recipe_discarded(self):
        """CRAFT 'magic-sword' → invalid recipe, discarded."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "CRAFT", "recipe": "magic-sword"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.craft.assert_not_called()

    def test_materials_depleted(self):
        """Materials used up after LLM decided → discarded."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "CRAFT", "recipe": "stone-axe"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.can_craft.return_value = True
        agent.find_nearest.return_value = {"id": "wb", "position": [21, 20]}

        strategy(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.can_craft.return_value = False
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

        agent.craft.assert_not_called()

    def test_workbench_too_far_moves_toward(self):
        """Workbench visible but > 2 tiles → MOVE toward it."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "CRAFT", "recipe": "wooden-club"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.can_craft.return_value = True
        add_entity(state, "wb", "WORKBENCH", [30, 30])
        agent.find_nearest.return_value = {"id": "wb", "position": [30, 30]}
        agent.direction_toward.return_value = "SE"

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.move.assert_called_once_with("SE")
        agent.craft.assert_not_called()

    def test_no_workbench_visible(self):
        """No workbench in view → discarded."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "CRAFT", "recipe": "wooden-club"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.can_craft.return_value = True
        agent.find_nearest.return_value = None

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.craft.assert_not_called()

    def test_empty_recipe_discarded(self):
        """CRAFT with empty recipe → discarded."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "CRAFT", "recipe": ""}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.craft.assert_not_called()


# ──────────────────────────────────────────────────
#  LLM STRATEGY — TALK validation edge cases
# ──────────────────────────────────────────────────


class TestLLMTalkValidation:
    """Tests for TALK-specific validation checks."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

    def test_message_truncated(self):
        """Message > 200 chars → truncated to 200."""
        long_msg = "A" * 300
        strategy = LLMStrategy(backend=lambda p: '{"action": "TALK", "message": "' + long_msg + '"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.talk.assert_called_once()
        actual_msg = agent.talk.call_args[0][0]
        assert len(actual_msg) == 200

    def test_chat_cooldown(self):
        """Second TALK within 3 ticks → IDLE (cooldown)."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "TALK", "message": "hi"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        # First talk
        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)
        agent.talk.assert_called_once_with("hi")

        # Second talk 1 tick later — should be on cooldown
        agent.reset_mock()
        strategy2 = LLMStrategy(backend=lambda p: '{"action": "TALK", "message": "hello"}')
        # Simulate the strategy having chatted recently
        strategy2._last_chat_tick = 11
        agent.is_outside_zone.return_value = False

        strategy2(agent, state)
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy2._lock:
                if not strategy2._thinking:
                    break
            time.sleep(0.01)

        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 12  # Only 1 tick later
        strategy2(agent, state)

        agent.talk.assert_not_called()
        agent.idle.assert_called()

    def test_empty_message_idles(self):
        """TALK with empty string → IDLE."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "TALK", "message": ""}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.talk.assert_not_called()
        agent.idle.assert_called()


# ──────────────────────────────────────────────────
#  LLM STRATEGY — AFK wolf-kill prevention
# ──────────────────────────────────────────────────


class TestLLMAFKPrevention:
    """Tests for AFK wolf-kill prevention."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] += 1
        strategy(agent, state)

    def test_afk_override_forces_move(self):
        """When idle for 25+ ticks, force displacement even if LLM says IDLE."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.direction_toward.return_value = "NE"

        # Simulate 26 ticks of not moving
        strategy._consecutive_idle_ticks = 25
        strategy._last_position = [20, 20]

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        # The LLM said IDLE, but AFK override should force MOVE
        agent.move.assert_called()

    def test_fallback_afk_prevention(self):
        """Fallback detects AFK risk and forces move."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False
        agent.direction_toward.return_value = "N"

        # Simulate high idle count
        strategy._consecutive_idle_ticks = 26
        strategy._last_position = [20, 20]

        # First tick uses fallback
        strategy(agent, state)

        agent.move.assert_called()


# ──────────────────────────────────────────────────
#  LLM STRATEGY — Fallback stamina awareness
# ──────────────────────────────────────────────────


class TestLLMFallbackStamina:
    """Tests for fallback respecting stamina constraints."""

    def test_fallback_no_stamina_for_attack_idles(self):
        """Adjacent enemy but stamina < 10 → idle instead of attacking."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent(stamina=5)
        agent.is_outside_zone.return_value = False
        add_entity(state, "p1", "PLAYER", [21, 20])

        strategy(agent, state)

        agent.attack.assert_not_called()
        agent.idle.assert_called()

    def test_fallback_no_stamina_for_zone_escape_idles(self):
        """Outside zone but stamina < 3 → idle (can't move)."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "IDLE"}')
        agent, state = make_agent(stamina=1)
        agent.is_outside_zone.return_value = True
        agent.direction_toward.return_value = "NE"

        strategy(agent, state)

        agent.move.assert_not_called()
        agent.idle.assert_called()


# ──────────────────────────────────────────────────
#  LLM STRATEGY — Unknown action types
# ──────────────────────────────────────────────────


class TestLLMUnknownActions:
    """Tests for handling unknown/invalid action types."""

    def _wait_and_consume(self, strategy, agent, state):
        import time
        deadline = time.time() + 2.0
        while time.time() < deadline:
            with strategy._lock:
                if not strategy._thinking:
                    break
            time.sleep(0.01)
        agent.reset_mock()
        agent.is_outside_zone.return_value = False
        state["tick"] = 11
        strategy(agent, state)

    def test_unknown_action_becomes_idle(self):
        """Unrecognized action type → mapped to IDLE."""
        strategy = LLMStrategy(backend=lambda p: '{"action": "DANCE", "style": "waltz"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.idle.assert_called()

    def test_missing_action_key_becomes_idle(self):
        """JSON without action key → mapped to IDLE."""
        strategy = LLMStrategy(backend=lambda p: '{"move": "N"}')
        agent, state = make_agent()
        agent.is_outside_zone.return_value = False

        strategy(agent, state)
        self._wait_and_consume(strategy, agent, state)

        agent.idle.assert_called()


# ──────────────────────────────────────────────────
#  LLM STRATEGY — Parse action tests
# ──────────────────────────────────────────────────


class TestLLMStrategyParseAction:
    def test_extracts_json_from_text(self):
        strategy = LLMStrategy(backend=lambda p: "")
        result = strategy._parse_action('Some text {"action": "IDLE"} more text')
        assert result == {"action": "IDLE"}

    def test_raises_on_no_json(self):
        strategy = LLMStrategy(backend=lambda p: "")
        with pytest.raises(ValueError, match="No valid JSON"):
            strategy._parse_action("no json here")

    def test_strips_markdown_fences(self):
        strategy = LLMStrategy(backend=lambda p: "")
        result = strategy._parse_action('```json\n{"action": "MOVE", "direction": "N"}\n```')
        assert result == {"action": "MOVE", "direction": "N"}


# ──────────────────────────────────────────────────
#  LLM STRATEGY — Direction snapping tests
# ──────────────────────────────────────────────────


class TestDirectionSnapping:
    """Tests for the _snap_direction helper."""

    def test_valid_directions_unchanged(self):
        from survival_sdk.strategies.llm import _snap_direction
        for d in ["N", "S", "E", "W", "NE", "NW", "SE", "SW"]:
            assert _snap_direction(d) == d

    def test_full_words_mapped(self):
        from survival_sdk.strategies.llm import _snap_direction
        assert _snap_direction("NORTH") == "N"
        assert _snap_direction("SOUTHEAST") == "SE"

    def test_alternate_names(self):
        from survival_sdk.strategies.llm import _snap_direction
        assert _snap_direction("UP") == "N"
        assert _snap_direction("DOWN") == "S"
        assert _snap_direction("LEFT") == "W"
        assert _snap_direction("RIGHT") == "E"

    def test_case_insensitive(self):
        from survival_sdk.strategies.llm import _snap_direction
        assert _snap_direction("ne") == "NE"
        assert _snap_direction("North") == "N"

    def test_nonsense_defaults_N(self):
        from survival_sdk.strategies.llm import _snap_direction
        assert _snap_direction("xyz") == "N"
        assert _snap_direction("") == "N"
        assert _snap_direction(None) == "N"
