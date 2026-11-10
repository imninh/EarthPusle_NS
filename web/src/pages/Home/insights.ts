// Home-page headlines. Every value is derived from the real screener rows; labels and
// directions come from index.json. No result numbers are hard-coded.
import type { Country, DetectiveCase, ScreenerRow, VariableMeta } from '../../data/types'
import { buildViewRows, formatPercent, type ScreenerViewRow } from '../Screener/metrics'
import { cautionCaseForVariable } from '../Story/model'

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
  /** Schema 1.3: confirmed share of the significant area, when the export has it. */
  witnessConfirmed: number | null
  /** Schema 1.3: contradicted share of the significant area, when the export has it. */
  witnessContradicted: number | null
  /** Optional Story case to open instead of Discovery. */
  caseId: string | null
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
  if (row.witnessCorroborated != null && Number.isFinite(row.witnessCorroborated)) {
    return row.sigDecrease * Math.max(0, Math.min(1, row.witnessCorroborated))
  }
  if (row.sigTrendFlagged == null) return row.sigDecrease
  return row.sigDecrease * Math.max(0, 1 - Math.min(1, row.sigTrendFlagged))
}

function qualityFlagged(row: ScreenerViewRow): number | null {
  return row.sigTrendFlagged != null && Number.isFinite(row.sigTrendFlagged) ? row.sigTrendFlagged : null
}

function witnessConfirmed(row: ScreenerViewRow): number | null {
  return row.witnessCorroborated != null && Number.isFinite(row.witnessCorroborated)
    ? row.witnessCorroborated
    : null
}

function witnessContradicted(row: ScreenerViewRow): number | null {
  return row.witnessContradicted != null && Number.isFinite(row.witnessContradicted)
    ? row.witnessContradicted
    : null
}

/** One muted evidence line when a second NASA dataset confirms the significant area. */
export function witnessEvidenceText(insight: HomeInsight): string | null {
  if (insight.witnessConfirmed == null) return null
  return `${formatPercent(insight.witnessConfirmed)} confirmed by a second NASA dataset`
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
  cases?: readonly DetectiveCase[] | null,
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
      witnessConfirmed: witnessConfirmed(temperature),
      witnessContradicted: witnessContradicted(temperature),
      caseId: null,
    })
  }

  const witnessCard = maxBy(viewRows, witnessContradicted)
  if (witnessCard && witnessCard.witnessContradicted != null && witnessCard.witnessContradicted > 0) {
    const caseId = cautionCaseForVariable(cases ?? [], witnessCard.variableId)?.id ?? null
    insights.push({
      id: 'witness',
      kicker: 'Second witness',
      value: formatPercent(witnessCard.witnessContradicted),
      unit: 'of this area is contradicted by a second NASA dataset',
      title: 'The second witness disagrees',
      detail: `${witnessCard.label}: ${formatPercent(witnessCard.witnessContradicted)} of its significant area is contradicted by an independent NASA dataset, so read the evidence.`,
      variableId: witnessCard.variableId,
      qualityFlagged: qualityFlagged(witnessCard),
      witnessConfirmed: witnessConfirmed(witnessCard),
      witnessContradicted: witnessContradicted(witnessCard),
      caseId,
    })
  } else {
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
        witnessConfirmed: null,
        witnessContradicted: null,
        caseId: null,
      })
    }
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
      witnessConfirmed: witnessConfirmed(decreasing),
      witnessContradicted: witnessContradicted(decreasing),
      caseId: null,
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
      witnessConfirmed: witnessConfirmed(contrasting),
      witnessContradicted: witnessContradicted(contrasting),
      caseId: null,
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

/** The published caution case whose region is a country, if one exists. */
export function buildCautionEntry(
  cases: readonly DetectiveCase[] | null | undefined,
  countries?: readonly Pick<Country, 'label'>[] | null,
): CautionEntry | null {
  const cautions = (cases ?? []).filter((entry) => entry.kind === 'caution')
  if (cautions.length === 0) return null
  const countryLabels = new Set(
    (countries ?? []).map((country) => country.label.trim().toLowerCase()).filter(Boolean),
  )
  const item =
    (countryLabels.size > 0
      ? cautions.find((entry) => countryLabels.has(entry.region.label.trim().toLowerCase()))
      : null) ?? cautions[0]!
  const place = item.region.label.trim() || 'this place'
  const summary = item.summary?.trim() || item.why_selected.trim()
  return {
    caseId: item.id,
    title: `Look closer: ${place}`,
    summary,
  }
}
