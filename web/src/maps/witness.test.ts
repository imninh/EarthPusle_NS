import { describe, expect, it } from 'vitest'
import {
  INSUFFICIENT_DATA,
  OUTSIDE_DOMAIN,
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
} from '../data/contract'
import {
  combinedQualityWitness,
  WITNESS_PALETTE,
  witnessColour,
  witnessWords,
} from './witness'

describe('witness helpers', () => {
  it('maps every agreement code to a distinct colour', () => {
    const codes = [
      WITNESS_CORROBORATED,
      WITNESS_SAME_SIGN,
      WITNESS_OPPOSITE_SIGN,
      WITNESS_CONTRADICTED,
      WITNESS_MAIN_NOT_SIGNIFICANT,
    ]
    const colours = codes.map((code) => witnessColour(code, WITNESS_PALETTE, 0, 10))
    expect(new Set(colours.map((colour) => colour.join(','))).size).toBe(codes.length)
    expect(witnessColour(WITNESS_CONTRADICTED)[0]).toBeGreaterThan(100)
    expect(witnessColour(OUTSIDE_DOMAIN)[3]).toBe(0)
    expect(witnessColour(INSUFFICIENT_DATA, WITNESS_PALETTE, 3, 10)[3]).toBe(255)
  })

  it('uses the contract wording', () => {
    expect(witnessWords(WITNESS_CORROBORATED)).toContain('agrees')
    expect(witnessWords(WITNESS_CONTRADICTED)).toContain('disagrees')
    expect(witnessWords(WITNESS_SAME_SIGN)).toContain('not significant')
    expect(witnessWords(WITNESS_MAIN_NOT_SIGNIFICANT)).toContain('not significant')
  })

  it('builds the combined quality + witness reading', () => {
    expect(
      combinedQualityWitness(1, WITNESS_CORROBORATED, 'MERRA-2 reanalysis'),
    ).toContain('more likely a real change')
    expect(
      combinedQualityWitness(2, WITNESS_CONTRADICTED, 'MERRA-2 reanalysis'),
    ).toContain('more likely a data artefact')
    expect(
      combinedQualityWitness(1, WITNESS_MAIN_NOT_SIGNIFICANT, 'MERRA-2 reanalysis'),
    ).toContain('data artefact')
    expect(combinedQualityWitness(0, WITNESS_CORROBORATED, 'MERRA-2 reanalysis')).toBeNull()
    expect(combinedQualityWitness(1, null, 'MERRA-2 reanalysis')).toBeNull()
  })
})
