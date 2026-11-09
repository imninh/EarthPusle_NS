import {
  cellAreaWeight,
  cellIndex,
  colToLon,
  INSUFFICIENT_DATA,
  N_COLS,
  N_ROWS,
  OUTSIDE_DOMAIN,
  rowToLat,
  TILE_SIZE,
  tileIdFor,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
} from '../../data/contract'
import { cellSeriesFromTile } from '../../data/loaders'
import { fitIntercept, mannKendall, senSlope, spearman, type SpearmanResult } from '../../lib/stats'
import type { VariableMeta } from '../../data/types'

export const CELL_METHOD = 'precomputed: Hamed–Rao modified Mann–Kendall, FDR-corrected'
export const BROWSER_METHOD =
  'computed in browser: single test on the region average, original Mann–Kendall, no FDR correction'

const MIN_VALID_FRACTION = 0.8
const MIN_MONTHS = 10 * 12
const ALPHA = 0.05

export interface EvidenceModel {
  method: string
  source: 'precomputed' | 'browser'
  variableLabel: string
  category: string
  product: string
  productVersion: string
  doi: string | null
  sourceVariable: string
  windowLabel: string
  senSlopeDecade: number | null
  slopeUnit: string
  p: number | null
  q: number | null
  showQ: boolean
  tau: number | null
  validMonths: number | null
  monthsInWindow: number
  coverage: number | null
  coverageNote: string | null
  trendClass: string
  caveats: string[]
  shortWindow: boolean
  cellsInBox: number | null
  maskCells: number | null
  cellsUsed: number | null
  missingTiles: string[] | null
}

export interface TrendLine {
  slopePerYear: number
  intercept: number
}

export function perDecadeUnit(slopeUnit: string): string {
  const trimmed = slopeUnit.trim()
  if (trimmed === 'per year') return 'per decade'
  if (trimmed.endsWith(' per year')) return `${trimmed.slice(0, -' per year'.length)} per decade`
  if (trimmed.endsWith('per year')) return `${trimmed.slice(0, -'per year'.length)}per decade`
  return `${trimmed} per decade`
}

export function monthsSince(origin: string, month: string): number {
  const [y0, m0] = origin.split('-').map(Number)
  const [y1, m1] = month.split('-').map(Number)
  return (y1 - y0) * 12 + (m1 - m0)
}

export function windowMonths(months: readonly string[], start: string, end: string): string[] {
  return months.filter((month) => month >= start && month <= end)
}

export function normalizeValue(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return value
}

export function alignToMonths(
  sourceMonths: readonly string[],
  values: readonly (number | null)[],
  targetMonths: readonly string[],
): (number | null)[] {
  const byMonth = new Map<string, number | null>()
  for (let i = 0; i < sourceMonths.length; i++) byMonth.set(sourceMonths[i], normalizeValue(values[i]))
  return targetMonths.map((month) => (byMonth.has(month) ? byMonth.get(month)! : null))
}

export function floatSeriesToValues(series: ArrayLike<number>): (number | null)[] {
  const out: (number | null)[] = new Array(series.length)
  for (let i = 0; i < series.length; i++) out[i] = normalizeValue(series[i])
  return out
}

export function meanFinite(values: readonly (number | null)[]): number | null {
  let sum = 0
  let n = 0
  for (const value of values) {
    if (value != null && Number.isFinite(value)) {
      sum += value
      n++
    }
  }
  return n === 0 ? null : sum / n
}

export function countValid(values: readonly (number | null)[]): number {
  let n = 0
  for (const value of values) if (value != null && Number.isFinite(value)) n++
  return n
}

function finiteArray(values: readonly (number | null)[]): number[] {
  return values.map((value) => (value == null || !Number.isFinite(value) ? Number.NaN : value))
}

export function browserTrendClass(
  p: number | null,
  slopePerYear: number | null,
  validMonths: number,
  monthsInWindow: number,
): string {
  if (
    monthsInWindow <= 0 ||
    validMonths < MIN_VALID_FRACTION * monthsInWindow ||
    monthsInWindow < MIN_MONTHS
  ) {
    return 'insufficient data'
  }
  if (p == null || slopePerYear == null || !Number.isFinite(p) || !Number.isFinite(slopePerYear)) {
    return 'insufficient data'
  }
  if (p < ALPHA && slopePerYear > 0) return 'increasing'
  if (p < ALPHA && slopePerYear < 0) return 'decreasing'
  return 'not significant'
}

