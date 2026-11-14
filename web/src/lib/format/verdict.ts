// One shared verdict vocabulary so Home, Screener, Region, Discovery and the
// Investigate flow never disagree. Five fixed labels, each with a Chip tone.
import {
  INSUFFICIENT_DATA,
  OUTSIDE_DOMAIN,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
  WITNESS_CONTRADICTED,
  WITNESS_OPPOSITE_SIGN,
} from '../../data/contract'

/** Matches Chip's public tones so a caller can pass the value straight through. */
export type VerdictTone = 'accent' | 'warn' | 'default'

export interface VerdictInput {
  /** Contract trend class: 1 increase, -1 decrease, 0 not significant, -9 insufficient, -99 outside. */
  trendClass: number
  /** A sudden-shift or quality flag is present (contract §12). */
  flagged?: boolean
  /** Contract §13 witness agreement: -1 and -2 are the caution codes. */
  witnessCode?: number | null
  /** Registry `increase_means`, e.g. "warmer" or "wetter". */
  increaseMeans?: string | null
  /**
   * Optional sign of the rate of change. `0` (or a non-finite value) separates
   * "No clear trend" from "A direction, not yet significant"; omitting it never
   * claims that a direction is absent.
   */
  slope?: number | null
}

export interface PlainVerdict {
  label: string
  tone: VerdictTone
}

export const VERDICT_LABELS = {
  rising: 'Rising, strong evidence',
  falling: 'Falling, strong evidence',
  notYet: 'A direction, not yet significant',
  noClear: 'No clear trend',
  caution: 'Read with caution',
  notEnough: 'Not enough data',
} as const

function capitalise(value: string): string {
  if (value.length === 0) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isSignificant(trendClass: number): boolean {
  return trendClass === TREND_INCREASE || trendClass === TREND_DECREASE
}

function cautionRequested(input: VerdictInput): boolean {
  if (input.witnessCode === WITNESS_OPPOSITE_SIGN || input.witnessCode === WITNESS_CONTRADICTED) return true
  return input.flagged === true
}

/**
 * The five verdict labels in plain words.
 *
 * A significant trend is "Read with caution" when a sudden shift is flagged or
 * the second witness disagrees; otherwise it names the direction using the
 * variable's own `increase_means` ("Warmer", "Wetter"). A non-significant trend
 * with a visible direction becomes "A direction, not yet significant", never
 * "no change".
 */
export function plainVerdict(input: VerdictInput): PlainVerdict {
  const { trendClass } = input
  if (trendClass === INSUFFICIENT_DATA || trendClass === OUTSIDE_DOMAIN) {
    return { label: VERDICT_LABELS.notEnough, tone: 'default' }
  }
  if (isSignificant(trendClass) && cautionRequested(input)) {
    return { label: VERDICT_LABELS.caution, tone: 'warn' }
  }
  if (trendClass === TREND_INCREASE) {
    const direction = capitalise(input.increaseMeans?.trim() || 'rising')
    return { label: `${direction}, strong evidence`, tone: 'accent' }
  }
  if (trendClass === TREND_DECREASE) {
    return { label: VERDICT_LABELS.falling, tone: 'accent' }
  }
  if (trendClass === TREND_NOT_SIGNIFICANT) {
    if (input.slope != null && Number.isFinite(input.slope) && input.slope === 0) {
      return { label: VERDICT_LABELS.noClear, tone: 'default' }
    }
    return { label: VERDICT_LABELS.notYet, tone: 'default' }
  }
  return { label: VERDICT_LABELS.notEnough, tone: 'default' }
}
