import { describe, expect, it } from 'vitest'
import { N_COLS, N_ROWS, cellAreaWeight, cellIndex } from '../../data/contract'
import {
  cellQuality,
  qualityBannerText,
  qualityDetailText,
  qualityShareForCountry,
  qualityShareForRange,
} from './quality'

function flagLayer(): Int8Array {
  return new Int8Array(N_ROWS * N_COLS).fill(-99)
}

function breakLayer(): Float32Array {
  return new Float32Array(N_ROWS * N_COLS).fill(Number.NaN)
}

describe('cellQuality', () => {
  it('reads a flagged cell and its break year', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    flags[cellIndex(10, 20)] = 2
    breaks[cellIndex(10, 20)] = 2011.4
    const quality = cellQuality(flags, breaks, 10, 20)
    expect(quality.available).toBe(true)
    expect(quality.flagged).toBe(true)
    expect(quality.flag).toBe(2)
    expect(quality.flaggedShare).toBe(1)
    expect(quality.evaluatedCells).toBe(1)
    expect(quality.breakYear).toBeCloseTo(2011.4, 4)
  })

  it('distinguishes an unflagged cell from an unevaluated cell', () => {
    const flags = flagLayer()
    flags[cellIndex(10, 20)] = 0
    const clean = cellQuality(flags, breakLayer(), 10, 20)
    expect(clean.available).toBe(true)
    expect(clean.flagged).toBe(false)
    expect(clean.flaggedShare).toBe(0)
    expect(clean.breakYear).toBeNull()

    const unevaluated = cellQuality(flags, breakLayer(), 11, 20)
    expect(unevaluated.evaluatedCells).toBe(0)
    expect(unevaluated.flaggedShare).toBeNull()
    expect(unevaluated.flagged).toBe(false)
  })

  it('reports unavailable when the export has no quality layer', () => {
    const quality = cellQuality(null, null, 10, 20)
    expect(quality.available).toBe(false)
    expect(quality.flagged).toBe(false)
    expect(qualityDetailText(quality)).toBeNull()
  })
})

describe('qualityShareForRange', () => {
  it('uses area weights over evaluated cells and the median break year', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    flags[cellIndex(10, 20)] = 0
    flags[cellIndex(10, 21)] = 1
    breaks[cellIndex(10, 21)] = 2011
    flags[cellIndex(11, 20)] = 2
    breaks[cellIndex(11, 20)] = 2013
    const quality = qualityShareForRange(flags, breaks, { row0: 10, row1: 11, col0: 20, col1: 21 })
    const w10 = cellAreaWeight(10)
    const w11 = cellAreaWeight(11)
    expect(quality.available).toBe(true)
    expect(quality.flaggedCells).toBe(2)
    expect(quality.evaluatedCells).toBe(3)
    expect(quality.flaggedShare).toBeCloseTo((w10 + w11) / (2 * w10 + w11), 12)
    expect(quality.breakYear).toBe(2012)
  })

  it('returns a null share when no cell in the range was evaluated', () => {
    const quality = qualityShareForRange(flagLayer(), breakLayer(), { row0: 10, row1: 10, col0: 20, col1: 20 })
    expect(quality.available).toBe(true)
    expect(quality.evaluatedCells).toBe(0)
    expect(quality.flaggedShare).toBeNull()
    expect(quality.breakYear).toBeNull()
  })
})

describe('qualityShareForCountry', () => {
  it('counts only cells belonging to the country index', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    const grid = new Int16Array(N_ROWS * N_COLS).fill(-1)
    grid[cellIndex(10, 20)] = 5
    grid[cellIndex(10, 21)] = 5
    grid[cellIndex(11, 20)] = 6
    flags[cellIndex(10, 20)] = 2
    breaks[cellIndex(10, 20)] = 2011
    flags[cellIndex(10, 21)] = 0
    flags[cellIndex(11, 20)] = 2
    const quality = qualityShareForCountry(flags, breaks, grid, 5)
    expect(quality.flaggedCells).toBe(1)
    expect(quality.evaluatedCells).toBe(2)
    expect(quality.flaggedShare).toBeCloseTo(0.5, 12)
    expect(quality.breakYear).toBe(2011)
  })
})

