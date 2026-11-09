// Mirror of earthpulse/contract.py and docs/DATA_CONTRACT.md. Change all three together.

export const SCHEMA_VERSION = '1.1' // P08 bumps to '1.2' with the 1.2 export

export const N_ROWS = 180
export const N_COLS = 360
export const RESOLUTION_DEG = 1
export const LAT_NORTH_CENTER = 89.5
export const LON_WEST_CENTER = -179.5
export const N_MONTHS = 288
export const TILE_SIZE = 10

export const OUTSIDE_DOMAIN = -99
export const INSUFFICIENT_DATA = -9
export const TREND_INCREASE = 1
export const TREND_DECREASE = -1
export const TREND_NOT_SIGNIFICANT = 0

export const PATTERN_MIXED = 0
export const PATTERN_WARMING_DRYING = 1
export const PATTERN_WARMING_WETTING = 2
export const PATTERN_COOLING_DRYING = 3
export const PATTERN_COOLING_WETTING = 4

export const FLOAT_LAYERS = [
  'sen_slope',
  'sen_slope_decade',
  'std_change_decade',
  'p_value',
  'p_value_original',
  'q_value',
  'mk_tau',
  'n_valid',
  'coverage',
] as const
export type FloatLayer = (typeof FLOAT_LAYERS)[number]

export const rowToLat = (row: number) => LAT_NORTH_CENTER - row * RESOLUTION_DEG
export const colToLon = (col: number) => LON_WEST_CENTER + col * RESOLUTION_DEG
export const latToRow = (lat: number) => Math.floor((90 - lat) / RESOLUTION_DEG)
export const lonToCol = (lon: number) => Math.floor((lon + 180) / RESOLUTION_DEG)
export const cellIndex = (row: number, col: number) => row * N_COLS + col

/** Relative cell area (cos latitude), used for area-weighted aggregation. */
export const cellAreaWeight = (row: number) => Math.cos((rowToLat(row) * Math.PI) / 180)

/** Tile id containing a cell, e.g. r060_c100. */
export function tileIdFor(row: number, col: number): string {
  const r0 = Math.floor(row / TILE_SIZE) * TILE_SIZE
  const c0 = Math.floor(col / TILE_SIZE) * TILE_SIZE
  return `r${String(r0).padStart(3, '0')}_c${String(c0).padStart(3, '0')}`
}

// --- Schema 1.2: data-quality layers (DATA_CONTRACT §12). Optional: may be absent. ---
export const QUALITY_NONE = 0
export const QUALITY_STEP = 1
export const QUALITY_STEP_KNOWN_FORCING = 2

// --- Schema 1.2: country regions (DATA_CONTRACT §11). Optional: may be absent. ---
export const COUNTRY_NONE = -1