export function cellTrendClassWords(code: number | null): string {
  if (code == null || !Number.isFinite(code)) return 'not available'
  if (code === TREND_INCREASE) return 'increasing'
  if (code === TREND_DECREASE) return 'decreasing'
  if (code === TREND_NOT_SIGNIFICANT) return 'not significant'
  if (code === INSUFFICIENT_DATA) return 'insufficient data'
  if (code === OUTSIDE_DOMAIN) return 'outside domain'
  return `unknown class ${code}`
}

function variableFields(variable: VariableMeta, windowLabel: string, monthsInWindow: number) {
  return {
    variableLabel: variable.label,
    category: variable.category,
    product: variable.product,
    productVersion: variable.product_version,
    doi: variable.doi,
    sourceVariable: variable.source_variable,
    windowLabel,
    slopeUnit: perDecadeUnit(variable.slope_unit),
    monthsInWindow,
    caveats: variable.caveats,
    shortWindow: monthsInWindow < MIN_MONTHS,
  }
}

export function buildBrowserEvidence(args: {
  variable: VariableMeta
  windowLabel: string
  windowMonths: readonly string[]
  anomalies: readonly (number | null)[]
  coverage: number | null
  coverageNote: string | null
  cellsInBox?: number | null
  maskCells?: number | null
  cellsUsed?: number | null
  missingTiles?: string[] | null
}): { evidence: EvidenceModel; trend: TrendLine | null } {
  const months = args.windowMonths
  const anomalies = months.map((_, i) => normalizeValue(args.anomalies[i]))
  const origin = months[0] ?? args.windowLabel
  const t = months.map((month) => monthsSince(origin, month) / 12)
  const numeric = finiteArray(anomalies)
  const fit = months.length > 0 ? senSlope(t, numeric) : null
  const mk = mannKendall(numeric)
  const validMonths = countValid(anomalies)
  const shared = variableFields(args.variable, args.windowLabel, months.length)
  return {
    trend: fit ? { slopePerYear: fit.slope, intercept: fit.intercept } : null,
    evidence: {
      ...shared,
      method: BROWSER_METHOD,
      source: 'browser',
      senSlopeDecade: fit ? fit.slope * 10 : null,
      p: mk ? mk.p : null,
      q: null,
      showQ: false,
      tau: mk ? mk.tau : null,
      validMonths,
      coverage: args.coverage,
      coverageNote: args.coverageNote,
      trendClass: browserTrendClass(mk ? mk.p : null, fit ? fit.slope : null, validMonths, months.length),
      cellsInBox: args.cellsInBox ?? null,
      maskCells: args.maskCells ?? null,
      cellsUsed: args.cellsUsed ?? null,
      missingTiles: args.missingTiles ?? null,
    },
  }
}

export function buildCellEvidence(args: {
  variable: VariableMeta
  windowLabel: string
  monthsInWindow: number
  senSlopeDecade: number | null
  p: number | null
  q: number | null
  tau: number | null
  nValid: number | null
  coverage: number | null
  trendClass: number | null
}): EvidenceModel {
  return {
    ...variableFields(args.variable, args.windowLabel, args.monthsInWindow),
    method: CELL_METHOD,
    source: 'precomputed',
    senSlopeDecade: args.senSlopeDecade,
    p: args.p,
    q: args.q,
    showQ: true,
    tau: args.tau,
    validMonths: args.nValid,
    coverage: args.coverage,
    coverageNote: 'Precomputed coverage layer (valid months / months in the window).',
    trendClass: cellTrendClassWords(args.trendClass),
    cellsInBox: null,
    maskCells: null,
    cellsUsed: null,
    missingTiles: null,
  }
}

export function cellTrendLine(
  windowMonthsList: readonly string[],
  anomalies: readonly (number | null)[],
  slopePerYear: number | null,
): TrendLine | null {
  if (slopePerYear == null || !Number.isFinite(slopePerYear) || windowMonthsList.length === 0) return null
  const origin = windowMonthsList[0]
  const t = windowMonthsList.map((month) => monthsSince(origin, month) / 12)
  const intercept = fitIntercept(t, finiteArray(anomalies), slopePerYear)
  if (intercept == null) return null
  return { slopePerYear, intercept }
}

export function senTrendSeries(
  months: readonly string[],
  start: string,
  end: string,
  trend: TrendLine,
): { months: string[]; y: number[] } {
  const outMonths: string[] = []
  const y: number[] = []
  for (const month of months) {
    if (month < start || month > end) continue
    outMonths.push(month)
    y.push(trend.intercept + trend.slopePerYear * (monthsSince(start, month) / 12))
  }
  return { months: outMonths, y }
}

