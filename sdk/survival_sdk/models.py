"""
Pydantic v2 models for Protocol: SURVIVAL game state and API responses.

These models match the actual server API response shapes from the game server.
They provide type-safe parsing with autocomplete for bot developers.

Usage:
    from survival_sdk.models import GameState, JoinResult, ActionResult

    state = GameState.model_validate(raw_dict)
    print(state.self_state.hp)
"""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional


class SelfState(BaseModel):
    """The agent's own state as returned by the server."""
    id: str
    display_name: str = ""
    hp: int = 100
    stamina: int = 100
    position: list[int] = Field(default_factory=lambda: [25, 25])
    inventory: list[Optional[dict]] = Field(default_factory=list)
    kills: int = 0
    alive: bool = True


class ZoneState(BaseModel):
    """Safe zone info — center, radius, and shrink schedule."""
    center: list[int] = Field(default_factory=lambda: [25, 25])
    radius: float = 35.0
    next_shrink_tick: Optional[int] = Field(default=None, alias="nextShrinkTick")
    next_radius: Optional[float] = Field(default=None, alias="nextRadius")
    damage_per_tick_outside: int = Field(default=10, alias="damage_per_tick_outside")

    model_config = {"populate_by_name": True}


class NearbyEntity(BaseModel):
    """An entity visible within the agent's vision radius (15 tiles)."""
    id: str
    type: str                                # RESOURCE, PLAYER, WORKBENCH, BARRICADE, LOOT
    subtype: Optional[str] = None            # tree, rock, etc.
    display_name: Optional[str] = None
    position: list[int] = Field(default_factory=lambda: [0, 0])
    hp: Optional[int] = None
    holding: Optional[str] = None


class ChatMessage(BaseModel):
    """A chat message broadcast by a nearby agent."""
    from_id: str = Field(alias="from")
    from_name: str = ""
    text: str = ""
    tick: int = 0

    model_config = {"populate_by_name": True}


class KillEvent(BaseModel):
    """A kill event from the game log."""
    type: str = "KILL"
    killer: Optional[str] = None
    victim: str = ""
    weapon: Optional[str] = None
    tick: int = 0


class GameState(BaseModel):
    """
    Full game state as returned by GET /api/world/state.
    
    The server returns the agent's own state under the key "self",
    but since `self` is reserved in Python, we alias it to `self_state`.
    """
    tick: int = 0
    game_state: str = "LOBBY_OPEN"           # LOBBY_OPEN, GAME_ACTIVE, GAME_OVER
    self_state: SelfState = Field(alias="self")
    zone: ZoneState = Field(default_factory=ZoneState)
    nearby_entities: list[NearbyEntity] = Field(default_factory=list)
    messages: list[dict] = Field(default_factory=list)
    events: list[dict] = Field(default_factory=list)
    alive_count: int = 0
    elapsed_seconds: int = 0

    model_config = {"populate_by_name": True}


class ActionResult(BaseModel):
    """Response from POST /api/action."""
    success: bool = False
    action_queued: Optional[str] = None
    tick_queued: Optional[int] = None
    error: Optional[str] = None
    message: Optional[str] = None


class PaymentRequired(BaseModel):
    """Payment details from the 402 response during the x402 join flow."""
    payment_address: str
    amount_wei: str
    amount_display: str
    chain_id: int
    rpc_url: str
    session_id: str
    expires_at: int
    instructions: str = ""


class JoinResult(BaseModel):
    """Successful join response from POST /api/join."""
    auth_token: str
    agent_id: str
    game_id: str = ""
    display_name: str = ""
    position: Optional[list[int]] = None
    spawn_position: Optional[list[int]] = None
    game_state: str = "LOBBY_OPEN"
    players_connected: Optional[int] = None
    game_starts_in_seconds: Optional[int] = None
