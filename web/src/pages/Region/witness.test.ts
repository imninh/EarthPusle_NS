import { describe, expect, it } from 'vitest'
import type { DataIndex } from '../../data/types'
import { WITNESS_CONTRADICTED, WITNESS_CORROBORATED, WITNESS_OPPOSITE_SIGN, WITNESS_SAME_SIGN } from '../../data/contract'
import { buildCitation, buildRegionCsv } from './download'
import {
  witnessAgreementCode,
  witnessAgreementText,
  witnessProductInfo,
  witnessSummaryClause,
  witnessTrendFromSeries,
  type WitnessTrend,
} from './witness'

function calendar(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const year = 2001 + Math.floor(i / 12)
    const month = (i % 12) + 1
    return `${year}-${String(month).padStart(2, '0')}`
  })
}

const months = calendar(288)

function trend(overrides: Partial<WitnessTrend> = {}): WitnessTrend {
  return {
    slopeDecade: 0.4,
    p: 0.001,
    tau: 0.5,
    validMonths: 288,
    monthsInWindow: 288,
    trendClass: 'increasing',
    ...overrides,
  }
}

describe('witnessTrendFromSeries', () => {
  it('runs the same browser Sen/MK test on a witness series', () => {
    const values = months.map((_, i) => i * 0.01)
    const result = witnessTrendFromSeries(months, values, '2001-01', '2024-12')
    expect(result.trendClass).toBe('increasing')
    expect(result.slopeDecade).toBeGreaterThan(0)
    expect(result.p).not.toBeNull()
    expect(result.validMonths).toBe(288)
  })

  it('reports insufficient data for a short window or missing values', () => {
    const values = months.map(() => null)
    const result = witnessTrendFromSeries(months, values, '2013-01', '2024-12')
    expect(result.trendClass).toBe('insufficient data')
    expect(result.slopeDecade).toBeNull()
  })
})

describe('witness agreement', () => {
  it('maps same/opposite direction and significance to the §13 codes', () => {
    expect(witnessAgreementCode('increasing', trend())).toBe(WITNESS_CORROBORATED)
    expect(witnessAgreementCode('increasing', trend({ trendClass: 'not significant' }))).toBe(
      WITNESS_SAME_SIGN,
    )
    expect(
      witnessAgreementCode('increasing', trend({ trendClass: 'decreasing', slopeDecade: -0.4 })),
    ).toBe(WITNESS_CONTRADICTED)
    expect(
      witnessAgreementCode(
        'increasing',
        trend({ trendClass: 'not significant', slopeDecade: -0.4 }),
      ),
    ).toBe(WITNESS_OPPOSITE_SIGN)
    expect(witnessAgreementCode('not significant', trend())).toBe(0)
    expect(witnessAgreementCode('increasing', null)).toBe(-9)
    expect(witnessAgreementCode('increasing', trend({ trendClass: 'insufficient data' }))).toBe(-9)
  })

  it('uses calm agreement wording', () => {
    expect(witnessAgreementText(WITNESS_CORROBORATED)).toContain('agrees')
    expect(witnessAgreementText(WITNESS_CONTRADICTED)).toContain('disagrees')
    expect(witnessAgreementText(WITNESS_OPPOSITE_SIGN)).toContain('opposite direction')
    expect(witnessAgreementText(0)).toContain('not applicable')
  })
})

describe('witness summary clause', () => {
  it('adds a corroboration clause for a plain significant trend', () => {
    expect(
      witnessSummaryClause({
        mainTrendClass: 'increasing',
        warm: true,
        qualityFlagged: false,
        witness: { label: 'MERRA-2 reanalysis', agreement: WITNESS_CORROBORATED },
      }),
    ).toBe('; MERRA-2 reanalysis shows the same warming')
  })

  it('uses the combined §13 reading when quality is flagged', () => {
    expect(
      witnessSummaryClause({
        mainTrendClass: 'increasing',
        warm: true,
        qualityFlagged: true,
        witness: { label: 'MERRA-2 reanalysis', agreement: WITNESS_CORROBORATED },
      }),
    ).toContain('more likely a real change')
    expect(
      witnessSummaryClause({
        mainTrendClass: 'increasing',
        warm: true,
        qualityFlagged: true,
        witness: { label: 'MERRA-2 reanalysis', agreement: WITNESS_CONTRADICTED },
      }),
    ).toContain('more likely a data artefact')
  })

  it('stays silent without a witness or for a non-significant main trend', () => {
    expect(
      witnessSummaryClause({
        mainTrendClass: 'increasing',
        warm: true,
        qualityFlagged: false,
        witness: null,
      }),
    ).toBeNull()
    expect(
      witnessSummaryClause({
        mainTrendClass: 'not significant',
        warm: true,
        qualityFlagged: false,
        witness: { label: 'MERRA-2 reanalysis', agreement: WITNESS_CORROBORATED },
      }),
    ).toBeNull()
  })
})

describe('witness product lookup', () => {
  const index = {
    witness: {
      products: {
        air_temperature: {
          product: 'M2TMNXSLV',
          version: '5.12.4',
          source_variable: 'T2M',
          doi: '10.5067/AP1B0BA5PD2K',
          label: 'MERRA-2 reanalysis',
        },
      },
    },
  } as unknown as DataIndex

  it('returns the label and DOI, or null when absent', () => {
    expect(witnessProductInfo(index, 'air_temperature')).toEqual({
      label: 'MERRA-2 reanalysis',
      product: 'M2TMNXSLV',
      version: '5.12.4',
      doi: '10.5067/AP1B0BA5PD2K',
    })
    expect(witnessProductInfo(index, 'precipitation')).toBeNull()
  })
})

describe('download and citation builders', () => {
  it('writes the required CSV columns and leaves missing values empty', () => {
    const csv = buildRegionCsv({
      months: ['2001-01', '2001-02'],
      values: [1.5, null],
      anomalies: [0.5, null],
      witnessAnomalies: [0.2, null],
      validFraction: [0.9, null],
    })
    expect(csv.split('\n')[0]).toBe('month,value,anomaly,witness_anomaly,valid_cell_fraction')
    expect(csv).toContain('2001-01,1.5,0.5,0.2,0.9')
    expect(csv).toContain('2001-02,,,,')
  })

  it('includes the URL, DOIs and both method lines in the citation', () => {
    const text = buildCitation({
      url: 'https://example.test/#/region?region=country_704',
      place: 'Vietnam',
      variableLabel: 'Near-surface air temperature',
      windowLabel: '2001-01 to 2024-12 (2001-2024)',
      product: 'GLDAS_NOAH10_M',
      productVersion: '2.1',
      doi: '10.5067/LWTYSMP3VM5Z',
      witness: {
        label: 'MERRA-2 reanalysis',
        product: 'M2TMNXSLV',
        version: '5.12.4',
        doi: '10.5067/AP1B0BA5PD2K',
      },
      method: 'precomputed: Hamed–Rao modified Mann–Kendall, FDR-corrected',
      witnessMethod: 'same Sen + Hamed–Rao MK + BH-FDR test on an independent NASA product',
    })
    expect(text).toContain('https://example.test/#/region?region=country_704')
    expect(text).toContain('Main DOI: 10.5067/LWTYSMP3VM5Z')
    expect(text).toContain('Witness DOI: 10.5067/AP1B0BA5PD2K')
    expect(text).toContain('Method: precomputed')
    expect(text).toContain('Witness method:')
  })
})
