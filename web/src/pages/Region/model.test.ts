import { describe, expect, it } from 'vitest'
import { N_MONTHS, TILE_SIZE, cellAreaWeight, tileIdFor } from '../../data/contract'
import {
  BROWSER_METHOD,
  CELL_METHOD,
  aggregateBbox,
  alignToMonths,
  annualMeanSeries,
  browserTrendClass,
  buildBrowserEvidence,
  buildCellEvidence,
  cellTrendLine,
  cellsInsideBbox,
  correlationPairId,
  perDecadeUnit,
  rangeColSegments,
  senTrendSeries,
  spearmanInWindow,
  spearmanLabel,
  tileIdsForRange,
  validateBbox,
  zScoresInWindow,
  type LoadedTile,
} from './model'

const variable = {
  id: 'example',
  label: 'Example variable',
  category: 'water',
  product: 'EXAMPLE_PRODUCT',
  product_version: '1',
  doi: null,
  source_type: 'model' as const,
  source_variable: 'ExampleVar',
  display_unit: 'mm/month',
  slope_unit: 'mm/month per year',
  description: 'Synthetic test variable.',
  caveats: ['Synthetic test caveat.'],
  core: false,
  increase_means: 'wetter',
}

describe('validateBbox', () => {
  it('accepts a finite box', () => {
    const parsed = validateBbox({ west: '10', south: '-5', east: '20', north: '5' })
    expect(parsed).toEqual({ ok: true, bbox: [10, -5, 20, 5] })
  })

  it('rejects empty, non-finite, out-of-range, and unordered edges', () => {
    expect(validateBbox({ west: '', south: '0', east: '1', north: '1' }).ok).toBe(false)
    expect(validateBbox({ west: 'inf', south: '0', east: '1', north: '1' }).ok).toBe(false)
    expect(validateBbox({ west: '0', south: '-91', east: '1', north: '0' }).ok).toBe(false)
    expect(validateBbox({ west: '-181', south: '0', east: '0', north: '1' }).ok).toBe(false)
    const flipped = validateBbox({ west: '0', south: '5', east: '1', north: '4' })
    expect(flipped.ok).toBe(false)
    if (!flipped.ok) expect(flipped.message).toBe('South must be less than north.')
    const dateline = validateBbox({ west: '170', south: '0', east: '-170', north: '1' })
    expect(dateline.ok).toBe(false)
    if (!dateline.ok) expect(dateline.message).toMatch(/dateline/)
  })
})

describe('cells and tiles', () => {
  it('keeps cell centres inside the box and crosses a tile edge', () => {
    const range = cellsInsideBbox([99.5, 15.5, 100.5, 17.5])
    expect(range).toEqual({ row0: 72, row1: 74, col0: 279, col1: 280 })
    expect(tileIdsForRange(range!)).toEqual(['r070_c270', 'r070_c280'])
  })

  it('returns null when no cell centre falls inside', () => {
    expect(cellsInsideBbox([10.1, 10.1, 10.2, 10.2])).toBeNull()
  })

  it('crosses the dateline with two column segments', () => {
    const range = cellsInsideBbox([170, -10, -170, 10])
    expect(range).not.toBeNull()
    expect(range!.row0).toBe(80)
    expect(range!.row1).toBe(99)
    expect(rangeColSegments(range!)).toEqual([
      [0, 9],
      [350, 359],
    ])
    expect(tileIdsForRange(range!)).toEqual([
      'r080_c000',
      'r080_c350',
      'r090_c000',
      'r090_c350',
    ])
  })
})

