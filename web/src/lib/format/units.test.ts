import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatUnit } from './units'

const catalogPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../config/catalog.yaml',
)

describe('formatUnit', () => {
  it('maps the three contract units exactly', () => {
    expect(formatUnit('degC')).toBe('°C')
    expect(formatUnit('kg m-2')).toBe('kg/m²')
    expect(formatUnit('g kg-1')).toBe('g/kg')
  })

  it('leaves an already readable unit unchanged', () => {
    expect(formatUnit('mm/month')).toBe('mm/month')
  })

  it('maps a unit inside a compound string', () => {
    expect(formatUnit('degC per decade')).toBe('°C per decade')
    expect(formatUnit('kg m-2 per decade')).toBe('kg/m² per decade')
    expect(formatUnit('g kg-1 per decade')).toBe('g/kg per decade')
    expect(formatUnit('mm/month per year')).toBe('mm/month per year')
  })

  it('handles a compound unit that repeats', () => {
    expect(formatUnit('degC per year (degC per decade)')).toBe('°C per year (°C per decade)')
  })

  it('does not rewrite a symbol twice', () => {
    expect(formatUnit('°C per decade')).toBe('°C per decade')
    expect(formatUnit('kg/m²')).toBe('kg/m²')
    expect(formatUnit('g/kg')).toBe('g/kg')
  })

  it('passes an unknown unit through unchanged', () => {
    expect(formatUnit('m/s')).toBe('m/s')
    expect(formatUnit('fraction')).toBe('fraction')
    expect(formatUnit('')).toBe('')
  })

  it('only replaces whole unit tokens', () => {
    expect(formatUnit('degreeCelsius')).toBe('degreeCelsius')
    expect(formatUnit('kg m-20')).toBe('kg m-20')
    expect(formatUnit('bg kg-1x')).toBe('bg kg-1x')
  })

  it('formats every unit string in config/catalog.yaml', () => {
    const catalog = readFileSync(catalogPath, 'utf8')
    const units = [...catalog.matchAll(/^[ \t]*units:[ \t]*(.+)$/gm)].map((match) =>
      match[1].trim().replace(/^['"]|['"]$/g, ''),
    )
    expect(new Set(units).size).toBeGreaterThan(0)
    const expected: Record<string, string> = {
      '%': '%',
      '1': 'fraction (0-1)',
      Dobsons: 'DU',
      'J m-2': 'J/m²',
      K: 'K',
      Pa: 'Pa',
      'Pa s-1': 'Pa/s',
      'W m-2': 'W/m²',
      'kg kg-1': 'kg/kg',
      'kg m-2': 'kg/m²',
      'kg m-2 s-1': 'kg/m²/s',
      m: 'm',
      'm s-1': 'm/s',
      'm-3 m-3': 'm3/m3',
      // Some source rows in the current catalog repeat the unit string; the
      // formatter must handle each whole string as written.
      '1 1': '1 1',
      'Dobsons Dobsons': 'DU DU',
      'J m-2 J m-2': 'J/m² J/m²',
      'K K': 'K K',
      'Pa Pa': 'Pa Pa',
      'Pa s-1 Pa s-1': 'Pa/s Pa/s',
      'W m-2 W m-2': 'W/m² W/m²',
      'kg kg-1 kg kg-1': 'kg/kg kg/kg',
      'kg m-2 kg m-2': 'kg/m² kg/m²',
      'kg m-2 s-1 kg m-2 s-1': 'kg/m²/s kg/m²/s',
      'm m': 'm m',
      'm s-1 m s-1': 'm/s m/s',
      'm-3 m-3 m-3 m-3': 'm3/m3 m3/m3',
    }
    for (const unit of units) {
      expect(expected[unit], `missing expectation for ${unit}`).toBeDefined()
      expect(formatUnit(unit), unit).toBe(expected[unit])
    }
  })
})
