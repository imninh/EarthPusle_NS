// Schema 1.2 data-quality helpers (docs/DATA_CONTRACT.md §12).
// Flag codes: 0 = no sudden shift, 1 = sudden shift, 2 = sudden shift
// in a documented forcing-change period, −9 = not evaluated, −99 = outside domain.
import { N_COLS, N_ROWS, QUALITY_STEP_KNOWN_FORCING, cellAreaWeight, cellIndex } from '../../data/contract'
import { pick, type Lang } from '../../i18n'
import type { CellRange } from './model'
import { rangeColSegments } from './model'
import { QUALITY_STRINGS } from './strings.text'

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
    for (const [col0, col1] of rangeColSegments(range)) {
      for (let col = col0; col <= col1; col++) {
        addTally(tally, flagLayer, breakLayer, cellIndex(row, col), weight)
      }
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

function productFamily(product: string): string {
  return product.startsWith('GLDAS') ? 'GLDAS' : product
}

const DEFAULT_FORCING_PERIOD: readonly [number, number] = [2008, 2012]

/** "documented GLDAS input change (2008–2012)" for the known forcing window. */
export function documentedInputChange(
  product: string,
  knownForcingPeriod?: readonly [number, number] | null,
  lang: Lang = 'en',
): string {
  const [start, end] = knownForcingPeriod ?? DEFAULT_FORCING_PERIOD
  const period = start === end ? `${start}` : `${start}–${end}`
  return pick(QUALITY_STRINGS, lang).documentedChange(productFamily(product), period)
}

function breakYearWithin(year: number | null, period?: readonly [number, number] | null): boolean {
  if (year == null || !period) return false
  return year >= period[0] && year <= period[1]
}

/** Code 2 for a cell; for a region, a median break inside the documented period. */
export function isKnownForcingShift(
  quality: QualitySummary | null | undefined,
  knownForcingPeriod?: readonly [number, number] | null,
): boolean {
  if (!quality?.available || !quality.flagged) return false
  if (quality.flag === QUALITY_STEP_KNOWN_FORCING) return true
  return quality.scope === 'region' && breakYearWithin(quality.breakYear, knownForcingPeriod)
}

function codeTwoSentence(product: string, period: readonly [number, number] | null | undefined, lang: Lang): string {
  return pick(QUALITY_STRINGS, lang).codeTwo(documentedInputChange(product, period, lang))
}

function codeOneSentence(year: number | null, lang: Lang): string {
  return pick(QUALITY_STRINGS, lang).codeOne(year)
}

/**
 * Quiet wording for the evidence card. Code 2 is a shift in a documented GLDAS
 * input-change period; code 1 can be a real climate jump or a data artefact.
 * Never says the data are "wrong" or an "error".
 */
export function qualityBannerText(
  quality: QualitySummary | null | undefined,
  product: string,
  version: string,
  knownForcingPeriod: readonly [number, number] | null | undefined,
  lang: Lang = 'en',
): string | null {
  if (!quality?.available || !quality.flagged) return null
  const s = pick(QUALITY_STRINGS, lang)
  const year = quality.breakYear == null ? null : Math.round(quality.breakYear)
  const knownForcing = isKnownForcingShift(quality, knownForcingPeriod)
  void version
  if (quality.scope === 'cell') {
    return knownForcing ? codeTwoSentence(product, knownForcingPeriod, lang) : codeOneSentence(year, lang)
  }
  const pct =
    quality.flaggedShare != null && quality.flaggedShare > 0
      ? Math.max(1, Math.round(quality.flaggedShare * 100))
      : null
  const lead = pct == null ? s.leadBannerPart : s.leadBannerPct(pct)
  if (knownForcing) return s.regionKnown(lead, documentedInputChange(product, knownForcingPeriod, lang))
  return s.regionOther(lead, year)
}

/** Short row for the evidence card; null when the export has no quality layers. */
export function qualityDetailText(quality: QualitySummary | null | undefined, lang: Lang = 'en'): string | null {
  if (!quality?.available) return null
  const s = pick(QUALITY_STRINGS, lang)
  if (quality.scope === 'cell') {
    if (quality.flag == null) return s.cellNoFlag
    if (quality.flag < 0) return s.cellNotEvaluated
    if (!quality.flagged) return s.cellNoShift
    return quality.flag === QUALITY_STEP_KNOWN_FORCING
      ? codeTwoSentence('GLDAS_NOAH10_M', null, lang)
      : codeOneSentence(quality.breakYear == null ? null : Math.round(quality.breakYear), lang)
  }
  if (quality.evaluatedCells === 0) return s.regionNotEvaluated
  if (!quality.flagged) return s.regionNoShift
  const pct = quality.flaggedShare == null ? null : Math.round(quality.flaggedShare * 100)
  const lead = pct == null ? s.leadDetailFlagged : s.leadDetailPct(pct)
  const year = quality.breakYear == null ? null : Math.round(quality.breakYear)
  if (isKnownForcingShift(quality, DEFAULT_FORCING_PERIOD)) {
    return s.regionKnown(lead, documentedInputChange('GLDAS_NOAH10_M', null, lang))
  }
  return s.regionOther(lead, year)
}
