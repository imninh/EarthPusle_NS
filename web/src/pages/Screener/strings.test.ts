import { describe, expect, it } from 'vitest'
import { INCREASE_MEANS_VI, SCREENER_STRINGS, VARIABLE_DESCRIPTION_VI } from './strings'
import { VARIABLE_VI } from '../../i18n/terms'
import { contrastLabel, screenerHeadline, sortDescription } from './metrics'

function compare(en: unknown, vi: unknown, path: string): void {
  expect(typeof vi, path).toBe(typeof en)
  if (typeof en === 'string') {
    expect(en.length, path).toBeGreaterThan(0)
    expect((vi as string).length, path).toBeGreaterThan(0)
  } else if (typeof en === 'object' && en !== null) {
    expect(Object.keys(vi as object).sort(), path).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en)) compare((en as Record<string, unknown>)[key], (vi as Record<string, unknown>)[key], `${path}.${key}`)
  }
}

describe('Screener strings', () => {
  it('has every key in both languages with the same type and a non-empty value', () => {
    compare(SCREENER_STRINGS.en, SCREENER_STRINGS.vi, 'screener')
  })

  it('covers every published variable description in Vietnamese', () => {
    expect(Object.keys(VARIABLE_DESCRIPTION_VI).sort()).toEqual(Object.keys(VARIABLE_VI).sort())
    expect(Object.keys(INCREASE_MEANS_VI).length).toBeGreaterThan(0)
  })

  it('keeps English by default and switches generated sentences with the language', () => {
    expect(contrastLabel(0)).toBe('one direction')
    expect(contrastLabel(0, 'vi')).toBe('một hướng')
    expect(sortDescription('coverage', 'asc')).toBe('Sorted by coverage, smallest first.')
    expect(sortDescription('coverage', 'asc', 'vi')).toBe('Đang sắp xếp theo độ phủ dữ liệu, nhỏ nhất trước.')
    expect(screenerHeadline([], 'Mekong', undefined, 'vi')).toContain('Mekong')
  })
})
