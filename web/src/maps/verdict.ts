// The "Verdict" layer (task V5): one map that shows the whole idea. It is derived in the
// browser from layers already loaded for a variable and window (trend class, quality flag,
// witness agreement). No new file, no new statistic.
import {
  INSUFFICIENT_DATA,
  N_COLS,
  N_ROWS,
  OUTSIDE_DOMAIN,
  QUALITY_STEP,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
  WITNESS_CONTRADICTED,
  cellAreaWeight,
} from '../data/contract'
import type { ClassPalette, Rgba } from './gridImage'

/** Significant, no sudden-shift flag, and no second dataset contradicts it. */
export const VERDICT_CLEAN = 1
/** Significant, but flagged for a sudden shift (quality_flag >= 1, contract §12). */
export const VERDICT_FLAGGED = 2
/** Significant here, contradicted by the second dataset (witness_agreement = -2, contract §13). Wins over B. */
export const VERDICT_CONTRADICTED = 3
/** A direction, not yet significant. */
export const VERDICT_NOT_YET = 4

export type VerdictClass =
  | typeof VERDICT_CLEAN
  | typeof VERDICT_FLAGGED
  | typeof VERDICT_CONTRADICTED
  | typeof VERDICT_NOT_YET
  | typeof INSUFFICIENT_DATA
  | typeof OUTSIDE_DOMAIN

/** Marker yellow (--marker), caution only. */
export const VERDICT_MARKER: Rgba = [242, 194, 48, 255]
/** Stripe over the contradicted class: distinguishable without colour. */
export const VERDICT_STRIPE: Rgba = [255, 255, 255, 235]

/**
 * Class of one cell. `quality` and `witness` are the raw codes, or null when that layer is
 * missing for the variable (a missing layer never flags and never contradicts).
 *
 * Contract §13: only code -2 is "witness significant, opposite direction (contradicted)".
 * Codes 1 and -1 mean same/opposite direction but not significant in the second dataset,
 * so they are not contradictions and stay in class A.
 */
export function verdictClass(trend: number, quality: number | null, witness: number | null): VerdictClass {
  if (trend === INSUFFICIENT_DATA) return INSUFFICIENT_DATA
  if (trend === TREND_NOT_SIGNIFICANT) return VERDICT_NOT_YET
  if (trend !== TREND_INCREASE && trend !== TREND_DECREASE) return OUTSIDE_DOMAIN
  if (witness === WITNESS_CONTRADICTED) return VERDICT_CONTRADICTED
  if (quality != null && quality >= QUALITY_STEP) return VERDICT_FLAGGED
  return VERDICT_CLEAN
}

/** The class grid for a whole variable x window. Same length as `trend`. */
export function verdictGrid(
  trend: ArrayLike<number>,
  quality: ArrayLike<number> | null,
  witness: ArrayLike<number> | null,
): Int8Array {
  const out = new Int8Array(trend.length)
  for (let index = 0; index < trend.length; index++) {
    out[index] = verdictClass(trend[index], quality ? quality[index] : null, witness ? witness[index] : null)
  }
  return out
}

/** Warm for an increase, cool for a decrease (the direction colour of the main trend). */
function directionColour(trend: number, palette: Pick<ClassPalette, 'increase' | 'decrease'>): Rgba {
  return trend === TREND_DECREASE ? palette.decrease : palette.increase
}

export function verdictColour(
  code: number,
  trend: number,
  palette: ClassPalette,
  index: number,
  width: number = N_COLS,
): Rgba {
  if (code === VERDICT_CLEAN || code === VERDICT_CONTRADICTED) return directionColour(trend, palette)
  if (code === VERDICT_FLAGGED) return VERDICT_MARKER
  if (code === VERDICT_NOT_YET) return [palette.neutral[0], palette.neutral[1], palette.neutral[2], 120]
  if (code === INSUFFICIENT_DATA) {
    const row = Math.floor(index / width)
    const col = index % width
    const colour = (row + col) % 2 === 0 ? palette.insufficientA : palette.insufficientB
    return [colour[0], colour[1], colour[2], 220]
  }
  return [0, 0, 0, 0]
}

