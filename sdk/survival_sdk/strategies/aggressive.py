"""
Aggressive strategy — kill-first bot for Protocol: SURVIVAL.

Priority order:
1. Escape zone if outside safe area
2. Attack any nearby enemy (prefer nearest)
3. Craft best available weapon at workbench
4. Harvest nearest resource (trees > rocks for weapon mats)
5. Move toward zone center (always stay relevant)

This strategy works well when there are many targets and the agent
spawns near resources. It's weak early-game without a weapon.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from survival_sdk.agent import SurvivalAgent

import logging
logger = logging.getLogger(__name__)



def aggressive_strategy(agent: "SurvivalAgent", state: dict):
    """
    Strategy function conforming to the agent.run() interface.

    Args:
        agent: The SurvivalAgent instance (provides helpers + actions)
        state: Raw dict from GET /api/world/state
    """
    me = state["self"]
    entities = state.get("nearby_entities", [])
    zone = state.get("zone", {})

    # ── 0. AFK Prevention: Force move every 20 ticks ──
    # Server kills if stationary for 30 ticks. Actions like Harvest/Attack
    # do NOT reset the timer. We must move.
    if state.get("tick", 0) % 20 == 0:
        logger.info(f"[{me.get('display_name', 'Bot')}] Forced relocation (AFK reset)")
        _wander(agent, state)
        return

    # ── 1. Zone safety: escape if outside zone ──
    if agent.is_outside_zone():
        zone_center = zone.get("center", [25, 25])
        direction = agent.direction_toward(zone_center)
        agent.move(direction)
        return

    # ── 2. Self-preservation: use health potion if HP critical ──
    if me["hp"] < 40:
        for i, slot in enumerate(me.get("inventory", [])):
            if slot and slot.get("item") == "health-potion":
                logger.info(f"[{me.get('display_name', 'Bot')}] Using health potion")
                agent.use(i)
                return

    # ── 3. Hunt: attack nearest enemy player ──
    nearby_players = [
        e for e in entities
        if e.get("type") == "PLAYER"
    ]
    if nearby_players:
        target = agent.find_nearest(entities, "PLAYER")
        if target:
            dist = agent._manhattan_dist(me["position"], target["position"])
            if dist <= 1:
                # Adjacent — attack!
                logger.info(f"[{me.get('display_name', 'Bot')}] Attacking {target.get('display_name', 'Player')}")
                agent.attack(target["id"])
            else:
                # Chase
                agent.move(agent.direction_toward(target["position"]))
            return

    # ── 4. Arm up: craft weapon if near workbench ──
    if not agent.has_weapon():
        # Try to craft in order of power: stone-hammer > stone-axe > wooden-club
        for recipe in ["stone-hammer", "stone-axe", "wooden-club"]:
            if agent.can_craft(recipe):
                workbench = agent.find_nearest(entities, "WORKBENCH")
                if workbench:
                    dist = agent._manhattan_dist(
                        me["position"], workbench["position"]
                    )
                    if dist <= 2:
                        logger.info(f"[{me.get('display_name', 'Bot')}] Crafting {recipe}")
                        agent.craft(recipe)
                        return
                    else:
                        agent.move(
                            agent.direction_toward(workbench["position"])
                        )
                        return

    # ── 5. Gather resources for crafting ──
    if not agent.has_weapon() and not agent.can_craft("wooden-club"):
        resource = agent.find_nearest(entities, "RESOURCE")
        if resource:
            dist = agent._manhattan_dist(me["position"], resource["position"])
            if dist <= 1:
                logger.info(f"[{me.get('display_name', 'Bot')}] Harvesting {resource['subtype']}")
                agent.harvest(resource["id"])
            else:
                agent.move(agent.direction_toward(resource["position"]))
            return

    # ── 6. Loot: grab any nearby loot drops ──
    loot = agent.find_nearest(entities, "LOOT")
    if loot:
        dist = agent._manhattan_dist(me["position"], loot["position"])
        if dist <= 1:
            logger.info(f"[{me.get('display_name', 'Bot')}] Looting {loot['subtype']}")
            agent.harvest(loot["id"])
        else:
            agent.move(agent.direction_toward(loot["position"]))
        return

    # ── 7. Default: move toward zone center ──
    zone_center = zone.get("center", [25, 25])
    if agent.distance_to(zone_center) > 3:
        agent.move(agent.direction_toward(zone_center))
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



