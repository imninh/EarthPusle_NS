// Fetch helpers for the contract files. All results are cached per path.
import { N_COLS, N_MONTHS, N_ROWS, TILE_SIZE, type FloatLayer } from './contract'
import type { CasesFile, Country, DataIndex, RegionSeries, RegionsFile, ScreenerFile } from './types'

const BASE = `${import.meta.env.BASE_URL}data`
const cache = new Map<string, Promise<unknown>>()

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = load().catch((err: unknown) => {
      cache.delete(key)
      throw err
    })
    cache.set(key, p)
  }
  return cache.get(key) as Promise<T>
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res
}

function json<T>(path: string): Promise<T> {
  return cached<T>(path, async () => (await (await fetchOk(`${BASE}/${path}`)).json()) as T)
}

function binary(path: string): Promise<ArrayBuffer> {
  return cached(path, async () => (await fetchOk(`${BASE}/${path}`)).arrayBuffer())
}

function checkLength<T extends { length: number }>(arr: T, expected: number, what: string): T {
  if (arr.length !== expected) throw new Error(`${what}: expected ${expected} values, got ${arr.length}`)
  return arr
}

export const loadIndex = () => json<DataIndex>('index.json')
export const loadRegionsFile = () => json<RegionsFile>('regions.json')
export const loadRegions = () => loadRegionsFile().then((r) => r.regions)
/** Schema 1.2 (§11). Empty list when the export has no countries. */
export const loadCountries = () => loadRegionsFile().then((r): Country[] => r.countries ?? [])

/** Schema 1.2 (§11): country index per cell (−1 = none), or null when not exported. */
export async function loadCountryGrid(): Promise<Int16Array | null> {
  const file = await loadRegionsFile()
  if (!file.country_grid) return null
  const buf = await binary(file.country_grid)
  return checkLength(new Int16Array(buf), N_ROWS * N_COLS, 'country_grid')
}

/**
 * Schema 1.2 (§12): quality flag grid, or null when the export has no quality layers.
 * Codes: 0 none, 1 step-like change, 2 step-like change in a known forcing-change period,
 * −9 not evaluated, −99 outside domain.
 */
export async function loadQualityFlag(variableId: string, windowId: string): Promise<Int8Array | null> {
  const index = await loadIndex()
  if (!index.quality) return null
  const buf = await binary(`grids/${variableId}/${windowId}/quality_flag.i8`)
  return checkLength(new Int8Array(buf), N_ROWS * N_COLS, 'quality_flag')
}

/** Schema 1.2 (§12): decimal break year where flagged (NaN elsewhere), or null when absent. */
export async function loadBreakpointYear(variableId: string, windowId: string): Promise<Float32Array | null> {
  const index = await loadIndex()
  if (!index.quality) return null
  const buf = await binary(`grids/${variableId}/${windowId}/breakpoint_year.f32`)
  return checkLength(new Float32Array(buf), N_ROWS * N_COLS, 'breakpoint_year')
}

/** Schema 1.3 (§13): witness agreement codes, or null when the export has no witness block. */
export async function loadWitnessAgreement(variableId: string, windowId: string): Promise<Int8Array | null> {
  const index = await loadIndex()
  if (!index.witness) return null
  const buf = await binary(`grids/${variableId}/${windowId}/witness_agreement.i8`)
  return checkLength(new Int8Array(buf), N_ROWS * N_COLS, 'witness_agreement')
}

/** Schema 1.3 (§13): witness standardized change per decade (NaN = not evaluated), or null. */
export async function loadWitnessStdChange(variableId: string, windowId: string): Promise<Float32Array | null> {
  const index = await loadIndex()
  if (!index.witness) return null
  const buf = await binary(`grids/${variableId}/${windowId}/witness_std_change.f32`)
  return checkLength(new Float32Array(buf), N_ROWS * N_COLS, 'witness_std_change')
}
export const loadCases = () => json<CasesFile>('cases.json')
export const loadScreener = (windowId: string, domain = 'global') =>
  json<ScreenerFile>(`screener/${windowId}/${domain}.json`)
export const loadRegionSeries = (regionId: string, variableId: string) =>
  json<RegionSeries>(`series/regions/${regionId}/${variableId}.json`)