export function zScoresInWindow(
  months: readonly string[],
  values: readonly (number | null)[],
  start: string,
  end: string,
): (number | null)[] {
  const sample: number[] = []
  for (let i = 0; i < months.length; i++) {
    if (months[i] < start || months[i] > end) continue
    const value = normalizeValue(values[i])
    if (value != null) sample.push(value)
  }
  if (sample.length === 0) return months.map(() => null)
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length
  let square = 0
  for (const value of sample) square += (value - mean) ** 2
  const sd = Math.sqrt(square / sample.length)
  return months.map((month, i) => {
    if (month < start || month > end) return null
    const value = normalizeValue(values[i])
    if (value == null) return null
    if (sd === 0) return 0
    return (value - mean) / sd
  })
}

/** Mean of the monthly anomalies in each calendar year, placed at mid-year for the chart. */
export function annualMeanSeries(
  months: readonly string[],
  values: readonly (number | null)[],
  start = '',
  end = '',
): { x: string[]; y: number[] } {
  const groups = new Map<number, { sum: number; n: number }>()
  const count = Math.min(months.length, values.length)
  for (let i = 0; i < count; i++) {
    const month = months[i]
    if ((start && month < start) || (end && month > end)) continue
    const value = normalizeValue(values[i])
    if (value == null) continue
    const year = Number(month.slice(0, 4))
    if (!Number.isFinite(year)) continue
    const group = groups.get(year) ?? { sum: 0, n: 0 }
    group.sum += value
    group.n += 1
    groups.set(year, group)
  }
  const years = [...groups.keys()].sort((a, b) => a - b)
  return {
    x: years.map((year) => `${year}-07`),
    y: years.map((year) => groups.get(year)!.sum / groups.get(year)!.n),
  }
}

export function spearmanInWindow(
  months: readonly string[],
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  start: string,
  end: string,
): SpearmanResult {
  const xs: number[] = []
  const ys: number[] = []
  const n = Math.min(months.length, a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (months[i] < start || months[i] > end) continue
    const x = normalizeValue(a[i])
    const y = normalizeValue(b[i])
    if (x == null || y == null) continue
    xs.push(x)
    ys.push(y)
  }
  return spearman(xs, ys)
}

