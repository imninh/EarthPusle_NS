// Display-only unit formatting. The data files keep the raw contract units
// (`degC`, `kg m-2`, `g kg-1`); this module is the single place that turns them
// into symbols a student can read. Unknown units pass through unchanged.

/** Exact replacements, applied inside compound strings such as "degC per decade". */
const UNIT_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  // Longer, space-separated units first so a partial token is never rewritten.
  [/\bg kg-1\b/g, 'g/kg'],
  [/\bkg m-2\b/g, 'kg/m²'],
  [/\bdegC\b/g, '°C'],
]

/**
 * Format a display unit for humans.
 *
 * - `degC` → `°C`
 * - `kg m-2` → `kg/m²`
 * - `g kg-1` → `g/kg`
 * - `mm/month` is already readable and stays unchanged
 *
 * The same mapping applies inside compound strings (`degC per decade`).
 * Anything the map does not know is returned exactly as received.
 */
export function formatUnit(unit: string): string {
  if (unit.length === 0) return unit
  let result = unit
  for (const [pattern, replacement] of UNIT_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/** Short source label shown after a variable name: GLDAS is a model, MERRA-2 a reanalysis. */
export function sourceLabel(sourceType: string): 'model' | 'satellite' | 'reanalysis' {
  if (sourceType === 'model') return 'model'
  if (sourceType === 'reanalysis') return 'reanalysis'
  return 'satellite'
}
