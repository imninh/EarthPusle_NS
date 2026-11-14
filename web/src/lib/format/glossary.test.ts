import { describe, expect, it } from 'vitest'
import { GLOSSARY, GLOSSARY_ORDER, glossaryEntry, type TermId } from './glossary'

const REQUIRED: TermId[] = [
  'significant',
  'trend',
  'rate_of_change',
  'anomaly',
  'q_value',
  'coverage',
  'sudden_shift',
  'second_witness',
  'confidence_interval',
  'not_yet_significant',
  'standardized_change',
  'data_quality',
  'kendall_tau',
  'years_to_detect',
  'screened_only',
]

/** Count sentence ends, ignoring decimals such as 0.05 and abbreviations. */
function sentenceCount(text: string): number {
  return text
    .replace(/\b(e\.g|i\.e)\./gi, '')
    .split(/[.!?](?:\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean).length
}

describe('GLOSSARY', () => {
  it('has every term the wave-4 pages ask for', () => {
    for (const id of REQUIRED) expect(GLOSSARY[id], id).toBeDefined()
  })

  it('gives every entry a label, one plain sentence and a technical name', () => {
    for (const [id, entry] of Object.entries(GLOSSARY)) {
      expect(entry.term.length, id).toBeGreaterThan(0)
      expect(entry.plain.length, id).toBeGreaterThan(0)
      expect(entry.technical.length, id).toBeGreaterThan(0)
      expect(sentenceCount(entry.plain), `${id} plain must be one sentence`).toBe(1)
      expect(entry.plain.trim().endsWith('.'), `${id} plain must end with a full stop`).toBe(true)
    }
  })

  it('keeps the Method page order stable and complete', () => {
    expect(GLOSSARY_ORDER).toEqual(REQUIRED)
    expect(new Set(GLOSSARY_ORDER).size).toBe(GLOSSARY_ORDER.length)
    for (const id of GLOSSARY_ORDER) expect(glossaryEntry(id)).toBe(GLOSSARY[id])
  })

  it('uses the contract §12 wording for a sudden shift', () => {
    const entry = GLOSSARY.sudden_shift
    expect(entry.plain).toContain('data artefact')
    expect(entry.plain).toContain('real jump in the climate')
    expect(entry.technical).toContain('Pettitt')
    expect(entry.technical).toContain('§12')
    expect(entry.plain.toLowerCase()).not.toContain('wrong')
    expect(entry.plain.toLowerCase()).not.toContain('error')
  })

  it('uses the contract §13 wording for the second witness', () => {
    const entry = GLOSSARY.second_witness
    expect(entry.plain).toContain('independent NASA dataset')
    expect(entry.technical).toContain('§13')
    expect(entry.technical).toContain('BH-FDR')
  })

  it('says a longer record can change a not-yet-significant result', () => {
    expect(GLOSSARY.not_yet_significant.plain).toContain('longer record can change this')
    expect(GLOSSARY.not_yet_significant.plain.toLowerCase()).not.toContain('no change')
  })

  it('explains confidence intervals without claiming proof', () => {
    expect(GLOSSARY.confidence_interval.plain).toContain('includes zero')
    expect(GLOSSARY.confidence_interval.technical).toContain('Sen 1968')
  })

  it('states the years-to-detect wording rule', () => {
    expect(GLOSSARY.years_to_detect.plain).toContain('not a forecast')
    expect(GLOSSARY.years_to_detect.plain).toContain('natural variability')
    expect(GLOSSARY.years_to_detect.technical).toContain('Weatherhead')
    expect(GLOSSARY.years_to_detect.technical).toContain('range')
  })

  it('explains screened-only without implying a second dataset', () => {
    expect(GLOSSARY.screened_only.plain).toContain('no second dataset')
    expect(GLOSSARY.screened_only.technical).toContain('§14')
  })
})
