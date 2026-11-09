import { describe, expect, it } from 'vitest'
import type { ScreenerRow } from '../../data/types'
import {
  barHalfPercent,
  buildViewRows,
  contrastLabel,
  contrastMeterPercent,
  coverageIsLow,
  domainHasNoEvaluatedCells,
  formatPercent,
  hasDiscontinuityFields,
  screenerHeadline,
  significantArea,
  sortByMetric,
  sortDescription,
  sourceBadge,
} from './metrics'

interface Sample {
  id: string
  n: number | null
}

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id)

describe('sort with nulls last', () => {
  const rows: Sample[] = [
    { id: 'nan', n: Number.NaN },
    { id: 'mid', n: 2 },
    { id: 'nil', n: null },
    { id: 'low', n: 1 },
    { id: 'high', n: 5 },
  ]

  it('sorts ascending with null and NaN after every number', () => {
    expect(ids(sortByMetric(rows, (row) => row.n, 'asc'))).toEqual(['low', 'mid', 'high', 'nan', 'nil'])
  })

  it('sorts descending with null and NaN still last', () => {
    expect(ids(sortByMetric(rows, (row) => row.n, 'desc'))).toEqual(['high', 'mid', 'low', 'nan', 'nil'])
  })

  it('keeps the original order when values tie, including missing values', () => {
    const tied: Sample[] = [
      { id: 'a', n: 1 },
      { id: 'b', n: null },
      { id: 'c', n: 1 },
      { id: 'd', n: null },
    ]
    expect(ids(sortByMetric(tied, (row) => row.n, 'asc'))).toEqual(['a', 'c', 'b', 'd'])
    expect(ids(sortByMetric(tied, (row) => row.n, 'desc'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('does not mutate the input', () => {
    const input: Sample[] = [
      { id: 'b', n: 1 },
      { id: 'a', n: 2 },
    ]
    const copy = input.map((row) => ({ ...row }))
    sortByMetric(input, (row) => row.n, 'asc')
    expect(input).toEqual(copy)
  })
})

describe('significant area used as the default sort', () => {
  it('sums both fractions and treats a missing side as null', () => {
    expect(significantArea(0.25, 0.5)).toBeCloseTo(0.75)
    expect(significantArea(0, 0)).toBe(0)
    expect(significantArea(null, 0.2)).toBeNull()
    expect(significantArea(0.2, null)).toBeNull()
  })

  it('ranks the sum descending and leaves null totals last', () => {
    const rows = [
      { id: 'none', total: null as number | null },
      { id: 'small', total: 0.1 },
      { id: 'zero', total: 0 },
      { id: 'large', total: 0.8 },
    ]
    expect(ids(sortByMetric(rows, (row) => row.total, 'desc'))).toEqual(['large', 'small', 'zero', 'none'])
  })

  it('states the increase + decrease formula when that order is shown', () => {
    expect(sortDescription('significantArea', 'desc')).toBe(
      'Sorted by area with significant change (increase + decrease), largest first.',
    )
    expect(sortDescription('significantArea', 'asc')).toBe(
      'Sorted by area with significant change (increase + decrease), smallest first.',
    )
  })
})

describe('contrast wording', () => {
  it('uses the spec thresholds and an em dash for null', () => {
    expect(contrastLabel(null)).toBe('—')
    expect(contrastLabel(Number.NaN)).toBe('—')
    expect(contrastLabel(0)).toBe('one direction')
    expect(contrastLabel(0.099)).toBe('one direction')
    expect(contrastLabel(0.1)).toBe('mostly one direction')
    expect(contrastLabel(0.299)).toBe('mostly one direction')
    expect(contrastLabel(0.3)).toBe('mixed directions')
    expect(contrastLabel(0.5)).toBe('mixed directions')
  })

  it('maps the meter onto a 0–0.5 scale', () => {
    expect(contrastMeterPercent(null)).toBe(0)
    expect(contrastMeterPercent(0)).toBe(0)
    expect(contrastMeterPercent(0.25)).toBe(50)
    expect(contrastMeterPercent(0.5)).toBe(100)
    expect(contrastMeterPercent(0.8)).toBe(100)
  })
})

describe('percentage formatting', () => {
  it('prints one decimal and an em dash for null', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(1)).toBe('100.0%')
    expect(formatPercent(0.5)).toBe('50.0%')
    expect(formatPercent(0.0011837242006539803)).toBe('0.1%')
    expect(formatPercent(0.9883519856911152)).toBe('98.8%')
  })

  it('gives each side at most half of the diverging track', () => {
    expect(barHalfPercent(null)).toBe(0)
    expect(barHalfPercent(0)).toBe(0)
    expect(barHalfPercent(-0.2)).toBe(0)
    expect(barHalfPercent(0.5)).toBe(25)
    expect(barHalfPercent(1)).toBe(50)
    expect(barHalfPercent(1.4)).toBe(50)
  })

  it('warns only below 70% coverage', () => {
    expect(coverageIsLow(0.699)).toBe(true)
    expect(coverageIsLow(0)).toBe(true)
    expect(coverageIsLow(0.7)).toBe(false)
    expect(coverageIsLow(0.988)).toBe(false)
    expect(coverageIsLow(null)).toBe(false)
  })
})

describe('view rows', () => {
  const variable = {
    id: 'example',
    label: 'Example variable',
    category: 'water',
    source_type: 'mission_observation' as const,
    display_unit: 'mm/month',
    increase_means: 'wetter',
  }

  const screenerRow: ScreenerRow = {
    variable: 'example',
    valid_area_fraction: 0.5,
    sig_increase_area_fraction: 0.2,
    sig_decrease_area_fraction: 0.1,
    median_abs_std_change_decade: 0.4,
    median_sen_slope_decade_sig: -3,
    regional_contrast: 0.25,
    n_cells_evaluated: 12,
  }

  it('maps a non-model source to the satellite badge', () => {
    expect(sourceBadge('model')).toBe('model')
    expect(sourceBadge('mission_observation')).toBe('satellite')
    expect(buildViewRows([variable], [screenerRow])[0]?.sourceBadge).toBe('satellite')
  })

  it('keeps a known zero area distinct from a null contrast', () => {
    const [row] = buildViewRows(
      [{ ...variable, source_type: 'model' }],
      [
        {
          ...screenerRow,
          sig_increase_area_fraction: 0,
          sig_decrease_area_fraction: 0,
          median_abs_std_change_decade: null,
          median_sen_slope_decade_sig: null,
          regional_contrast: null,
          n_cells_evaluated: 4,
        },
      ],
    )
    expect(row?.significantArea).toBe(0)
    expect(row?.contrast).toBeNull()
    expect(row?.magnitude).toBeNull()
    expect(row?.sourceBadge).toBe('model')
  })

  it('treats a variable missing from the screener file as unevaluated', () => {
    const [row] = buildViewRows([variable], [])
    expect(row?.nCells).toBeNull()
    expect(row?.significantArea).toBeNull()
    expect(row?.stepFlag).toBeNull()
    expect(row?.sigTrendFlagged).toBeNull()
    expect(domainHasNoEvaluatedCells([])).toBe(true)
    expect(domainHasNoEvaluatedCells([{ nCells: 0 }, { nCells: null }])).toBe(true)
    expect(domainHasNoEvaluatedCells([{ nCells: 0 }, { nCells: 3 }])).toBe(false)
  })
})

describe('schema 1.2 quality fields', () => {
  const variable = {
    id: 'example',
    label: 'Example variable',
    category: 'water',
    source_type: 'model' as const,
    display_unit: 'mm/month',
    increase_means: 'wetter',
  }
  const base: ScreenerRow = {
    variable: 'example',
    valid_area_fraction: 0.9,
    sig_increase_area_fraction: 0.2,
    sig_decrease_area_fraction: 0.1,
    median_abs_std_change_decade: 0.4,
    median_sen_slope_decade_sig: 1,
    regional_contrast: 0.2,
    n_cells_evaluated: 100,
  }

  it('maps the optional fields and detects their presence', () => {
    const [without] = buildViewRows([variable], [base])
    expect(hasDiscontinuityFields([without!])).toBe(false)

    const [withQuality] = buildViewRows(
      [variable],
      [{ ...base, step_flag_area_fraction: 0.12, sig_trend_flagged_fraction: 0.3 }],
    )
    expect(withQuality?.stepFlag).toBeCloseTo(0.12)
    expect(withQuality?.sigTrendFlagged).toBeCloseTo(0.3)
    expect(hasDiscontinuityFields([withQuality!])).toBe(true)
  })

  it('keeps a known zero flag distinct from a missing field', () => {
    const [row] = buildViewRows([variable], [{ ...base, step_flag_area_fraction: 0 }])
    expect(row?.stepFlag).toBe(0)
    expect(hasDiscontinuityFields([row!])).toBe(true)
  })
})

describe('screener headline', () => {
  const variable = {
    id: 'a',
    label: 'A',
    category: 'water',
    source_type: 'model' as const,
    display_unit: 'mm',
    increase_means: 'wetter',
  }
  const row = (id: string, increase: number, decrease: number, cells = 10): ScreenerRow => ({
    variable: id,
    valid_area_fraction: 1,
    sig_increase_area_fraction: increase,
    sig_decrease_area_fraction: decrease,
    median_abs_std_change_decade: 0.2,
    median_sen_slope_decade_sig: 1,
    regional_contrast: 0.2,
    n_cells_evaluated: cells,
  })

  it('counts evaluated variables above the display threshold', () => {
    const rows = buildViewRows(
      [variable, { ...variable, id: 'b', label: 'B' }, { ...variable, id: 'c', label: 'C' }],
      [row('a', 0.3, 0.1), row('b', 0.02, 0.02), row('c', 0.9, 0.0, 0)],
    )
    expect(screenerHeadline(rows, 'Global land')).toBe(
      '1 of 2 variables show significant change over more than 10% of Global land.',
    )
  })

  it('handles empty and all-small domains without inventing a ranking', () => {
    expect(screenerHeadline([], 'Mekong')).toBe('No cells were evaluated in Mekong for this period.')
    const rows = buildViewRows([variable], [row('a', 0.02, 0.02)])
    expect(screenerHeadline(rows, 'Mekong')).toBe(
      'No variable shows significant change over more than 10% of Mekong in this period.',
    )
  })
})
