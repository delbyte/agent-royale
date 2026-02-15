export const GRID_SIZE = 50;
export const TILE_SIZE = 1;  // 1 world unit per tile
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
export const SOCKET_NAMESPACE = '/game';
export const TICK_RATE_MS = 1000;

// 3D World mapping: grid [x,y] → 3D [x, 0, z]
// Grid origin [0,0] = world position [0, 0, 0]
// Grid [49,49] = world position [49, 0, 49]
export function gridTo3D(gridPos: [number, number]): [number, number, number] {
    return [gridPos[0] * TILE_SIZE, 0, gridPos[1] * TILE_SIZE];
}

// Camera presets
export const CAMERA_GOD_VIEW = {
    position: [25, 45, 40] as [number, number, number],
    target: [25, 0, 25] as [number, number, number],
};

export const CAMERA_CLOSE = {
    distance: 10,
    height: 8,
};

// Colors
export const COLORS = {
    ground: '#2d5a27',  // Dark green grass
    zone: '#ff000033',  // Semi-transparent red
    zoneEdge: '#ff0000',
    gridLine: '#1a3d15',
    playerAlive: '#00ff88',
    playerDead: '#ff4444',
    tree: '#228b22',
    rock: '#808080',
    workbench: '#8b4513',
};