describe('aggregateBbox', () => {
  it('area-weights finite cells, treats non-finite as missing, and lists missing tiles', () => {
    const range = cellsInsideBbox([99.5, 15.5, 100.5, 17.5])!
    const make = () => {
      const tile = new Float32Array(N_MONTHS * TILE_SIZE * TILE_SIZE)
      tile.fill(Number.NaN)
      return tile
    }
    const valuesA = make()
    const anomaliesA = make()
    const valuesB = make()
    const anomaliesB = make()
    const set = (tile: Float32Array, row: number, col: number, month: number, value: number) => {
      const r = row % TILE_SIZE
      const c = col % TILE_SIZE
      tile[month * TILE_SIZE * TILE_SIZE + r * TILE_SIZE + c] = value
    }
    set(valuesA, 72, 279, 0, 10)
    set(anomaliesA, 72, 279, 0, 1)
    set(valuesB, 74, 280, 0, 30)
    set(anomaliesB, 74, 280, 0, 3)
    // A mask cell with data only outside the one-month window.
    set(valuesA, 73, 279, 5, 7)
    set(anomaliesA, 73, 279, 5, 0.5)

    const tiles = new Map<string, LoadedTile>([
      [tileIdFor(72, 279), { values: valuesA, anomalies: anomaliesA }],
      [tileIdFor(74, 280), { values: valuesB, anomalies: anomaliesB }],
    ])
    const result = aggregateBbox({ range, months: N_MONTHS, tiles, windowStart: 0, windowEnd: 0 })
    const w72 = cellAreaWeight(72)
    const w74 = cellAreaWeight(74)
    expect(result.values[0]).toBeCloseTo((10 * w72 + 30 * w74) / (w72 + w74), 10)
    expect(result.anomalies[0]).toBeCloseTo((1 * w72 + 3 * w74) / (w72 + w74), 10)
    expect(result.values[1]).toBeNull()
    expect(result.cellsInBox).toBe(6)
    expect(result.maskCells).toBe(3)
    expect(result.cellsUsed).toBe(2)
    expect(result.missingTiles).toEqual([])
  })

  it('counts only cells that entered the anomaly mean for coverage', () => {
    const range = { row0: 72, row1: 72, col0: 279, col1: 279 }
    const values = new Float32Array(N_MONTHS * TILE_SIZE * TILE_SIZE).fill(Number.NaN)
    const anomalies = new Float32Array(N_MONTHS * TILE_SIZE * TILE_SIZE).fill(Number.NaN)
    values[(72 % TILE_SIZE) * TILE_SIZE + (279 % TILE_SIZE)] = 10
    const tiles = new Map<string, LoadedTile>([
      [tileIdFor(72, 279), { values, anomalies }],
    ])
    const result = aggregateBbox({ range, months: N_MONTHS, tiles, windowStart: 0, windowEnd: 0 })
    expect(result.values[0]).toBe(10)
    expect(result.maskCells).toBe(1)
    expect(result.cellsUsed).toBe(0)
  })
})

describe('annualMeanSeries', () => {
  it('averages finite months per calendar year and skips empty years', () => {
    const months = ['2001-01', '2001-02', '2001-03', '2002-01', '2002-02']
    const values = [1, 3, null, 10, 20]
    expect(annualMeanSeries(months, values)).toEqual({ x: ['2001-07', '2002-07'], y: [2, 15] })
    expect(annualMeanSeries(months, values, '2001-01', '2001-12')).toEqual({ x: ['2001-07'], y: [2] })
  })
})

