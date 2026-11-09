// Schema 1.2 data-quality helpers (docs/DATA_CONTRACT.md §12).
// Flag codes: 0 = no step-like change, 1 = step-like change, 2 = step-like change
// in a documented forcing-change period, −9 = not evaluated, −99 = outside domain.
import { N_COLS, N_ROWS, cellAreaWeight, cellIndex } from '../../data/contract'
import type { CellRange } from './model'

export type QualityScope = 'cell' | 'region'

export interface QualitySummary {
  scope: QualityScope
  /** The quality files exist for this variable/window. */
  available: boolean
  /** Cell only: the raw flag at that cell. */
  flag: number | null
  flagged: boolean
  /** Area-weighted share (0..1) of evaluated cells with flag ≥ 1. Cell: 0 or 1. */
  flaggedShare: number | null
  flaggedCells: number
  evaluatedCells: number
  /** Median break year over flagged cells; null when no finite break year exists. */
  breakYear: number | null
}

function emptySummary(scope: QualityScope, available: boolean): QualitySummary {
  return {
    scope,
    available,
    flag: null,
    flagged: false,
    flaggedShare: null,
    flaggedCells: 0,
    evaluatedCells: 0,
    breakYear: null,
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function isEvaluated(flag: number): boolean {
  return Number.isFinite(flag) && flag >= 0
}

function finiteAt(layer: ArrayLike<number> | null | undefined, index: number): number | null {
  if (!layer) return null
  const value = layer[index]
  return Number.isFinite(value) ? value : null
}

/** Quality result for one cell. `available` is false when no flag layer was exported. */
export function cellQuality(
  flagLayer: ArrayLike<number> | null | undefined,
  breakLayer: ArrayLike<number> | null | undefined,
  row: number,
  col: number,
): QualitySummary {
  const unavailable = emptySummary('cell', false)
  if (!flagLayer) return unavailable
  const index = cellIndex(row, col)
  const flag = finiteAt(flagLayer, index)
  const summary = emptySummary('cell', true)
  if (flag == null || !isEvaluated(flag)) {
    summary.flag = flag
    return summary
  }
  const flagged = flag >= 1
  return {
    ...summary,
    flag,
    flagged,
    flaggedShare: flagged ? 1 : 0,
    flaggedCells: flagged ? 1 : 0,
    evaluatedCells: 1,
    breakYear: flagged ? finiteAt(breakLayer, index) : null,
  }
}

interface Tally {
  flaggedWeight: number
  evaluatedWeight: number
  flaggedCells: number
  evaluatedCells: number
  breaks: number[]
}

function addTally(
  tally: Tally,
  flagLayer: ArrayLike<number>,
  breakLayer: ArrayLike<number> | null | undefined,
  index: number,
  weight: number,
): void {
  const flag = flagLayer[index]
  if (!isEvaluated(flag)) return
  tally.evaluatedWeight += weight
  tally.evaluatedCells += 1
  if (flag < 1) return
  tally.flaggedWeight += weight
  tally.flaggedCells += 1
  const year = finiteAt(breakLayer, index)
  if (year != null) tally.breaks.push(year)
}

function finishTally(tally: Tally, scope: QualityScope): QualitySummary {
  return {
    scope,
    available: true,
    flag: null,
    flagged: tally.flaggedCells > 0,
    flaggedShare: tally.evaluatedWeight > 0 ? tally.flaggedWeight / tally.evaluatedWeight : null,
    flaggedCells: tally.flaggedCells,
    evaluatedCells: tally.evaluatedCells,
    breakYear: median(tally.breaks),
  }
}

function newTally(): Tally {
  return { flaggedWeight: 0, evaluatedWeight: 0, flaggedCells: 0, evaluatedCells: 0, breaks: [] }
}

/** Area-weighted flagged share for every evaluated cell in a grid range. */
export function qualityShareForRange(
  flagLayer: ArrayLike<number> | null | undefined,
  breakLayer: ArrayLike<number> | null | undefined,
  range: CellRange,
): QualitySummary {
  if (!flagLayer) return emptySummary('region', false)
  const tally = newTally()
  for (let row = range.row0; row <= range.row1; row++) {
    const weight = cellAreaWeight(row)
    if (weight <= 0) continue
    for (let col = range.col0; col <= range.col1; col++) {
      addTally(tally, flagLayer, breakLayer, cellIndex(row, col), weight)
    }
  }
  return finishTally(tally, 'region')
}

/** Area-weighted flagged share for every evaluated cell belonging to one country. */
export function qualityShareForCountry(
  flagLayer: ArrayLike<number> | null | undefined,
  breakLayer: ArrayLike<number> | null | undefined,
  countryGrid: ArrayLike<number> | null | undefined,
  countryIndex: number,
): QualitySummary {
  if (!flagLayer || !countryGrid) return emptySummary('region', false)
  const tally = newTally()
  for (let row = 0; row < N_ROWS; row++) {
    const weight = cellAreaWeight(row)
    if (weight <= 0) continue
    for (let col = 0; col < N_COLS; col++) {
      const index = cellIndex(row, col)
      if (countryGrid[index] !== countryIndex) continue
      addTally(tally, flagLayer, breakLayer, index, weight)
    }
  }
  return finishTally(tally, 'region')
}

function productLabel(product: string, version: string): string {
  if (product.startsWith('GLDAS')) return version ? `GLDAS-${version}` : product
  return version ? `${product} ${version}` : product
}

/**
 * Calm wording for the evidence card. Contract §12: a flag is a warning to read
 * the evidence, never a verdict that the data is "wrong".
 */
export function qualityBannerText(
  quality: QualitySummary | null | undefined,
  product: string,
  version: string,
  knownForcingPeriod: readonly [number, number] | null | undefined,
): string | null {
  if (!quality?.available || !quality.flagged) return null
  const year = quality.breakYear == null ? null : Math.round(quality.breakYear)
  const around = year == null ? '' : ` around ${year}`
  let text: string
  if (quality.scope === 'cell') {
    text = `This cell’s change looks like a sudden jump${around}.`
  } else if (quality.flaggedShare != null && quality.flaggedShare > 0) {
    const pct = Math.max(1, Math.round(quality.flaggedShare * 100))
    text = `About ${pct}% of evaluated cells in this region look like a sudden jump${around}.`
  } else {
    text = `Part of this change looks like a sudden jump${around}.`
  }
  if (knownForcingPeriod) {
    const [start, end] = knownForcingPeriod
    const period = start === end ? `${start}` : `${start}–${end}`
    text += ` ${productLabel(product, version)} inputs changed around ${period}; read the trend with caution.`
  } else {
    text += ' Read the trend with caution.'
  }
  return text
}

/** Short row for the evidence card; null when the export has no quality layers. */
export function qualityDetailText(quality: QualitySummary | null | undefined): string | null {
  if (!quality?.available) return null
  if (quality.scope === 'cell') {
    if (quality.flag == null) return 'No quality flag for this cell.'
    if (quality.flag < 0) return 'This cell was not evaluated for step-like changes.'
    if (!quality.flagged) return 'No step-like change detected in this cell.'
    return quality.breakYear == null
      ? 'Possible data discontinuity: change looks like a sudden jump.'
      : `Possible data discontinuity: change looks like a sudden jump around ${Math.round(quality.breakYear)}.`
  }
  if (quality.evaluatedCells === 0) return 'No cells in this region were evaluated for step-like changes.'
  if (!quality.flagged) return 'No step-like change detected in the evaluated cells.'
  const pct = quality.flaggedShare == null ? null : Math.round(quality.flaggedShare * 100)
  const share = pct == null ? '' : `${pct}% of evaluated cells`
  const year = quality.breakYear == null ? '' : ` around ${Math.round(quality.breakYear)}`
  return share
    ? `${share} show a possible data discontinuity (change looks like a sudden jump${year}).`
    : `Possible data discontinuity: change looks like a sudden jump${year}.`
}