describe('quality wording', () => {
  it('uses the code-2 wording for a documented forcing change', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    flags[cellIndex(10, 20)] = 2
    breaks[cellIndex(10, 20)] = 2011.4
    const quality = cellQuality(flags, breaks, 10, 20)
    const banner = qualityBannerText(quality, 'GLDAS_NOAH10_M', '2.1', [2008, 2012])
    expect(banner).toBe(
      'Sudden shift during a documented GLDAS input change (2008–2012): possible data discontinuity. Read the trend with caution.',
    )
    expect(qualityDetailText(quality)).toBe(banner)
    expect(banner).not.toMatch(/wrong|error/i)
    expect(banner).not.toContain('step-like')
  })

  it('uses the code-1 wording for a shift outside the documented period', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    flags[cellIndex(10, 20)] = 1
    breaks[cellIndex(10, 20)] = 2015.2
    const quality = cellQuality(flags, breaks, 10, 20)
    const banner = qualityBannerText(quality, 'GLDAS_NOAH10_M', '2.1', [2008, 2012])
    expect(banner).toContain('Sudden shift around 2015')
    expect(banner).toContain('real jump in the climate or a data artefact')
    expect(banner).toContain('step fits slightly better than a straight line')
    expect(banner).not.toMatch(/wrong|error/i)
    expect(qualityDetailText(quality)).toBe(banner)
  })

  it('describes a regional flagged share with code-1 wording', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    flags[cellIndex(10, 20)] = 1
    breaks[cellIndex(10, 20)] = 2015
    flags[cellIndex(10, 21)] = 0
    const quality = qualityShareForRange(flags, breaks, { row0: 10, row1: 10, col0: 20, col1: 21 })
    const banner = qualityBannerText(quality, 'GLDAS_NOAH10_M', '2.1', [2008, 2012])
    expect(banner).toContain('About 50% of evaluated cells in this region show a sudden shift around 2015')
    expect(banner).toContain('real jump in the climate or a data artefact')
    expect(qualityDetailText(quality)).toContain('50% of evaluated cells show a sudden shift around 2015')
  })

  it('uses code-2 wording for a regional break inside the documented period', () => {
    const flags = flagLayer()
    const breaks = breakLayer()
    flags[cellIndex(10, 20)] = 2
    breaks[cellIndex(10, 20)] = 2011
    flags[cellIndex(10, 21)] = 0
    const quality = qualityShareForRange(flags, breaks, { row0: 10, row1: 10, col0: 20, col1: 21 })
    const banner = qualityBannerText(quality, 'GLDAS_NOAH10_M', '2.1', [2008, 2012])
    expect(banner).toContain('About 50% of evaluated cells in this region show a sudden shift during a documented GLDAS input change (2008–2012)')
    expect(banner).toContain('possible data discontinuity')
    expect(banner).toContain('Read the trend with caution')
    expect(qualityDetailText(quality)).toContain('50% of evaluated cells show a sudden shift during a documented GLDAS input change (2008–2012)')
  })

  it('returns no banner when quality is absent or unflagged', () => {
    expect(qualityBannerText(null, 'GLDAS_NOAH10_M', '2.1', [2008, 2012])).toBeNull()
    const flags = flagLayer()
    flags[cellIndex(10, 20)] = 0
    const clean = cellQuality(flags, breakLayer(), 10, 20)
    expect(qualityBannerText(clean, 'GLDAS_NOAH10_M', '2.1', [2008, 2012])).toBeNull()
    expect(qualityDetailText(clean)).toBe('No sudden shift detected in this cell.')
  })
})
