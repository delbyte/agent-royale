"""
Diplomat strategy — alliance-forming bot for Protocol: SURVIVAL.

Priority order:
1. Zone safety
2. Self-preservation (health potions)
3. Chat with visible players (announce alliance intentions)
4. Farm resources (low profile)
5. Betray: switch to aggressive when zone shrinks small (radius ≤ 10)
6. Default: edge positioning for survival

This strategy is designed to create interesting emergent social
dynamics within the game. It creates narrative tension by alternating
between cooperation and betrayal.
"""

import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from survival_sdk.agent import SurvivalAgent

import logging
logger = logging.getLogger(__name__)


# Chat messages rotated to look organic
ALLIANCE_MESSAGES = [
    "Let's team up! No fighting between us.",
    "Truce? Focus on farming and stay alive together.",
    "Alliance? I won't attack if you don't.",
    "Hey, let's not fight. There are bigger threats.",
    "Peace? We can take out the others later.",
]

BETRAY_MESSAGES = [
    "Sorry, every agent for themselves now.",
    "The zone is too small for both of us.",
    "Nothing personal, just survival.",
]


def diplomat_strategy(agent: "SurvivalAgent", state: dict):
    """
    Strategy function for the alliance + late-game-betrayal playstyle.

    Args:
        agent: The SurvivalAgent instance
        state: Raw dict from GET /api/world/state
    """
    me = state["self"]
    entities = state.get("nearby_entities", [])
    zone = state.get("zone", {})
    tick = state.get("tick", 0)

    zone_radius = zone.get("radius", 35)
    late_game = zone_radius <= 10

    # ── 0. AFK Prevention: Force move every 20 ticks ──
    if tick % 20 == 0:
        logger.info(f"[{me.get('display_name', 'Bot')}] Forced relocation (AFK reset)")
        _wander(agent, state)
        return

    # ── 1. Zone safety ──
    if agent.is_outside_zone():
        zone_center = zone.get("center", [25, 25])
        agent.move(agent.direction_toward(zone_center))
        return

    # ── 2. Health management ──
    if me["hp"] < 50:
        for i, slot in enumerate(me.get("inventory", [])):
            if slot and slot.get("item") == "health-potion":
                logger.info(f"[{me.get('display_name', 'Bot')}] Using health potion")
                agent.use(i)
                return

    nearby_players = [e for e in entities if e.get("type") == "PLAYER"]

    # ── 3. Late game betrayal mode ──
    if late_game:
        if nearby_players:
            target = agent.find_nearest(entities, "PLAYER")
            if target:
                dist = agent._manhattan_dist(me["position"], target["position"])
                if dist <= 1:
                    # Announce betrayal, then attack
                    if tick % 10 == 0:
                        logger.info(f"[{me.get('display_name', 'Bot')}] Announcing betrayal")
                        agent.talk(random.choice(BETRAY_MESSAGES))
                    else:
                        logger.info(f"[{me.get('display_name', 'Bot')}] Betraying! Attacking {target.get('display_name', 'target')}")
                        agent.attack(target["id"])
                else:
                    agent.move(agent.direction_toward(target["position"]))
                return

    # ── 4. Diplomacy: chat with nearby players ──
    if nearby_players and tick % 5 == 0:
        logger.info(f"[{me.get('display_name', 'Bot')}] Proposing alliance")
        agent.talk(random.choice(ALLIANCE_MESSAGES))
        return

    # ── 5. Self-defense: fight back if adjacent enemy ──
    for player in nearby_players:
        dist = agent._manhattan_dist(me["position"], player["position"])
        if dist <= 1:
            logger.info(f"[{me.get('display_name', 'Bot')}] Self-defense: Attacking {player.get('display_name', 'enemy')}")
            agent.attack(player["id"])
            return

    # ── 6. Farm resources quietly ──
    if not agent.has_weapon() and agent.can_craft("wooden-club"):
        workbench = agent.find_nearest(entities, "WORKBENCH")
        if workbench:
            dist = agent._manhattan_dist(me["position"], workbench["position"])
            if dist <= 2:
                logger.info(f"[{me.get('display_name', 'Bot')}] Crafting wooden-club")
                agent.craft("wooden-club")
                return
            else:
                agent.move(agent.direction_toward(workbench["position"]))
                return

    resource = agent.find_nearest(entities, "RESOURCE")
    if resource:
        dist = agent._manhattan_dist(me["position"], resource["position"])
        if dist <= 1:
            logger.info(f"[{me.get('display_name', 'Bot')}] Harvesting {resource['subtype']}")
            agent.harvest(resource["id"])
        else:
            agent.move(agent.direction_toward(resource["position"]))
        return

    # ── 7. Default: stay near zone center edge (not too center, not too far) ──
    zone_center = zone.get("center", [25, 25])
    dist = agent.distance_to(zone_center)
    if dist > zone_radius * 0.7:
        agent.move(agent.direction_toward(zone_center))
    elif dist < zone_radius * 0.3 and not late_game:
        # Move outward a bit — stay on the edge, less confrontation
        agent.move(random.choice(["N", "S", "E", "W"]))
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



