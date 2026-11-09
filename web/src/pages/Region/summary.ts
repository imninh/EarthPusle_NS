// Plain-language one-sentence summary of the evidence card.
// Wording follows the numbers: no causal claims, and "not significant" is never
// phrased as "no change".
import type { EvidenceModel } from './model'
import { documentedInputChange, isKnownForcingShift, type QualitySummary } from './quality'

export interface SummaryInput {
  evidence: EvidenceModel
  /** Includes the preposition, e.g. "in Vietnam" or "at this grid cell". */
  placeLabel: string
  windowStart: string
  windowEnd: string
  quality?: QualitySummary | null
  /** Documented forcing-change period for this product, when the export defines one. */
  knownForcingPeriod?: readonly [number, number] | null
}

function lowerFirst(text: string): string {
  if (text.length === 0) return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function formatMagnitude(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 100) return String(Math.round(abs))
  if (abs >= 10) return String(Number(abs.toFixed(1)))
  if (abs >= 0.01) return String(Number(abs.toFixed(2)))
  if (abs >= 0.0001) return String(Number(abs.toFixed(4)))
  return abs.toExponential(1)
}

function formatStat(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null
  const abs = Math.abs(value)
  if (abs !== 0 && abs < 0.0001) return value.toExponential(2)
  return String(Number(value.toFixed(4)))
}

function windowYears(start: string, end: string): string {
  const startYear = start.slice(0, 4)
  const endYear = end.slice(0, 4)
  if (!startYear) return endYear || 'the selected window'
  if (!endYear || startYear === endYear) return startYear
  return `${startYear}–${endYear}`
}

function caution(
  quality: QualitySummary | null | undefined,
  product: string,
  knownForcingPeriod?: readonly [number, number] | null,
): string {
  if (!quality?.available || !quality.flagged) return ''
  if (isKnownForcingShift(quality, knownForcingPeriod)) {
    return `; a sudden shift during a ${documentedInputChange(product, knownForcingPeriod)}: possible data discontinuity; read the trend with caution`
  }
  const year = quality.breakYear == null ? '' : ` around ${Math.round(quality.breakYear)}`
  return `; a sudden shift${year} could be a real jump in the climate or a data artefact; the trend is still significant, and a step fits slightly better than a straight line`
}

/**
 * One sentence for the top of the evidence view. Significant, not significant,
 * insufficient-data and quality-flagged cases have distinct, non-causal wording.
 */
export function summarySentence(input: SummaryInput): string {
  const { evidence, placeLabel, windowStart, windowEnd } = input
  const range = windowYears(windowStart, windowEnd)
  const variable = lowerFirst(evidence.variableLabel)
  const trail = caution(input.quality, evidence.product, input.knownForcingPeriod)
  const subject = `${variable} ${placeLabel}`

  if (evidence.trendClass === 'insufficient data') {
    return `Over ${range}, there are not enough valid months for ${subject} to estimate a trend reliably.`
  }
  if (
    evidence.trendClass === 'not available' ||
    evidence.trendClass === 'outside domain' ||
    evidence.senSlopeDecade == null
  ) {
    return `Over ${range}, there is not enough information to summarise the trend in ${subject}.`
  }

  const magnitude = `${formatMagnitude(evidence.senSlopeDecade)} ${evidence.slopeUnit}`
  if (evidence.trendClass === 'not significant') {
    return `Over ${range}, ${subject} changed by about ${magnitude}, but the trend is not statistically significant, which does not mean there was no change${trail}.`
  }
  if (evidence.trendClass !== 'increasing' && evidence.trendClass !== 'decreasing') {
    return `Over ${range}, there is not enough information to summarise the trend in ${subject}.`
  }

  const warm = evidence.category === 'temperature'
  const verb = evidence.senSlopeDecade >= 0 ? (warm ? 'rose' : 'increased') : (warm ? 'fell' : 'decreased')
  const useQ = evidence.showQ && evidence.q != null
  const statLabel = useQ ? 'q' : 'p'
  const statValue = formatStat(useQ ? evidence.q : evidence.p)
  const significance = statValue == null ? 'this trend is statistically significant' : `this trend is statistically significant (${statLabel} = ${statValue})`
  return `Over ${range}, ${subject} ${verb} by about ${magnitude}; ${significance}${trail}.`
}
