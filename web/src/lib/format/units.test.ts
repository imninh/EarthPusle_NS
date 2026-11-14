import { describe, expect, it } from 'vitest'
import { formatUnit } from './units'

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
    // A variable name or a longer word must not be damaged.
    expect(formatUnit('degreeCelsius')).toBe('degreeCelsius')
    expect(formatUnit('kg m-20')).toBe('kg m-20')
    expect(formatUnit('bg kg-1x')).toBe('bg kg-1x')
  })

  it('formats every unit in the published registry shape', () => {
    const registryUnits = ['degC', 'kg m-2', 'mm/month', 'g kg-1']
    expect(registryUnits.map(formatUnit)).toEqual(['°C', 'kg/m²', 'mm/month', 'g/kg'])
    const slopeUnits = registryUnits.map((unit) => `${unit} per year`)
    expect(slopeUnits.map(formatUnit)).toEqual(['°C per year', 'kg/m² per year', 'mm/month per year', 'g/kg per year'])
  })
})