/** Float grid layer, length N_ROWS*N_COLS, NaN = missing. */
export async function loadFloatLayer(variableId: string, windowId: string, layer: FloatLayer): Promise<Float32Array> {
  const buf = await binary(`grids/${variableId}/${windowId}/${layer}.f32`)
  return checkLength(new Float32Array(buf), N_ROWS * N_COLS, layer)
}

/** Trend class grid (int8 codes from contract.ts). */
export async function loadTrendClass(variableId: string, windowId: string): Promise<Int8Array> {
  const buf = await binary(`grids/${variableId}/${windowId}/trend_class.i8`)
  return checkLength(new Int8Array(buf), N_ROWS * N_COLS, 'trend_class')
}

export async function loadPatternClass(windowId: string): Promise<Int8Array> {
  const buf = await binary(`patterns/${windowId}/pattern_class.i8`)
  return checkLength(new Int8Array(buf), N_ROWS * N_COLS, 'pattern_class')
}

export async function loadCorrelationLayer(pair: string, windowId: string, layer: string): Promise<Float32Array> {
  const buf = await binary(`correlations/${pair}/${windowId}/${layer}.f32`)
  return checkLength(new Float32Array(buf), N_ROWS * N_COLS, layer)
}

/** Monthly climatology, shape [12, N_ROWS, N_COLS] (calendar month Jan..Dec), NaN = undefined. */
export async function loadClimatology(variableId: string): Promise<Float32Array> {
  const buf = await binary(`series/climatology/${variableId}.f32`)
  return checkLength(new Float32Array(buf), 12 * N_ROWS * N_COLS, `climatology ${variableId}`)
}

const valuesCache = new Map<string, Promise<Float32Array>>()

/**
 * Per-cell monthly series tile, shape [N_MONTHS, TILE_SIZE, TILE_SIZE].
 * 'anomalies' is stored; 'values' is reconstructed as anomaly + climatology of the calendar
 * month (contract §8, schema 1.1). Months are assumed to start in January (index.months[0]).
 * Returns null when the tile does not exist (outside the land mask, or not exported).
 */
export async function loadTile(
  variableId: string,
  tileId: string,
  kind: 'values' | 'anomalies',
): Promise<Float32Array | null> {
  const index = await loadIndex()
  if (!index.tiles.ids.includes(tileId)) return null
  const buf = await binary(`series/tiles/${variableId}/${tileId}.anomalies.f32`)
  const anomalies = checkLength(new Float32Array(buf), N_MONTHS * TILE_SIZE * TILE_SIZE, tileId)
  if (kind === 'anomalies') return anomalies

  const key = `${variableId}/${tileId}`
  if (!valuesCache.has(key)) {
    valuesCache.set(
      key,
      loadClimatology(variableId).then((clim) => reconstructValues(anomalies, clim, tileId)),
    )
  }
  return valuesCache.get(key)!
}

/** value[m] = anomaly[m] + climatology[m % 12] for every cell of a tile. */
export function reconstructValues(anomalies: Float32Array, climatology: Float32Array, tileId: string): Float32Array {
  const m = /^r(\d{3})_c(\d{3})$/.exec(tileId)
  if (!m) throw new Error(`Bad tile id ${tileId}`)
  const r0 = Number(m[1])
  const c0 = Number(m[2])
  const cells = TILE_SIZE * TILE_SIZE
  const out = new Float32Array(anomalies.length)
  for (let month = 0; month < N_MONTHS; month++) {
    const climBase = (month % 12) * N_ROWS * N_COLS
    for (let r = 0; r < TILE_SIZE; r++) {
      for (let c = 0; c < TILE_SIZE; c++) {
        const i = month * cells + r * TILE_SIZE + c
        out[i] = anomalies[i] + climatology[climBase + (r0 + r) * N_COLS + (c0 + c)]
      }
    }
  }
  return out
}

/** Extract one cell's monthly series from a tile. */
export function cellSeriesFromTile(tile: Float32Array, row: number, col: number): Float32Array {
  const r = row % TILE_SIZE
  const c = col % TILE_SIZE
  const out = new Float32Array(N_MONTHS)
  for (let m = 0; m < N_MONTHS; m++) out[m] = tile[m * TILE_SIZE * TILE_SIZE + r * TILE_SIZE + c]
  return out
}
