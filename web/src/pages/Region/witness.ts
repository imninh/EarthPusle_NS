// Schema 1.3 second-witness helpers (docs/DATA_CONTRACT.md §13).
// The witness is corroboration, not ground truth: comparisons use direction and
// significance, and charts use standardized anomalies rather than raw units.
import {
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
} from '../../data/contract'
import type { DataIndex } from '../../data/types'
import { senSlope, type SenSlopeCI } from '../../lib/stats'
import { browserTrendClass, countValid, monthsSince, normalizeValue, regionTest } from './model'

export interface WitnessTrend {
  slopeDecade: number | null
  /** 95% rank-based Sen interval in the per-decade unit; null when it cannot be computed. */
  slopeDecadeCI: SenSlopeCI | null
  p: number | null
  tau: number | null
  validMonths: number
  monthsInWindow: number
  trendClass: string
}

export interface WitnessInfo {
  label: string
  product: string
  version: string
  doi: string | null
  unit: string | null
  /** Aligned to index.months. */
  anomalies: (number | null)[]
  trend: WitnessTrend | null
  /** witness_agreement code (§13). */
  agreement: number
}

export interface SummaryWitness {
  label: string
  agreement: number
}

export interface WitnessProductInfo {
  label: string
  product: string
  version: string
  doi: string | null
}

/** Browser Sen + original MK on the witness anomalies, same window as the main test. */
export function witnessTrendFromSeries(
  months: readonly string[],
  values: readonly (number | null)[],
  windowStart: string,
  windowEnd: string,
): WitnessTrend {
  const windowMonths: string[] = []
  const windowValues: (number | null)[] = []
  for (let i = 0; i < months.length; i++) {
    const month = months[i]
    if (month < windowStart || month > windowEnd) continue
    windowMonths.push(month)
    windowValues.push(normalizeValue(values[i]))
  }
  const origin = windowMonths[0] ?? windowStart
  const t = windowMonths.map((month) => monthsSince(origin, month) / 12)
  const numeric = windowValues.map((value) => (value == null ? Number.NaN : value))
  const fit = windowMonths.length > 0 ? senSlope(t, numeric) : null
  const test = windowMonths.length > 0 ? regionTest(t, numeric) : { p: null, tau: null, ci: null }
  const ci = test.ci
  const validMonths = countValid(windowValues)
  return {
    slopeDecade: fit ? fit.slope * 10 : null,
    slopeDecadeCI: ci ? { lower: ci.lower * 10, upper: ci.upper * 10 } : null,
    p: test.p,
    tau: test.tau,
    validMonths,
    monthsInWindow: windowMonths.length,
    trendClass: browserTrendClass(test.p, fit ? fit.slope : null, validMonths, windowMonths.length),
  }
}

function direction(trendClass: string, slope: number | null): 1 | -1 | 0 {
  if (trendClass === 'increasing') return 1
  if (trendClass === 'decreasing') return -1
  if (slope == null || !Number.isFinite(slope) || slope === 0) return 0
  return slope > 0 ? 1 : -1
}

function isSignificant(trendClass: string): boolean {
  return trendClass === 'increasing' || trendClass === 'decreasing'
}

/** Map a main trend class and a witness trend to the §13 agreement code. */
export function witnessAgreementCode(
  mainTrendClass: string,
  witness: WitnessTrend | null | undefined,
): number {
  if (!witness || witness.trendClass === 'insufficient data') return -9
  const mainDirection = direction(mainTrendClass, null)
  if (mainDirection === 0) return 0
  const witnessDirection = direction(witness.trendClass, witness.slopeDecade)
  if (witnessDirection === 0) return -9
  const witnessSignificant = isSignificant(witness.trendClass)
  if (mainDirection === witnessDirection) {
    return witnessSignificant ? WITNESS_CORROBORATED : WITNESS_SAME_SIGN
  }
  return witnessSignificant ? WITNESS_CONTRADICTED : WITNESS_OPPOSITE_SIGN
}

export function witnessAgreementText(code: number): string {
  if (code === WITNESS_CORROBORATED) return 'agrees: both trends are significant and point the same way'
  if (code === WITNESS_SAME_SIGN) return 'same direction, but the trend in the second dataset is not significant'
  if (code === WITNESS_OPPOSITE_SIGN) return 'opposite direction, but the trend in the second dataset is not significant'
  if (code === WITNESS_CONTRADICTED) return 'disagrees: both trends are significant and point opposite ways'
  if (code === 0) return 'not applicable: the main trend is not significant'
  return 'not evaluated'
}

/** Look up the witness product label/DOI for a variable from index.json. */
export function witnessProductInfo(index: DataIndex, variableId: string): WitnessProductInfo | null {
  const product = index.witness?.products[variableId]
  if (!product) return null
  const label = product.label.trim() || `${product.product} ${product.version}`.trim()
  return {
    label,
    product: product.product,
    version: product.version,
    doi: product.doi || null,
  }
}

/**
 * Clause appended to the plain-language summary. Quality-flagged trends use the
 * combined §13 reading; otherwise the witness adds a short corroboration sentence.
 */
export function witnessSummaryClause(args: {
  mainTrendClass: string
  warm: boolean
  qualityFlagged: boolean
  witness: SummaryWitness | null | undefined
}): string | null {
  const { mainTrendClass, warm, qualityFlagged, witness } = args
  if (!witness || witness.agreement === 0 || witness.agreement === -9) return null
  if (mainTrendClass !== 'increasing' && mainTrendClass !== 'decreasing') return null
  const label = witness.label.trim() || 'an independent dataset'
  if (qualityFlagged) {
    if (witness.agreement === WITNESS_CORROBORATED) {
      return `; a sudden shift, but ${label} shows the same trend: more likely a real change`
    }
    return `; a sudden shift not seen in ${label}: more likely a data artefact`
  }
  if (witness.agreement === WITNESS_CORROBORATED) {
    return `; ${label} shows the same ${warm ? 'warming' : 'trend'}`
  }
  if (witness.agreement === WITNESS_CONTRADICTED) {
    return `; ${label} shows the opposite trend: read with caution`
  }
  if (witness.agreement === WITNESS_SAME_SIGN) {
    return `; ${label} shows the same direction, but its trend is not significant`
  }
  return `; ${label} shows the opposite direction, but its trend is not significant`
}
