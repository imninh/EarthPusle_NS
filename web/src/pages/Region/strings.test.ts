import { describe, expect, it } from 'vitest'
import type { Strings } from '../../i18n'
import {
  CASE_STRINGS,
  CHECK_STRINGS,
  HEADER_STRINGS,
  LOCATOR_STRINGS,
  PAGE_STRINGS,
  STRIP_STRINGS,
} from './strings'
import { PLACE_STRINGS, localizeDetail, localizeMessage, localizeTitle } from './strings.place'
import {
  DETECTION_STRINGS,
  MODEL_STRINGS,
  QUALITY_STRINGS,
  SUMMARY_STRINGS,
  WITNESS_STRINGS,
} from './strings.text'

const TABLES: Record<string, Strings<Record<string, unknown>>> = {
  PAGE_STRINGS,
  CASE_STRINGS,
  HEADER_STRINGS,
  STRIP_STRINGS,
  LOCATOR_STRINGS,
  CHECK_STRINGS,
  PLACE_STRINGS,
  SUMMARY_STRINGS,
  QUALITY_STRINGS,
  WITNESS_STRINGS,
  DETECTION_STRINGS,
  MODEL_STRINGS,
}

const SAMPLES: unknown[][] = [
  ['a', 'b', 'c', 'd', 'e', 'f'],
  [2010, 12, 3, 4, 5, 6],
  [true, null, null, null, null, null],
]

describe('Region string tables', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    it(`${name}: both languages have the same keys and types`, () => {
      expect(Object.keys(table.vi).sort()).toEqual(Object.keys(table.en).sort())
      for (const key of Object.keys(table.en)) {
        const en = table.en[key]
        const vi = table.vi[key]
        expect(typeof vi, `${name}.${key}`).toBe(typeof en)
        if (typeof en === 'string') {
          expect(en.length, `${name}.${key} en`).toBeGreaterThan(0)
          expect((vi as string).length, `${name}.${key} vi`).toBeGreaterThan(0)
        }
      }
    })

    it(`${name}: functions return non-empty text`, () => {
      for (const key of Object.keys(table.en)) {
        for (const lang of ['en', 'vi'] as const) {
          const value = table[lang][key]
          if (typeof value !== 'function') continue
          let result: unknown = ''
          for (const args of SAMPLES) {
            result = (value as (...a: unknown[]) => unknown)(...args)
            if (typeof result === 'string' && result.length > 0) break
          }
          expect(typeof result, `${name}.${key} ${lang}`).toBe('string')
          expect((result as string).length, `${name}.${key} ${lang}`).toBeGreaterThan(0)
        }
      }
    })
  }

  it('translates generated place text and leaves unknown text alone', () => {
    expect(localizeTitle('Cell row 4, column 7', 'vi')).toBe('Ô lưới hàng 4, cột 7')
    expect(localizeTitle('Vietnam', 'vi')).toBe('Vietnam')
    expect(localizeTitle('Cell row 4, column 7', 'en')).toBe('Cell row 4, column 7')
    expect(localizeDetail('10°N, 20°E. One grid cell.', 'vi')).toBe('10°N, 20°E. Một ô lưới.')
    expect(localizeMessage('Loading tiles… 2 of 5. Each tile is about 115 KB.', 'vi')).toContain('2 trên 5')
  })
})
