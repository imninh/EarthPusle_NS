// Plain-language one-sentence summary of the evidence card.
// Wording follows the numbers: no causal claims, and "not significant" is never
// phrased as "no change".
import { pick, type Lang } from '../../i18n'
import { formatUnit } from '../../lib/format'
import type { SenSlopeCI } from '../../lib/stats'
import { formatInterval, type EvidenceModel } from './model'
import { documentedInputChange, isKnownForcingShift, type QualitySummary } from './quality'
import { SUMMARY_STRINGS } from './strings.text'
import { unitLabel } from './strings.place'
import { witnessSummaryClause, type SummaryWitness } from './witness'

export interface SummaryInput {
  evidence: EvidenceModel
  /** Includes the preposition, e.g. "in Vietnam" or "at this grid cell". */
  placeLabel: string
  windowStart: string
  windowEnd: string
  quality?: QualitySummary | null
  /** Documented forcing-change period for this product, when the export defines one. */
  knownForcingPeriod?: readonly [number, number] | null
  /** Schema 1.3 second witness, when one was exported for this series. */
  witness?: SummaryWitness | null
  /** 95% Sen interval in the same per-decade unit as `senSlopeDecade`. */
  interval?: SenSlopeCI | null
  /** A4/P27 sentence for a non-significant trend; omitted when not evaluated. */
  detection?: string | null
  lang?: Lang
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

function windowYears(start: string, end: string, fallback: string): string {
  const startYear = start.slice(0, 4)
  const endYear = end.slice(0, 4)
  if (!startYear) return endYear || fallback
  if (!endYear || startYear === endYear) return startYear
  return `${startYear}–${endYear}`
}

function caution(
  quality: QualitySummary | null | undefined,
  product: string,
  knownForcingPeriod: readonly [number, number] | null | undefined,
  lang: Lang,
): string {
  if (!quality?.available || !quality.flagged) return ''
  const s = pick(SUMMARY_STRINGS, lang)
  if (isKnownForcingShift(quality, knownForcingPeriod)) {
    return s.cautionKnown(documentedInputChange(product, knownForcingPeriod, lang))
  }
  return s.cautionOther(quality.breakYear == null ? null : Math.round(quality.breakYear))
}

/**
 * One sentence for the top of the evidence view. Significant, not significant,
 * insufficient-data and quality-flagged cases have distinct, non-causal wording.
 */
export function summarySentence(input: SummaryInput): string {
  const { evidence, placeLabel, windowStart, windowEnd } = input
  const lang = input.lang ?? 'en'
  const s = pick(SUMMARY_STRINGS, lang)
  const range = windowYears(windowStart, windowEnd, s.selectedWindow)
  const variable = lowerFirst(evidence.variableLabel)
  const witnessTrail = witnessSummaryClause({
    mainTrendClass: evidence.trendClass,
    warm: evidence.category === 'temperature',
    qualityFlagged: Boolean(input.quality?.available && input.quality.flagged),
    witness: input.witness,
    lang,
  })
  const trail = witnessTrail ?? caution(input.quality, evidence.product, input.knownForcingPeriod, lang)
  const subject = `${variable} ${placeLabel}`

  if (evidence.trendClass === 'insufficient data') {
    return s.insufficient(range, subject)
  }
  if (
    evidence.trendClass === 'not available' ||
    evidence.trendClass === 'outside domain' ||
    evidence.senSlopeDecade == null
  ) {
    return s.noInfo(range, subject)
  }

  const magnitude = `${formatMagnitude(evidence.senSlopeDecade)} ${unitLabel(formatUnit(evidence.slopeUnit), lang)}`
  if (evidence.trendClass === 'not significant') {
    if (evidence.senSlopeDecade !== 0) {
      const warm = evidence.category === 'temperature'
      const verb = evidence.senSlopeDecade > 0 ? s.magnitudeUp(warm) : s.magnitudeDown(warm)
      const useQ = evidence.showQ && evidence.q != null
      const statLabel = useQ ? 'q' : 'p'
      const statValue = formatStat(useQ ? evidence.q : evidence.p)
      const pieces: string[] = []
      if (statValue != null) pieces.push(`${statLabel} = ${statValue}`)
      const intervalText = formatInterval(input.interval ?? null, lang)
      if (intervalText) pieces.push(s.intervalIncludesZero(intervalText))
      const parenthetical = pieces.length === 0 ? '' : ` (${pieces.join('; ')})`
      const tail = input.detection ?? s.defaultTail
      return s.notSignificantMoved(range, subject, verb, magnitude, parenthetical, tail)
    }
    return s.notSignificantFlat(range, subject)
  }
  if (evidence.trendClass !== 'increasing' && evidence.trendClass !== 'decreasing') {
    return s.noInfo(range, subject)
  }

  const warm = evidence.category === 'temperature'
  const verb = evidence.senSlopeDecade >= 0 ? s.magnitudeUp(warm) : s.magnitudeDown(warm)
  const useQ = evidence.showQ && evidence.q != null
  const statLabel = useQ ? 'q' : 'p'
  const statValue = formatStat(useQ ? evidence.q : evidence.p)
  const significance =
    statValue == null ? s.significancePlain : s.significanceWithStat(statLabel, statValue)
  return s.significant(range, subject, verb, magnitude, significance, trail)
}
