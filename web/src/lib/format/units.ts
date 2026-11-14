// Display-only unit formatting. The data files keep the raw contract units
// (`degC`, `kg m-2`, `g kg-1`); this module is the single place that turns them
// into symbols a student can read. Unknown units pass through unchanged.

import type { Lang } from '../../i18n'
import { UNIT_WORDS_VI } from './strings.vi'

const SUPERSCRIPT: Record<string, string> = { '1': '', '2': '²', '3': '³' }

/**
 * Format a display unit for humans. The rules are general, not a table of the
 * published units: `x-1`/`x-2`/`x-3` become `/x`, `/x²`, `/x³`, `Dobsons`
 * becomes `DU`, the dimensionless unit `1` becomes `fraction (0-1)`, and
 * `degC` becomes `°C`. Unknown strings pass through unchanged. English only: for a
 * Vietnamese page call formatUnitIn.
 *
 * The two `m-3` tokens are written `m3/m3` (a fraction), as specified in the
 * architect's unit rule; other negative exponents move to the denominator.
 */
export function formatUnit(unit: string): string {
  if (unit.length === 0) return unit
  if (unit.trim() === '1') return 'fraction (0-1)'

  let result = unit
    .replace(/\bdegC\b/g, '°C')
    .replace(/\bDobsons\b/g, 'DU')
    .replace(/\bm-3 m-3\b/g, 'm3/m3')

  result = result.replace(
    /(^|[\s(])([A-Za-z%]+)-([123])(?=$|[\s)])/g,
    (_match, prefix: string, base: string, exponent: string) =>
      `${prefix}/${base}${SUPERSCRIPT[exponent]}`,
  )
  result = result.replace(/\s+\//g, '/').replace(/\/\s+/g, '/')
  return result.startsWith('/') ? `1${result}` : result
}

/**
 * formatUnit in the chosen language. The words inside the unit ("fraction", "per decade")
 * become Vietnamese; symbols (°C, mm, kg/m², g/kg, hPa, DU) never change. Kept apart from
 * formatUnit so that `units.map(formatUnit)` stays valid.
 */
export function formatUnitIn(unit: string, lang: Lang): string {
  return localizeUnitWords(formatUnit(unit), lang)
}

/**
 * Translate the words of a display unit that is already through formatUnit: the rate words
 * ("per decade", "per year", "per month" at the end) and the dimensionless unit. Symbols stay.
 * English is returned unchanged.
 */
export function localizeUnitWords(unit: string, lang: Lang = 'vi'): string {
  if (lang === 'en') return unit
  const words = UNIT_WORDS_VI
  return unit
    .replace(/^fraction \(0-1\)/, words.fraction)
    .replace(/\bper decade$/, words.perDecade)
    .replace(/\bper year$/, words.perYear)
    .replace(/\bper month$/, words.perMonth)
}

/** Short source label shown after a variable name: GLDAS is a model, MERRA-2 a reanalysis. */
export function sourceLabel(sourceType: string): 'model' | 'satellite' | 'reanalysis' {
  if (sourceType === 'model') return 'model'
  if (sourceType === 'reanalysis') return 'reanalysis'
  return 'satellite'
}
