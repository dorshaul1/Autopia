// The tile grid every office shares (one coherent scale and projection across all office types).

export const TILE = 16
export const COLS = 56
export const ROWS = 36
export const WORLD_W = COLS * TILE
export const WORLD_H = ROWS * TILE
/** Rows 0..3 are the north wall (cap + 3-tile face). */
export const WALL_ROWS = 4
