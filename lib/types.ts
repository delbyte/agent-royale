export interface PlayerState {
    id: string;
    display_name: string;
    position: [number, number];
    hp: number;
    alive: boolean;
    kills: number;
    holding: string | null;  // weapon name or null
    last_action?: 'MOVE' | 'ATTACK' | 'HARVEST' | 'CRAFT' | 'USE' | 'TALK' | 'IDLE' | null;
    last_action_tick?: number | null;
    last_action_target?: string | null;
}

export interface EntityState {
    id: string;
    type: 'RESOURCE' | 'WORKBENCH' | 'BARRICADE' | 'LOOT';
    subtype?: string;
    position: [number, number];
    hp?: number;
}

export interface ZoneState {
    center: [number, number];
    radius: number;
    next_shrink_tick: number | null;
    next_radius: number | null;
    damage_per_tick_outside: number;
}

export interface KillEvent {
    tick: number;
    victim_id: string;
    victim_name: string;
    killer_id: string | null;
    killer_name: string | null;
    cause: 'combat' | 'zone' | 'wolves';
    position: [number, number];
}

export interface ChatEvent {
    from: string;
    from_name: string;
    text: string;
    position: [number, number];
    tick: number;
}

export interface GameTick {
    game_id: string;
    tick: number;
    game_state: 'LOBBY_OPEN' | 'GAME_ACTIVE' | 'GAME_OVER';
    players: PlayerState[];
    entities: EntityState[];
    zone: ZoneState;
    alive_count: number;
    kill_log: KillEvent[];
    chat_log: ChatEvent[];
}

export interface GameOverData {
    winner: {
        id: string;
        display_name: string;
        wallet_address: string;
        hp: number;
        kills: number;
    } | null;
    total_ticks: number;
    kill_log: KillEvent[];
    pool_display: string;
    payout_tx_hash: string | null;
    payout_explorer_url: string | null;
}

// Interpolated player for rendering (3D position)
export interface InterpolatedPlayer extends PlayerState {
    prevPosition: [number, number];
    renderX: number;
    renderZ: number;
    interpolationT: number;
    recent_damage?: number;
}