export function correlationPairId(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`
}

export function spearmanLabel(
  kind: 'precomputed' | 'computed',
  rho: number | null,
  n: number | null,
): string {
  const rhoText = rho == null || !Number.isFinite(rho) ? 'undefined' : rho.toFixed(3)
  const nText = n == null || !Number.isFinite(n) ? '—' : String(Math.round(n))
  if (kind === 'precomputed') return `precomputed Spearman ρ = ${rhoText} (n = ${nText})`
  return `computed here: Spearman ρ = ${rhoText} (n = ${nText})`
}

export type BboxParse =
  | { ok: true; bbox: [number, number, number, number] }
  | { ok: false; message: string }

function parseFinite(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export function validateBbox(input: { west: string; south: string; east: string; north: string }): BboxParse {
  const west = parseFinite(input.west)
  const south = parseFinite(input.south)
  const east = parseFinite(input.east)
  const north = parseFinite(input.north)
  if (west == null || south == null || east == null || north == null) {
    return { ok: false, message: 'Enter finite numbers for west, south, east, and north.' }
  }
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    return { ok: false, message: 'Latitude must be between −90 and 90.' }
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    return { ok: false, message: 'Longitude must be between −180 and 180.' }
  }
  if (!(south < north)) return { ok: false, message: 'South must be less than north.' }
  if (!(west < east)) {
    return { ok: false, message: 'West must be less than east. Boxes that cross the dateline are not supported.' }
  }
  return { ok: true, bbox: [west, south, east, north] }
}

export interface CellRange {
  row0: number
  row1: number
  col0: number
  col1: number
}

/** Inclusive row/column range of cell centres inside the closed box. Empty when none fall inside. */
export function cellsInsideBbox(bbox: [number, number, number, number]): CellRange | null {
  const [west, south, east, north] = bbox
  let row0 = 0
  let row1 = N_ROWS - 1
  while (row0 <= row1 && rowToLat(row0) > north) row0++
  while (row1 >= row0 && rowToLat(row1) < south) row1--
  let col0 = 0
  let col1 = N_COLS - 1
  while (col0 <= col1 && colToLon(col0) < west) col0++
  while (col1 >= col0 && colToLon(col1) > east) col1--
  if (row0 > row1 || col0 > col1) return null
  return { row0, row1, col0, col1 }
}

export function tileIdsForRange(range: CellRange): string[] {
  const ids: string[] = []
  const rowStart = Math.floor(range.row0 / TILE_SIZE) * TILE_SIZE
  const colStart = Math.floor(range.col0 / TILE_SIZE) * TILE_SIZE
  for (let row = rowStart; row <= range.row1; row += TILE_SIZE) {
    for (let col = colStart; col <= range.col1; col += TILE_SIZE) ids.push(tileIdFor(row, col))
  }
  return ids
}

export interface LoadedTile {
  values: Float32Array | null
  anomalies: Float32Array | null
}

export interface BboxAggregate {
  values: (number | null)[]
  anomalies: (number | null)[]
  cellsInBox: number
  maskCells: number
  cellsUsed: number
  missingTiles: string[]
}

/**
 * Area-weighted mean (weight = cos(latitude)) of in-box cells.
 * A mask cell has at least one finite sample. A cell "contributed" when it has
 * a finite **anomaly** inside the window, because the trend is computed on anomalies.
 * Tiles absent from `tiles` are missing.
 */
export function aggregateBbox(args: {
  range: CellRange
  months: number
  tiles: ReadonlyMap<string, LoadedTile>
  windowStart: number
  windowEnd: number
}): BboxAggregate {
  const { range, months, tiles } = args
  const sumValue = new Float64Array(months)
  const weightValue = new Float64Array(months)
  const sumAnomaly = new Float64Array(months)
  const weightAnomaly = new Float64Array(months)
  let cellsInBox = 0
  let maskCells = 0
  let cellsUsed = 0
  const missing = new Set<string>()

  for (let row = range.row0; row <= range.row1; row++) {
    const weight = cellAreaWeight(row)
    for (let col = range.col0; col <= range.col1; col++) {
      cellsInBox++
      const tileId = tileIdFor(row, col)
      const tile = tiles.get(tileId)
      if (!tile || (tile.values == null && tile.anomalies == null)) {
        missing.add(tileId)
        continue
      }
      const values = tile.values ? cellSeriesFromTile(tile.values, row, col) : null
      const anomalies = tile.anomalies ? cellSeriesFromTile(tile.anomalies, row, col) : null
      let onMask = false
      let contributed = false
      for (let month = 0; month < months; month++) {
        const value = values ? values[month] : Number.NaN
        const anomaly = anomalies ? anomalies[month] : Number.NaN
        const valueOk = Number.isFinite(value)
        const anomalyOk = Number.isFinite(anomaly)
        if (valueOk || anomalyOk) onMask = true
        if (valueOk && weight > 0) {
          sumValue[month] += weight * value
          weightValue[month] += weight
        }
        if (anomalyOk && weight > 0) {
          sumAnomaly[month] += weight * anomaly
          weightAnomaly[month] += weight
        }
        // Coverage is about the anomaly mean used for the trend, not the values chart.
        if (month >= args.windowStart && month <= args.windowEnd && anomalyOk) {
          contributed = true
        }
      }
      if (onMask) maskCells++
      if (onMask && contributed) cellsUsed++
    }
  }

  const values: (number | null)[] = []
  const anomalies: (number | null)[] = []
  for (let month = 0; month < months; month++) {
    values.push(weightValue[month] > 0 ? sumValue[month] / weightValue[month] : null)
    anomalies.push(weightAnomaly[month] > 0 ? sumAnomaly[month] / weightAnomaly[month] : null)
  }
  return {
    values,
    anomalies,
    cellsInBox,
    maskCells,
    cellsUsed,
    missingTiles: [...missing].sort(),
  }
}

export function layerValue(layer: ArrayLike<number> | null | undefined, row: number, col: number): number | null {
  if (!layer) return null
  return normalizeValue(layer[cellIndex(row, col)])
}

export function formatDeg(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

export function formatLat(lat: number): string {
  const hemisphere = lat > 0 ? 'N' : lat < 0 ? 'S' : ''
  return `${formatDeg(Math.abs(lat))}°${hemisphere}`
}

export function formatLon(lon: number): string {
  const hemisphere = lon > 0 ? 'E' : lon < 0 ? 'W' : ''
  return `${formatDeg(Math.abs(lon))}°${hemisphere}`
}
