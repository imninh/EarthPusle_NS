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
import type { Lang } from '../../i18n'
import { STRONG_EVIDENCE_VI, VERDICT_DIRECTION_VI, VERDICT_LABELS_VI } from './strings.vi'

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

/** Which of the six verdicts this is, whatever the language of the label. */
export type VerdictKind = 'strongIncrease' | 'strongDecrease' | 'caution' | 'notYet' | 'noClear' | 'notEnough'

/** The verdict's language-independent id and tone. Code that decides a colour reads this, never the label. */
export function classifyVerdict(input: VerdictInput): { kind: VerdictKind; tone: VerdictTone } {
  const { trendClass } = input
  if (trendClass === INSUFFICIENT_DATA || trendClass === OUTSIDE_DOMAIN) {
    return { kind: 'notEnough', tone: 'default' }
  }
  if (isSignificant(trendClass) && cautionRequested(input)) {
    return { kind: 'caution', tone: 'warn' }
  }
  if (trendClass === TREND_INCREASE) return { kind: 'strongIncrease', tone: 'accent' }
  if (trendClass === TREND_DECREASE) return { kind: 'strongDecrease', tone: 'accent' }
  if (trendClass === TREND_NOT_SIGNIFICANT) {
    if (input.slope != null && Number.isFinite(input.slope) && input.slope === 0) {
      return { kind: 'noClear', tone: 'default' }
    }
    return { kind: 'notYet', tone: 'default' }
  }
  return { kind: 'notEnough', tone: 'default' }
}

/** The label of a verdict kind in the chosen language. */
export function verdictLabel(kind: VerdictKind, increaseMeans: string | null | undefined, lang: Lang = 'en'): string {
  if (lang === 'vi') {
    switch (kind) {
      case 'strongIncrease':
      case 'strongDecrease': {
        const known = VERDICT_DIRECTION_VI[(increaseMeans ?? '').trim().toLowerCase()]
        const word = known
          ? kind === 'strongDecrease'
            ? known.down
            : known.up
          : kind === 'strongDecrease'
            ? 'giảm'
            : 'tăng'
        return `${capitalise(word)}, ${STRONG_EVIDENCE_VI}`
      }
      case 'caution':
        return VERDICT_LABELS_VI.caution
      case 'notYet':
        return VERDICT_LABELS_VI.notYet
      case 'noClear':
        return VERDICT_LABELS_VI.noClear
      default:
        return VERDICT_LABELS_VI.notEnough
    }
  }
  switch (kind) {
    case 'strongIncrease':
      return `${capitalise(increaseMeans?.trim() || 'rising')}, strong evidence`
    case 'strongDecrease':
      return VERDICT_LABELS.falling
    case 'caution':
      return VERDICT_LABELS.caution
    case 'notYet':
      return VERDICT_LABELS.notYet
    case 'noClear':
      return VERDICT_LABELS.noClear
    default:
      return VERDICT_LABELS.notEnough
  }
}

/**
 * Recognise the kind of a label in either language. For code that only holds a label
 * (a stamp tone); code that has the input should call classifyVerdict instead.
 */
export function verdictKindOfLabel(label: string): VerdictKind {
  if (label === VERDICT_LABELS.caution || label === VERDICT_LABELS_VI.caution) return 'caution'
  if (label === VERDICT_LABELS.notYet || label === VERDICT_LABELS_VI.notYet) return 'notYet'
  if (label === VERDICT_LABELS.noClear || label === VERDICT_LABELS_VI.noClear) return 'noClear'
  if (label === VERDICT_LABELS.notEnough || label === VERDICT_LABELS_VI.notEnough) return 'notEnough'
  if (label === VERDICT_LABELS.falling) return 'strongDecrease'
  return 'strongIncrease'
}

/**
 * The five verdict labels in plain words.
 *
 * A significant trend is "Read with caution" when a sudden shift is flagged or
 * the second witness disagrees; otherwise it names the direction using the
 * variable's own `increase_means` ("Warmer", "Wetter"). A non-significant trend
 * with a visible direction becomes "A direction, not yet significant", never
 * "no change". `lang` only changes the words; the kind and tone are the same.
 */
export function plainVerdict(input: VerdictInput, lang: Lang = 'en'): PlainVerdict {
  const { kind, tone } = classifyVerdict(input)
  return { label: verdictLabel(kind, input.increaseMeans, lang), tone }
}
