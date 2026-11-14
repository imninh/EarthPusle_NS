import { describe, expect, it } from 'vitest'
import { DISCOVERY_STRINGS, increaseMeansLabel } from './strings'
import { VERDICT_TEXTS, verdictClassWords, verdictWords } from '../../maps/verdict'
import { WITNESS_TEXTS, combinedQualityWitness, witnessWords } from '../../maps/witness'
import { WITNESS_CONTRADICTED, WITNESS_CORROBORATED } from '../../data/contract'

function compare(en: unknown, vi: unknown, path: string): void {
  expect(typeof vi, path).toBe(typeof en)
  if (typeof en === 'string') {
    expect(en.length, path).toBeGreaterThan(0)
    expect((vi as string).length, path).toBeGreaterThan(0)
  } else if (typeof en === 'function') {
    const sample = (fn: unknown) => (fn as (...args: string[]) => string)('1', '2', '3', '4')
    expect(sample(en).length, `${path} (en)`).toBeGreaterThan(0)
    expect(sample(vi).length, `${path} (vi)`).toBeGreaterThan(0)
  } else if (typeof en === 'object' && en !== null) {
    expect(Object.keys(vi as object).sort(), path).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en)) {
      compare((en as Record<string, unknown>)[key], (vi as Record<string, unknown>)[key], `${path}.${key}`)
    }
  }
}

describe('Discovery strings', () => {
  it('has every key in both languages with the same type and a non-empty value', () => {
    compare(DISCOVERY_STRINGS.en, DISCOVERY_STRINGS.vi, 'discovery')
  })

  it('keeps the map word tables in step in both languages', () => {
    compare(VERDICT_TEXTS.en, VERDICT_TEXTS.vi, 'verdict')
    compare(WITNESS_TEXTS.en, WITNESS_TEXTS.vi, 'witness')
  })

  it('keeps English by default and switches generated sentences with the language', () => {
    expect(DISCOVERY_STRINGS.en.layers.verdict).toBe('Verdict')
    expect(DISCOVERY_STRINGS.vi.layers.verdict).toBe('Phán quyết')
    expect(verdictClassWords(1)).toBe(verdictWords().clean)
    expect(verdictClassWords(1, 'vi')).toBe(verdictWords('vi').clean)
    expect(verdictClassWords(1, 'vi')).not.toBe(verdictClassWords(1))
    expect(witnessWords(WITNESS_CORROBORATED)).toContain('agrees')
    expect(witnessWords(WITNESS_CORROBORATED, 'vi')).toContain('bộ dữ liệu NASA thứ hai')
    expect(combinedQualityWitness(2, WITNESS_CONTRADICTED, 'MERRA-2', 'vi')).toContain('MERRA-2')
    expect(increaseMeansLabel('warmer', 'en')).toBe('warmer')
    expect(increaseMeansLabel('warmer', 'vi')).toBe('ấm lên')
  })
})
