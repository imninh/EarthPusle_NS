// Pure screener display rules. Fractions and contrast follow docs/DATA_CONTRACT.md §6.
import type { ScreenerRow, VariableMeta } from '../../data/types'

/** Spec tooltip for median_abs_std_change_decade. */
export const MAGNITUDE_TOOLTIP = 'standard deviations per decade, median over significant cells'

/** Coverage below this fraction shows a warning. The spec threshold is 70%. */
export const COVERAGE_WARN_BELOW = 0.7

export type SortKey = 'significantArea' | 'magnitude' | 'contrast' | 'coverage'
export type SortDirection = 'asc' | 'desc'

export const SORT_COLUMNS: readonly { id: SortKey; label: string }[] = [
  { id: 'significantArea', label: 'Area with significant change (increase + decrease)' },
  { id: 'magnitude', label: 'Typical change' },
  { id: 'contrast', label: 'Opposite trends' },
  { id: 'coverage', label: 'Coverage' },
]

export interface ScreenerViewRow {
  variableId: string
  label: string
  category: string
  sourceBadge: 'model' | 'satellite'
  unit: string
  increaseMeans: string
  sigIncrease: number | null
  sigDecrease: number | null
  significantArea: number | null
  magnitude: number | null
  contrast: number | null
  coverage: number | null
  nCells: number | null
  /** Schema 1.2 §12: area fraction with a possible data discontinuity. */
  stepFlag: number | null
  /** Schema 1.2 §12: flagged fraction of the significant-trend area. */
  sigTrendFlagged: number | null
}

type VariableFields = Pick<
  VariableMeta,
  'id' | 'label' | 'category' | 'source_type' | 'display_unit' | 'increase_means'
>

/** Same mapping as VariableSelect: model stays "model"; mission_observation is "satellite". */
export function sourceBadge(sourceType: VariableMeta['source_type']): 'model' | 'satellite' {
  return sourceType === 'model' ? 'model' : 'satellite'
}

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Sum of the two significant-area fractions. Null when either side is missing. */
export function significantArea(increase: number | null, decrease: number | null): number | null {
  if (increase == null || decrease == null) return null
  return increase + decrease
}

/**
 * One decimal percent. Null and non-finite values are an em dash.
 * Chosen so coverage near 0.99 and small significant fractions both stay readable.
 */
export function formatPercent(fraction: number | null): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(1)}%`
}

/** Two decimals. Null is an em dash. */
export function formatMagnitude(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

/** Three decimals so a printed value does not round across the 0.1 and 0.3 word thresholds. */
export function formatContrast(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(3)
}

export function formatCellCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

/**
 * Words for regional_contrast. Null (including up + down = 0) is an em dash.
 * Thresholds: < 0.1, < 0.3, and ≥ 0.3.
 */
export function contrastLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value < 0.1) return 'one direction'
  if (value < 0.3) return 'mostly one direction'
  return 'mixed directions'
}

/** Width of one half of the diverging bar, as a percent of the full track (0–50). */
export function barHalfPercent(fraction: number | null): number {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) return 0
  return Math.min(1, fraction) * 50
}

/** Fill of the 0–0.5 contrast meter, as a percent of the track. */
export function contrastMeterPercent(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(1, value / 0.5) * 100
}

export function coverageIsLow(fraction: number | null): boolean {
  return fraction != null && Number.isFinite(fraction) && fraction < COVERAGE_WARN_BELOW
}

/**
 * No ranking when the file has no rows, or every joined variable has no evaluated cells.
 * A zero count is "no cells", not a missing metric.
 */
export function domainHasNoEvaluatedCells(rows: readonly { nCells: number | null }[]): boolean {
  if (rows.length === 0) return true
  return rows.every((row) => row.nCells == null || row.nCells === 0)
}

export function metricValue(row: ScreenerViewRow, key: SortKey): number | null {
  if (key === 'significantArea') return row.significantArea
  if (key === 'magnitude') return row.magnitude
  if (key === 'contrast') return row.contrast
  return row.coverage
}

export function sortDescription(key: SortKey, direction: SortDirection): string {
  const label = SORT_COLUMNS.find((column) => column.id === key)?.label ?? key
  const phrase = label.charAt(0).toLowerCase() + label.slice(1)
  const order = direction === 'desc' ? 'largest first' : 'smallest first'
  return `Sorted by ${phrase}, ${order}.`
}

function compareNullsLast(a: number | null, b: number | null, direction: SortDirection): number {
  const aMissing = a == null || !Number.isFinite(a)
  const bMissing = b == null || !Number.isFinite(b)
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0
    return aMissing ? 1 : -1
  }
  if (a === b) return 0
  return direction === 'asc' ? a - b : b - a
}

/** Stable sort. Null and non-finite values are last in both directions. */
export function sortByMetric<T>(
  rows: readonly T[],
  value: (row: T) => number | null,
  direction: SortDirection,
): T[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  indexed.sort((a, b) => {
    const compared = compareNullsLast(value(a.row), value(b.row), direction)
    return compared !== 0 ? compared : a.index - b.index
  })
  return indexed.map((item) => item.row)
}

export function buildViewRows(variables: readonly VariableFields[], rows: readonly ScreenerRow[]): ScreenerViewRow[] {
  const byId = new Map(rows.map((row) => [row.variable, row]))
  return variables.map((variable) => {
    const row = byId.get(variable.id)
    const sigIncrease = row ? finiteOrNull(row.sig_increase_area_fraction) : null
    const sigDecrease = row ? finiteOrNull(row.sig_decrease_area_fraction) : null
    return {
      variableId: variable.id,
      label: variable.label,
      category: variable.category,
      sourceBadge: sourceBadge(variable.source_type),
      unit: variable.display_unit,
      increaseMeans: variable.increase_means,
      sigIncrease,
      sigDecrease,
      significantArea: significantArea(sigIncrease, sigDecrease),
      magnitude: row ? finiteOrNull(row.median_abs_std_change_decade) : null,
      contrast: row ? finiteOrNull(row.regional_contrast) : null,
      coverage: row ? finiteOrNull(row.valid_area_fraction) : null,
      nCells: row ? finiteOrNull(row.n_cells_evaluated) : null,
      stepFlag: row ? finiteOrNull(row.step_flag_area_fraction) : null,
      sigTrendFlagged: row ? finiteOrNull(row.sig_trend_flagged_fraction) : null,
    }
  })
}

/** True only when the export actually contains schema-1.2 quality fields. */
export function hasDiscontinuityFields(rows: readonly ScreenerViewRow[]): boolean {
  return rows.some((row) => row.stepFlag != null || row.sigTrendFlagged != null)
}

/** Display rule for the headline, not a data result. */
export const HEADLINE_THRESHOLD = 0.1

/**
 * One-line ranking summary computed from the rows. "Land" comes from the caller's domain
 * label, so a country domain does not claim to describe the whole planet.
 */
export function screenerHeadline(
  rows: readonly ScreenerViewRow[],
  domainLabel: string,
  threshold = HEADLINE_THRESHOLD,
): string {
  const evaluated = rows.filter((row) => row.nCells != null && row.nCells > 0)
  const percent = Math.round(threshold * 100)
  if (evaluated.length === 0) return `No cells were evaluated in ${domainLabel} for this period.`
  const broad = evaluated.filter(
    (row) => row.significantArea != null && row.significantArea > threshold,
  ).length
  if (broad === 0) {
    return `No variable shows significant change over more than ${percent}% of ${domainLabel} in this period.`
  }
  return `${broad} of ${evaluated.length} variables show significant change over more than ${percent}% of ${domainLabel}.`
}
