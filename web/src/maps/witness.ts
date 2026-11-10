// Pure helpers for the schema-1.3 second-witness layer (P15a).
import {
  INSUFFICIENT_DATA,
  N_COLS,
  OUTSIDE_DOMAIN,
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
} from '../data/contract'
import type { Rgba } from './gridImage'

export interface WitnessPalette {
  corroborated: Rgba
  sameSign: Rgba
  opposite: Rgba
  contradicted: Rgba
  neutral: Rgba
  insufficientA: Rgba
  insufficientB: Rgba
}

/** Teal/amber/magenta deliberately avoid the red/blue main-trend palette. */
export const WITNESS_PALETTE: WitnessPalette = {
  corroborated: [15, 118, 110, 255],
  sameSign: [94, 234, 212, 210],
  opposite: [245, 158, 11, 210],
  contradicted: [162, 28, 175, 255],
  neutral: [156, 163, 175, 190],
  insufficientA: [213, 216, 222, 255],
  insufficientB: [154, 163, 175, 255],
}

export function witnessColour(
  code: number,
  palette: WitnessPalette = WITNESS_PALETTE,
  index = 0,
  width = N_COLS,
): Rgba {
  if (code === WITNESS_CORROBORATED) return palette.corroborated
  if (code === WITNESS_SAME_SIGN) return palette.sameSign
  if (code === WITNESS_OPPOSITE_SIGN) return palette.opposite
  if (code === WITNESS_CONTRADICTED) return palette.contradicted
  if (code === WITNESS_MAIN_NOT_SIGNIFICANT) return palette.neutral
  if (code === INSUFFICIENT_DATA) {
    const row = Math.floor(index / width)
    const col = index % width
    return (row + col) % 2 === 0 ? palette.insufficientA : palette.insufficientB
  }
  return [0, 0, 0, 0]
}

export function witnessWords(code: number): string {
  if (code === WITNESS_CORROBORATED) return 'A second, independent NASA dataset agrees'
  if (code === WITNESS_SAME_SIGN) return 'Same direction, but not significant in the second dataset'
  if (code === WITNESS_OPPOSITE_SIGN) return 'Opposite direction, but not significant in the second dataset'
  if (code === WITNESS_CONTRADICTED) return 'An independent NASA dataset disagrees: read with caution'
  if (code === WITNESS_MAIN_NOT_SIGNIFICANT) return 'Main trend not significant'
  if (code === INSUFFICIENT_DATA) return 'Not evaluated (main or witness not eligible)'
  if (code === OUTSIDE_DOMAIN) return 'Outside domain'
  return `Unknown witness code (${code})`
}

/**
 * Contract §13 combined reading: a quality flag is a warning, not a verdict.
 * Returns null when there is no quality flag or no witness value.
 */
export function combinedQualityWitness(
  quality: number | null,
  witness: number | null,
  witnessLabel: string,
): string | null {
  if (quality == null || witness == null || quality < 1) return null
  if (witness === WITNESS_CORROBORATED) {
    return `Sudden shift, but ${witnessLabel} shows the same trend: more likely a real change`
  }
  if (witness === WITNESS_SAME_SIGN || witness === WITNESS_MAIN_NOT_SIGNIFICANT || witness === WITNESS_OPPOSITE_SIGN || witness === WITNESS_CONTRADICTED) {
    return `Sudden shift not seen in ${witnessLabel}: more likely a data artefact`
  }
  return null
}
