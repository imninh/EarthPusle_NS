import { describe, expect, it } from 'vitest'
import { LAYER_IDS, isLayerId, resolveLayer } from './layers'

const base = { choice: null, verdictByDefault: true, loaded: true, hasQuality: true, hasWitness: true } as const

describe('resolveLayer', () => {
  it('defaults to verdict when quality and witness exist', () => {
    expect(resolveLayer(base)).toBe('verdict')
  })

  it('keeps the old default (trend) otherwise', () => {
    expect(resolveLayer({ ...base, verdictByDefault: false })).toBe('trend')
  })

  it('honours the URL or user choice', () => {
    expect(resolveLayer({ ...base, choice: 'rate' })).toBe('rate')
    expect(resolveLayer({ ...base, choice: 'witness' })).toBe('witness')
  })

  it('falls back to trend when a chosen layer has no data', () => {
    expect(resolveLayer({ ...base, choice: 'witness', hasWitness: false })).toBe('trend')
    expect(resolveLayer({ ...base, choice: 'quality', hasQuality: false })).toBe('trend')
    expect(resolveLayer({ ...base, hasQuality: false, hasWitness: false })).toBe('trend')
  })

  it('verdict still works with only one of the two layers when it was asked for', () => {
    expect(resolveLayer({ ...base, choice: 'verdict', hasWitness: false })).toBe('verdict')
    expect(resolveLayer({ ...base, choice: 'verdict', hasQuality: false })).toBe('verdict')
  })

  it('does not make verdict the default when only one layer is present', () => {
    expect(resolveLayer({ ...base, hasQuality: false })).toBe('trend')
    expect(resolveLayer({ ...base, hasWitness: false })).toBe('trend')
  })

  it('does not fall back while grids are loading', () => {
    expect(resolveLayer({ ...base, loaded: false, hasQuality: false, hasWitness: false })).toBe('verdict')
  })

  it('knows every layer id, including all ids that worked before verdict was added', () => {
    for (const id of LAYER_IDS) expect(isLayerId(id)).toBe(true)
    for (const id of ['trend', 'rate', 'std', 'significance', 'pattern', 'coverage', 'quality', 'witness'] as const) {
      expect(isLayerId(id)).toBe(true)
      expect(resolveLayer({ ...base, choice: id })).toBe(id)
    }
    expect(isLayerId('nope')).toBe(false)
    expect(isLayerId(null)).toBe(false)
  })
})