/**
 * Diagonal stripes over every cell of class C, drawn in canvas pixels so the pattern stays
 * legible at every zoom. Added here, not in renderGrid.ts, so the existing renderers stay as is.
 */
export function applyContradictedStripes(
  image: ImageData,
  classes: ArrayLike<number>,
  pixelsPerDegree: number,
): ImageData {
  if (classes.length !== N_ROWS * N_COLS) {
    throw new Error(`applyContradictedStripes: expected ${N_ROWS * N_COLS} values, got ${classes.length}`)
  }
  const period = Math.max(4, Math.round(pixelsPerDegree / 2))
  const width = Math.max(1, Math.round(period / 2))
  const [red, green, blue, alpha] = VERDICT_STRIPE
  for (let row = 0; row < N_ROWS; row++) {
    for (let col = 0; col < N_COLS; col++) {
      if (classes[row * N_COLS + col] !== VERDICT_CONTRADICTED) continue
      for (let y = row * pixelsPerDegree; y < (row + 1) * pixelsPerDegree; y++) {
        for (let x = col * pixelsPerDegree; x < (col + 1) * pixelsPerDegree; x++) {
          if ((x + y) % period >= width) continue
          const offset = (y * image.width + x) * 4
          if (image.data[offset + 3] === 0) continue
          image.data[offset] = red
          image.data[offset + 1] = green
          image.data[offset + 2] = blue
          image.data[offset + 3] = Math.max(image.data[offset + 3], alpha)
        }
      }
    }
  }
  return image
}

export interface VerdictShares {
  /** Area-weighted (cos latitude) share of each class among evaluated cells (classes A to D). */
  evaluated: Record<'clean' | 'flagged' | 'contradicted' | 'notYet', number>
  /** Area-weighted share of A, B and C among significant cells only. */
  significant: Record<'clean' | 'flagged' | 'contradicted', number>
  evaluatedArea: number
  significantArea: number
}

/** Area shares per class, for reporting and for the screener cross-check. */
export function verdictShares(classes: ArrayLike<number>): VerdictShares {
  const area = { a: 0, b: 0, c: 0, d: 0 }
  for (let row = 0; row < N_ROWS; row++) {
    const weight = cellAreaWeight(row)
    for (let col = 0; col < N_COLS; col++) {
      const code = classes[row * N_COLS + col]
      if (code === VERDICT_CLEAN) area.a += weight
      else if (code === VERDICT_FLAGGED) area.b += weight
      else if (code === VERDICT_CONTRADICTED) area.c += weight
      else if (code === VERDICT_NOT_YET) area.d += weight
    }
  }
  const significantArea = area.a + area.b + area.c
  const evaluatedArea = significantArea + area.d
  const share = (value: number, total: number) => (total > 0 ? value / total : Number.NaN)
  return {
    evaluated: {
      clean: share(area.a, evaluatedArea),
      flagged: share(area.b, evaluatedArea),
      contradicted: share(area.c, evaluatedArea),
      notYet: share(area.d, evaluatedArea),
    },
    significant: {
      clean: share(area.a, significantArea),
      flagged: share(area.b, significantArea),
      contradicted: share(area.c, significantArea),
    },
    evaluatedArea,
    significantArea,
  }
}

export const VERDICT_WORDS: Record<'clean' | 'flagged' | 'contradicted' | 'notYet', string> = {
  clean: 'A real trend: significant, no sudden shift, and no second dataset contradicts it',
  flagged: 'Significant, but a sudden shift is flagged: read with caution',
  contradicted: 'Significant here, but an independent dataset disagrees (striped)',
  notYet: 'A direction, not yet significant',
}

/** Plain words for the hover tooltip and the cell panel. */
export function verdictClassWords(code: number): string {
  if (code === VERDICT_CLEAN) return VERDICT_WORDS.clean
  if (code === VERDICT_FLAGGED) return VERDICT_WORDS.flagged
  if (code === VERDICT_CONTRADICTED) return VERDICT_WORDS.contradicted
  if (code === VERDICT_NOT_YET) return VERDICT_WORDS.notYet
  if (code === INSUFFICIENT_DATA) return 'Not enough data'
  return 'Outside domain'
}