describe('evidence', () => {
  it('uses the exact browser method sentence and a per-decade slope', () => {
    const months = Array.from({ length: 120 }, (_, i) => {
      const year = 2001 + Math.floor(i / 12)
      const month = String((i % 12) + 1).padStart(2, '0')
      return `${year}-${month}`
    })
    const anomalies = months.map((_, i) => i / 12)
    const { evidence, trend } = buildBrowserEvidence({
      variable,
      windowLabel: '2001-01 to 2010-12',
      windowMonths: months,
      anomalies,
      coverage: 0.5,
      coverageNote: 'test',
    })
    expect(evidence.method).toBe(BROWSER_METHOD)
    expect(evidence.showQ).toBe(false)
    expect(evidence.q).toBeNull()
    expect(evidence.source).toBe('browser')
    expect(evidence.slopeUnit).toBe('mm/month per decade')
    expect(trend).not.toBeNull()
    expect(evidence.senSlopeDecade).toBeCloseTo(trend!.slopePerYear * 10, 8)
    expect(evidence.trendClass).toBe('increasing')
    expect(evidence.shortWindow).toBe(false)
    expect(evidence.validMonths).toBe(120)
  })

  it('labels a short or sparse window as insufficient data and still flags the short window', () => {
    expect(browserTrendClass(0.001, 1, 12, 24)).toBe('insufficient data')
    const { evidence } = buildBrowserEvidence({
      variable,
      windowLabel: 'short',
      windowMonths: ['2001-01', '2001-02', '2001-03'],
      anomalies: [1, 2, 3],
      coverage: null,
      coverageNote: null,
    })
    expect(evidence.shortWindow).toBe(true)
    expect(evidence.trendClass).toBe('insufficient data')
    expect(evidence.p).not.toBeNull()
  })

  it('reads cell results as precomputed words and never as a browser class', () => {
    const evidence = buildCellEvidence({
      variable,
      windowLabel: '2001-01 to 2024-12',
      monthsInWindow: 288,
      senSlopeDecade: -1.5,
      p: 0.01,
      q: 0.04,
      tau: -0.2,
      nValid: 280,
      coverage: 280 / 288,
      trendClass: -1,
    })
    expect(evidence.method).toBe(CELL_METHOD)
    expect(evidence.showQ).toBe(true)
    expect(evidence.q).toBe(0.04)
    expect(evidence.trendClass).toBe('decreasing')
    expect(evidence.senSlopeDecade).toBe(-1.5)
    expect(evidence.source).toBe('precomputed')
  })

  it('anchors a cell Sen line on the precomputed slope', () => {
    const line = cellTrendLine(['2001-01', '2001-02', '2001-03'], [0, 1, 2], 12)
    expect(line).not.toBeNull()
    expect(line!.slopePerYear).toBe(12)
    const drawn = senTrendSeries(['2000-12', '2001-01', '2001-02', '2001-03'], '2001-01', '2001-03', line!)
    expect(drawn.months).toEqual(['2001-01', '2001-02', '2001-03'])
    expect(drawn.y[1] - drawn.y[0]).toBeCloseTo(1, 10)
  })
})

describe('comparison helpers', () => {
  const months = ['2001-01', '2001-02', '2001-03', '2001-04']

  it('standardizes only inside the window', () => {
    const z = zScoresInWindow(months, [1, 2, 3, 100], '2001-01', '2001-03')
    expect(z[3]).toBeNull()
    expect(z[0]).not.toBeNull()
    expect(z[0]! + z[1]! + z[2]!).toBeCloseTo(0, 8)
  })

  it('labels live Spearman as computed here and keeps pair ids unordered', () => {
    expect(correlationPairId('b_var', 'a_var')).toBe('a_var__b_var')
    const rho = spearmanInWindow(months, [1, 2, 3, null], [2, 4, 6, 9], '2001-01', '2001-04')
    expect(rho).toEqual({ rho: 1, n: 3 })
    expect(spearmanLabel('computed', rho.rho, rho.n)).toBe('computed here: Spearman ρ = 1.000 (n = 3)')
    expect(spearmanLabel('precomputed', 0.5, 10)).toBe('precomputed Spearman ρ = 0.500 (n = 10)')
    expect(spearmanLabel('computed', null, 0)).toBe('—')
    expect(spearmanLabel('precomputed', null, 12)).toBe('—')
  })

  it('aligns a shorter series onto the calendar and leaves holes null', () => {
    expect(alignToMonths(['2001-02'], [4], months)).toEqual([null, 4, null, null])
  })
})

describe('perDecadeUnit', () => {
  it('rewrites a per-year slope unit', () => {
    expect(perDecadeUnit('per year')).toBe('per decade')
    expect(perDecadeUnit('kg m-2 per year')).toBe('kg m-2 per decade')
    expect(perDecadeUnit('index')).toBe('index per decade')
  })
})
