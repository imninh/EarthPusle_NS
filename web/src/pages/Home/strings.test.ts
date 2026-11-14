import { describe, expect, it } from 'vitest'
import { HOME_STRINGS, INSIGHT_STRINGS } from './strings'

function check(table: { en: Record<string, unknown>; vi: Record<string, unknown> }) {
  const keys = Object.keys(table.en)
  expect(Object.keys(table.vi).sort()).toEqual([...keys].sort())
  for (const key of keys) {
    const en = table.en[key]
    const vi = table.vi[key]
    expect(typeof vi).toBe(typeof en)
    if (typeof en === 'function') {
      for (const value of [en, vi] as ((...args: unknown[]) => unknown)[]) {
        const out = value('Label', 'B', 'C', 'D', 'E')
        expect(typeof out).toBe('string')
        expect((out as string).length).toBeGreaterThan(0)
      }
    } else {
      expect(typeof vi === 'string' && vi.length > 0).toBe(true)
      expect(typeof en === 'string' && en.length > 0).toBe(true)
    }
  }
}

describe('Home strings', () => {
  it('has every key in both languages', () => {
    check(HOME_STRINGS)
    check(INSIGHT_STRINGS)
  })
})
