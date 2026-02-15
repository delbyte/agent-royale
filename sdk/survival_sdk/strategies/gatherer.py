"""
Gatherer strategy — farm-first bot for Protocol: SURVIVAL.

Priority order:
1. Use health potion if HP low
2. Escape zone if outside safe area
3. Self-defense (attack adjacent threats)
4. Craft at workbench (prioritize health potions, then tools)
5. Harvest nearest resource (balanced wood/stone)
6. Only hunt when fully armed (late-game)
7. Move toward resources or zone center

This strategy excels in the mid-game by stockpiling resources
and staying healthy. It transitions to aggression once well-equipped.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from survival_sdk.agent import SurvivalAgent

import logging
logger = logging.getLogger(__name__)



def gatherer_strategy(agent: "SurvivalAgent", state: dict):
    """
    Strategy function for the resource-focused gathering playstyle.

    Args:
        agent: The SurvivalAgent instance
        state: Raw dict from GET /api/world/state
    """
    me = state["self"]
    entities = state.get("nearby_entities", [])
    entities = state.get("nearby_entities", [])
    zone = state.get("zone", {})

    # ── 0. AFK Prevention: Force move every 20 ticks ──
    if state.get("tick", 0) % 20 == 0:
        logger.info(f"[{me.get('display_name', 'Bot')}] Forced relocation (AFK reset)")
        _wander(agent, state)
        return

    # ── 1. Health potion if HP below threshold ──
    if me["hp"] < 60:
        for i, slot in enumerate(me.get("inventory", [])):
            if slot and slot.get("item") == "health-potion":
                logger.info(f"[{me.get('display_name', 'Bot')}] Using health potion")
                agent.use(i)
                return

    # ── 2. Zone safety ──
    if agent.is_outside_zone():
        zone_center = zone.get("center", [25, 25])
        agent.move(agent.direction_toward(zone_center))
        return

    # ── 3. Self-defense: fight back only if threatened ──
    nearby_players = [e for e in entities if e.get("type") == "PLAYER"]
    for player in nearby_players:
        dist = agent._manhattan_dist(me["position"], player["position"])
        if dist <= 1:
            # Adjacent enemy — avoid long bare-hands stalemates
            if not agent.has_weapon():
                # Try to disengage and craft instead of trading 1-dmg punches forever
                logger.info(f"[{me.get('display_name', 'Bot')}] Disengaging (unarmed)")
                _wander(agent, state)
                return

            logger.info(f"[{me.get('display_name', 'Bot')}] Self-defense: Attacking {player.get('display_name', 'enemy')}")
            agent.attack(player["id"])
            return

    # ── 4. Crafting priority: potions > tools > weapons ──
    workbench = agent.find_nearest(entities, "WORKBENCH")
    at_workbench = (
        workbench
        and agent._manhattan_dist(me["position"], workbench["position"]) <= 2
    )

    if at_workbench:
        craft_priority = [
            "health-potion",
            "stone-axe",       # Faster wood harvesting
            "stone-pickaxe",   # Faster stone harvesting
            "wooden-club",
        ]
        for recipe in craft_priority:
            if agent.can_craft(recipe):
                logger.info(f"[{me.get('display_name', 'Bot')}] Crafting {recipe}")
                agent.craft(recipe)
                return

    # ── 5. Harvest nearest resource ──
    # Prefer the resource we have less of
    wood_count = agent.count_resource("wood")
    stone_count = agent.count_resource("stone")
    target_subtype = "tree" if wood_count <= stone_count else "rock"

    resources = [
        e for e in entities
        if e.get("type") == "RESOURCE"
    ]
    preferred = [e for e in resources if e.get("subtype") == target_subtype]
    harvest_target = preferred[0] if preferred else (resources[0] if resources else None)

    if harvest_target:
        dist = agent._manhattan_dist(me["position"], harvest_target["position"])
        if dist <= 1:
            logger.info(f"[{me.get('display_name', 'Bot')}] Harvesting {harvest_target['subtype']}")
            agent.harvest(harvest_target["id"])
        else:
            agent.move(agent.direction_toward(harvest_target["position"]))
        return

    # ── 6. Late-game: hunt when armed ──
    if agent.has_weapon() and nearby_players:
        target = agent.find_nearest(entities, "PLAYER")
        if target:
            agent.move(agent.direction_toward(target["position"]))
            return

    # ── 7. Move toward workbench or zone center ──
    if workbench and not at_workbench:
        agent.move(agent.direction_toward(workbench["position"]))
    elif agent.distance_to(zone.get("center", [25, 25])) > 5:
        agent.move(agent.direction_toward(zone.get("center", [25, 25])))
    else:
        _wander(agent, state)


def _wander(agent, state):
    """Move to a random valid adjacent tile to avoid AFK death."""
    import random
    
    my_pos = state["self"]["position"]
    x, y = my_pos
    
    # Identify blocked tiles (visible resources/barricades)
    blocked = set()
    for e in state.get("nearby_entities", []):
        if e["type"] in ("RESOURCE", "BARRICADE"):
            bx, by = e["position"]
            blocked.add((bx, by))
            
    # Candidates (bounds + collision check)
    candidates = []
    if y > 0 and (x, y-1) not in blocked: candidates.append("N")
    if y < 49 and (x, y+1) not in blocked: candidates.append("S")
    if x < 49 and (x+1, y) not in blocked: candidates.append("E")
    if x > 0 and (x-1, y) not in blocked: candidates.append("W")
    
    if candidates:
        agent.move(random.choice(candidates))
    else:
        # Trapped? Try random anyway
        agent.move(random.choice(["N", "S", "E", "W"]))



