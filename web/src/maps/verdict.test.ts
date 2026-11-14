// All grids below are SYNTHETIC test fixtures, not NASA results.
import { describe, expect, it } from 'vitest'
import {
  INSUFFICIENT_DATA,
  N_COLS,
  N_ROWS,
  OUTSIDE_DOMAIN,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
} from '../data/contract'
import type { ClassPalette } from './gridImage'
import {
  VERDICT_CLEAN,
  VERDICT_CONTRADICTED,
  VERDICT_FLAGGED,
  VERDICT_MARKER,
  VERDICT_NOT_YET,
  applyContradictedStripes,
  verdictClass,
  verdictColour,
  verdictGrid,
  verdictShares,
} from './verdict'

const PALETTE: ClassPalette = {
  increase: [200, 60, 40, 255],
  decrease: [30, 110, 180, 255],
  neutral: [200, 204, 210, 255],
  insufficientA: [213, 216, 222, 255],
  insufficientB: [154, 163, 175, 255],
  warmingDrying: [0, 0, 0, 255],
  warmingWetting: [0, 0, 0, 255],
  coolingDrying: [0, 0, 0, 255],
  coolingWetting: [0, 0, 0, 255],
  mixed: [0, 0, 0, 255],
}

describe('verdictClass (synthetic)', () => {
  it('class A: significant, no flag, witness agrees', () => {
    expect(verdictClass(TREND_INCREASE, 0, WITNESS_CORROBORATED)).toBe(VERDICT_CLEAN)
    expect(verdictClass(TREND_DECREASE, 0, WITNESS_CORROBORATED)).toBe(VERDICT_CLEAN)
  })

  it('class A also covers a witness that is present but not contradicting', () => {
    for (const code of [WITNESS_SAME_SIGN, WITNESS_OPPOSITE_SIGN, WITNESS_MAIN_NOT_SIGNIFICANT, INSUFFICIENT_DATA]) {
      expect(verdictClass(TREND_INCREASE, 0, code)).toBe(VERDICT_CLEAN)
    }
  })

  it('class B: flagged for a sudden shift, both flag codes', () => {
    expect(verdictClass(TREND_INCREASE, 1, WITNESS_CORROBORATED)).toBe(VERDICT_FLAGGED)
    expect(verdictClass(TREND_INCREASE, 2, null)).toBe(VERDICT_FLAGGED)
  })

  it('class C: contradicted by the second dataset, and C wins over B', () => {
    expect(verdictClass(TREND_DECREASE, 0, WITNESS_CONTRADICTED)).toBe(VERDICT_CONTRADICTED)
    expect(verdictClass(TREND_INCREASE, 1, WITNESS_CONTRADICTED)).toBe(VERDICT_CONTRADICTED)
    expect(verdictClass(TREND_INCREASE, 2, WITNESS_CONTRADICTED)).toBe(VERDICT_CONTRADICTED)
  })

  it('class D: a direction, not yet significant, whatever the other layers say', () => {
    expect(verdictClass(TREND_NOT_SIGNIFICANT, 1, WITNESS_CONTRADICTED)).toBe(VERDICT_NOT_YET)
    expect(verdictClass(TREND_NOT_SIGNIFICANT, null, null)).toBe(VERDICT_NOT_YET)
  })

  it('keeps the insufficient-data and outside-domain states', () => {
    expect(verdictClass(INSUFFICIENT_DATA, 1, WITNESS_CONTRADICTED)).toBe(INSUFFICIENT_DATA)
    expect(verdictClass(OUTSIDE_DOMAIN, 0, null)).toBe(OUTSIDE_DOMAIN)
  })

  it('missing witness layer: never contradicts, flag still counts', () => {
    expect(verdictClass(TREND_INCREASE, 0, null)).toBe(VERDICT_CLEAN)
    expect(verdictClass(TREND_INCREASE, 1, null)).toBe(VERDICT_FLAGGED)
  })

  it('missing quality layer: never flags, contradiction still counts', () => {
    expect(verdictClass(TREND_INCREASE, null, WITNESS_CORROBORATED)).toBe(VERDICT_CLEAN)
    expect(verdictClass(TREND_INCREASE, null, WITNESS_CONTRADICTED)).toBe(VERDICT_CONTRADICTED)
  })

  it('missing both layers: every significant cell is class A', () => {
    expect(verdictClass(TREND_INCREASE, null, null)).toBe(VERDICT_CLEAN)
    expect(verdictClass(TREND_DECREASE, null, null)).toBe(VERDICT_CLEAN)
  })

  it('quality -9 or -99 (not evaluated, outside) is not a flag', () => {
    expect(verdictClass(TREND_INCREASE, INSUFFICIENT_DATA, null)).toBe(VERDICT_CLEAN)
    expect(verdictClass(TREND_INCREASE, OUTSIDE_DOMAIN, null)).toBe(VERDICT_CLEAN)
  })
})

