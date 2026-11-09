// Home-page headlines. Every value is derived from the real screener rows; labels and
// directions come from index.json. No result numbers are hard-coded.
import type { DetectiveCase, ScreenerRow, VariableMeta } from '../../data/types'
import { buildViewRows, formatPercent, type ScreenerViewRow } from '../Screener/metrics'

export interface HomeInsight {
  id: string
  kicker: string
  value: string
  unit: string
  title: string
  detail: string
  variableId: string | null
  /** Schema 1.2 §12: flagged share of the significant area, when the export has it. */
  qualityFlagged: number | null
}

export interface CautionEntry {
  caseId: string
  title: string
  summary: string
}
/** Display rule for the breadth headline, not a data value. */
export const BREADTH_THRESHOLD = 0.1

/** A flagged share above this fraction gets one muted evidence line. */
export const QUALITY_NOTE_THRESHOLD = 0.2

export function shouldShowQualityNote(insight: HomeInsight): boolean {
  return insight.qualityFlagged != null && insight.qualityFlagged > QUALITY_NOTE_THRESHOLD
}

/** Muted evidence line for a card whose significant area is substantially flagged. */
export function qualityEvidenceText(insight: HomeInsight): string | null {
  if (!shouldShowQualityNote(insight) || insight.qualityFlagged == null) return null
  return `${formatPercent(insight.qualityFlagged)} of this area shows a sudden shift; read the evidence`
}

function evaluated(rows: readonly ScreenerViewRow[]): ScreenerViewRow[] {
  return rows.filter((row) => row.nCells != null && row.nCells > 0)
}

function lossScore(row: ScreenerViewRow): number | null {
  if (row.sigDecrease == null) return null
  if (row.sigTrendFlagged == null) return row.sigDecrease
  return row.sigDecrease * Math.max(0, 1 - Math.min(1, row.sigTrendFlagged))
}

function qualityFlagged(row: ScreenerViewRow): number | null {
  return row.sigTrendFlagged != null && Number.isFinite(row.sigTrendFlagged) ? row.sigTrendFlagged : null
}

function maxBy(rows: readonly ScreenerViewRow[], value: (row: ScreenerViewRow) => number | null): ScreenerViewRow | null {
  let best: ScreenerViewRow | null = null
  let bestValue = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const current = value(row)
    if (current == null || !Number.isFinite(current)) continue
    if (current > bestValue) {
      best = row
      bestValue = current
    }
  }
  return best
}

/**
 * Four data-driven cards for Home. Missing rows/variables are skipped rather than filled
 * with placeholder values, so the page still works on a partial export.
 */
export function buildHomeInsights(
  variables: readonly VariableMeta[],
  rows: readonly ScreenerRow[],
  windowStart: string,
  windowEnd: string,
): HomeInsight[] {
  const viewRows = evaluated(buildViewRows(variables, rows))
  if (viewRows.length === 0) return []
  const period = `${windowStart}–${windowEnd}`
  const insights: HomeInsight[] = []

  const temperature =
    viewRows.find((row) => row.variableId === 'air_temperature') ??
    viewRows.find((row) => row.category === 'temperature') ??
    viewRows[0]
  if (temperature && temperature.sigIncrease != null) {
    insights.push({
      id: 'warming',
      kicker: 'Warming signal',
      value: formatPercent(temperature.sigIncrease),
      unit: 'of land is warming significantly',
      title: `${temperature.label} is warming`,
      detail: `A significant ${temperature.increaseMeans} trend over ${formatPercent(temperature.sigIncrease)} of land, ${period}.`,
      variableId: temperature.variableId,
      qualityFlagged: qualityFlagged(temperature),
    })
  }

  const broad = viewRows.filter(
    (row) => row.significantArea != null && row.significantArea > BREADTH_THRESHOLD,
  ).length
  if (broad > 0) {
    insights.push({
      id: 'breadth',
      kicker: 'Across variables',
      value: `${broad} / ${viewRows.length}`,
      unit: 'variables show broad significant change',
      title: `${broad} of ${viewRows.length} variables show significant change`,
      detail: `Each has a significant increase or decrease over more than ${Math.round(BREADTH_THRESHOLD * 100)}% of land, ${period}.`,
      variableId: null,
      qualityFlagged: null,
    })
  }

  const decreasing = maxBy(viewRows, lossScore)
  if (decreasing && decreasing.sigDecrease != null && decreasing.sigDecrease > 0) {
    insights.push({
      id: 'decrease',
      kicker: 'Loss signal',
      value: formatPercent(decreasing.sigDecrease),
      unit: `of land shows a significant decrease in ${decreasing.label.toLowerCase()}`,
      title: `${decreasing.label}: significant decrease`,
      detail: `${decreasing.label} falls significantly over ${formatPercent(decreasing.sigDecrease)} of land, ${period}.`,
      variableId: decreasing.variableId,
      qualityFlagged: qualityFlagged(decreasing),
    })
  }

  const contrasting = maxBy(viewRows, (row) => row.contrast)
  if (contrasting && contrasting.contrast != null && contrasting.contrast > 0) {
    insights.push({
      id: 'contrast',
      kicker: 'Regional contrast',
      value: contrasting.contrast.toFixed(2),
      unit: 'contrast score, 0 to 0.5',
      title: `${contrasting.label} changes in both directions`,
      detail: `${formatPercent(contrasting.sigIncrease)} of land increases and ${formatPercent(contrasting.sigDecrease)} decreases. The score is near 0.5 when both directions cover similar area.`,
      variableId: contrasting.variableId,
      qualityFlagged: qualityFlagged(contrasting),
    })
  }

  return insights.slice(0, 4)
}

/** The variable used for the Home hero thumbnail: the strongest significant area. */
export function heroVariableId(variables: readonly VariableMeta[], rows: readonly ScreenerRow[]): string | null {
  const viewRows = evaluated(buildViewRows(variables, rows))
  const best = maxBy(viewRows, (row) => row.significantArea)
  return best?.variableId ?? perspectiveFallback(variables)
}

function perspectiveFallback(variables: readonly VariableMeta[]): string | null {
  return variables.find((variable) => variable.id === 'air_temperature')?.id ?? variables[0]?.id ?? null
}

/** The published caution case, if the export has one. Never invents a place or a number. */
export function buildCautionEntry(cases: readonly DetectiveCase[] | null | undefined): CautionEntry | null {
  const item = cases?.find((entry) => entry.kind === 'caution')
  if (!item) return null
  const place = item.region.label.trim() || 'this place'
  const summary = item.summary?.trim() || item.why_selected.trim()
  return {
    caseId: item.id,
    title: `Look closer: ${place}`,
    summary,
  }
}