function syntheticGrids() {
  const size = N_ROWS * N_COLS
  const trend = new Int8Array(size).fill(OUTSIDE_DOMAIN)
  const quality = new Int8Array(size).fill(OUTSIDE_DOMAIN)
  const witness = new Int8Array(size).fill(OUTSIDE_DOMAIN)
  // Row 90 (near the equator): five test cells.
  const base = 90 * N_COLS
  const set = (offset: number, t: number, q: number, w: number) => {
    trend[base + offset] = t
    quality[base + offset] = q
    witness[base + offset] = w
  }
  set(0, TREND_INCREASE, 0, WITNESS_CORROBORATED) // A
  set(1, TREND_DECREASE, 1, WITNESS_CORROBORATED) // B
  set(2, TREND_INCREASE, 1, WITNESS_CONTRADICTED) // C
  set(3, TREND_NOT_SIGNIFICANT, 0, 0) // D
  set(4, INSUFFICIENT_DATA, -9, -9)
  return { trend, quality, witness }
}

describe('verdictGrid and verdictShares (synthetic)', () => {
  it('classifies a small synthetic grid cell by cell', () => {
    const { trend, quality, witness } = syntheticGrids()
    const grid = verdictGrid(trend, quality, witness)
    const base = 90 * N_COLS
    expect(Array.from(grid.slice(base, base + 6))).toEqual([
      VERDICT_CLEAN,
      VERDICT_FLAGGED,
      VERDICT_CONTRADICTED,
      VERDICT_NOT_YET,
      INSUFFICIENT_DATA,
      OUTSIDE_DOMAIN,
    ])
  })

  it('without quality and witness layers the same grid has no B and no C', () => {
    const { trend } = syntheticGrids()
    const grid = verdictGrid(trend, null, null)
    const shares = verdictShares(grid)
    expect(shares.evaluated.flagged).toBe(0)
    expect(shares.evaluated.contradicted).toBe(0)
    expect(shares.significant.clean).toBe(1)
  })

  it('area shares add to one and use equal weights within one row', () => {
    const { trend, quality, witness } = syntheticGrids()
    const shares = verdictShares(verdictGrid(trend, quality, witness))
    const total = Object.values(shares.evaluated).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(shares.evaluated.clean).toBeCloseTo(0.25, 10)
    expect(shares.significant.contradicted).toBeCloseTo(1 / 3, 10)
  })

  it('returns NaN shares when nothing is evaluated', () => {
    const shares = verdictShares(new Int8Array(N_ROWS * N_COLS).fill(OUTSIDE_DOMAIN))
    expect(Number.isNaN(shares.evaluated.clean)).toBe(true)
  })
})

describe('verdictColour (synthetic)', () => {
  it('A uses the direction colour, B marker yellow, D a translucent neutral', () => {
    expect(verdictColour(VERDICT_CLEAN, TREND_INCREASE, PALETTE, 0)).toEqual(PALETTE.increase)
    expect(verdictColour(VERDICT_CLEAN, TREND_DECREASE, PALETTE, 0)).toEqual(PALETTE.decrease)
    expect(verdictColour(VERDICT_FLAGGED, TREND_INCREASE, PALETTE, 0)).toEqual(VERDICT_MARKER)
    expect(verdictColour(VERDICT_NOT_YET, TREND_NOT_SIGNIFICANT, PALETTE, 0)[3]).toBeLessThan(255)
    expect(verdictColour(OUTSIDE_DOMAIN, OUTSIDE_DOMAIN, PALETTE, 0)[3]).toBe(0)
  })

  it('C keeps the direction colour and gets stripes that differ from the fill', () => {
    expect(verdictColour(VERDICT_CONTRADICTED, TREND_DECREASE, PALETTE, 0)).toEqual(PALETTE.decrease)
    const classes = new Int8Array(N_ROWS * N_COLS).fill(OUTSIDE_DOMAIN)
    classes[0] = VERDICT_CONTRADICTED
    const ppd = 4
    const width = N_COLS * ppd
    const data = new Uint8ClampedArray(width * N_ROWS * ppd * 4)
    for (let y = 0; y < ppd; y++) {
      for (let x = 0; x < ppd; x++) {
        const o = (y * width + x) * 4
        data.set([30, 110, 180, 255], o)
      }
    }
    const image = { data, width, height: N_ROWS * ppd } as unknown as ImageData
    applyContradictedStripes(image, classes, ppd)
    const reds = new Set<number>()
    for (let y = 0; y < ppd; y++) for (let x = 0; x < ppd; x++) reds.add(data[(y * width + x) * 4])
    expect(reds.size).toBe(2)
  })

  it('stripes only class C: an A cell keeps its flat direction colour', () => {
    const classes = new Int8Array(N_ROWS * N_COLS).fill(OUTSIDE_DOMAIN)
    classes[0] = VERDICT_CONTRADICTED
    classes[1] = VERDICT_CLEAN
    const ppd = 4
    const width = N_COLS * ppd
    const data = new Uint8ClampedArray(width * N_ROWS * ppd * 4)
    for (let y = 0; y < ppd; y++) {
      for (let x = 0; x < 2 * ppd; x++) data.set([30, 110, 180, 255], (y * width + x) * 4)
    }
    const image = { data, width, height: N_ROWS * ppd } as unknown as ImageData
    applyContradictedStripes(image, classes, ppd)
    for (let y = 0; y < ppd; y++) {
      for (let x = ppd; x < 2 * ppd; x++) {
        const offset = (y * width + x) * 4
        expect(Array.from(data.slice(offset, offset + 4))).toEqual([30, 110, 180, 255])
      }
    }
  })
})
