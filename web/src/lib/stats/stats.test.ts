import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fitIntercept, mannKendall, senSlope, spearman } from './index'

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/stats_reference.json',
)

describe('senSlope', () => {
  it('returns the median pairwise slope and the median residual intercept', () => {
    const fit = senSlope([0, 1, 2, 3], [1, 2, 2, 4])
    expect(fit).not.toBeNull()
    expect(fit!.slope).toBe(1)
    expect(fit!.intercept).toBe(1)
  })

  it('uses the supplied time positions, so a gap is not treated as one step', () => {
    // Real times 0, 1, 3 give slope 1. Evenly spaced indexes would give 1.5.
    const fit = senSlope([0, 1, 3], [0, 1, 3])
    expect(fit).not.toBeNull()
    expect(fit!.slope).toBe(1)
    expect(fit!.intercept).toBe(0)
  })

  it('skips non-finite values and still uses their real times', () => {
    const fit = senSlope([0, 1, 2], [1, Number.NaN, 5])
    expect(fit).not.toBeNull()
    expect(fit!.slope).toBe(2)
    expect(fit!.intercept).toBe(1)
  })

  it('returns null when fewer than two valid points remain', () => {
    expect(senSlope([0], [1])).toBeNull()
    expect(senSlope([0, 1], [Number.NaN, 2])).toBeNull()
  })

  it('matches a hand-checked 20-point series with one gap', () => {
    const values = [
      0.000025, 0.010142, 0.002851, -0.005312, 0.007573, Number.NaN, 0.026203, 0.055971, 0.023489,
      0.025091, 0.051464, 0.052971, 0.052108, 0.035557, 0.057748, 0.076406, 0.039782, 0.061681,
      0.036976, 0.053376,
    ]
    const t = values.map((_, i) => i / 12)
    const fit = senSlope(t, values)
    expect(fit).not.toBeNull()
    expect(Math.abs(fit!.slope - 0.035196)).toBeLessThanOrEqual(1e-6)
    expect(fit!.intercept).toBeCloseTo(0.000025, 6)
  })
})

describe('fitIntercept', () => {
  it('is the median of x - slope * t', () => {
    expect(fitIntercept([0, 1, 2, 3], [1, 2, 2, 4], 1)).toBe(1)
  })
})

describe('mannKendall', () => {
  it('matches the hand-worked strictly increasing series', () => {
    const mk = mannKendall([1, 2, 3, 4, 5])
    expect(mk).not.toBeNull()
    expect(mk!.S).toBe(10)
    expect(mk!.varS).toBeCloseTo(16.666666666666668, 10)
    expect(mk!.z).toBeCloseTo(2.2045407685048604, 10)
    expect(mk!.tau).toBe(1)
    expect(Math.abs(mk!.p - 0.0274863361115103)).toBeLessThanOrEqual(1e-4)
  })

  it('applies the tie correction to var(S)', () => {
    const mk = mannKendall([1, 2, 2, 4])
    expect(mk).not.toBeNull()
    expect(mk!.S).toBe(5)
    expect(mk!.varS).toBeCloseTo(7.666666666666667, 10)
    expect(mk!.tau).toBeCloseTo(5 / 6, 12)
    expect(Math.abs(mk!.p - 0.14856177489186861)).toBeLessThanOrEqual(1e-4)
  })

  it('drops non-finite values and keeps the remaining order', () => {
    const mk = mannKendall([1, Number.NaN, 3, 4])
    expect(mk).not.toBeNull()
    expect(mk!.S).toBe(3)
    expect(mk!.tau).toBe(1)
    expect(Math.abs(mk!.p - 0.2962698714842864)).toBeLessThanOrEqual(1e-4)
  })

  it('returns a zero statistic for a constant series instead of dividing by zero', () => {
    const mk = mannKendall([2, 2, 2, 2])
    expect(mk).not.toBeNull()
    expect(mk!.S).toBe(0)
    expect(mk!.varS).toBe(0)
    expect(mk!.z).toBe(0)
    expect(mk!.p).toBe(1)
    expect(mk!.tau).toBe(0)
  })

  it('matches the 20-point series used for the slope check', () => {
    const values = [
      0.000025, 0.010142, 0.002851, -0.005312, 0.007573, Number.NaN, 0.026203, 0.055971, 0.023489,
      0.025091, 0.051464, 0.052971, 0.052108, 0.035557, 0.057748, 0.076406, 0.039782, 0.061681,
      0.036976, 0.053376,
    ]
    const mk = mannKendall(values)
    expect(mk).not.toBeNull()
    expect(mk!.S).toBe(99)
    expect(mk!.varS).toBe(817)
    expect(Math.abs(mk!.tau - 0.5789473684210527)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(mk!.p - 0.0006067342740450066)).toBeLessThanOrEqual(1e-4)
  })

  it('returns null for a single finite value', () => {
    expect(mannKendall([1, Number.NaN])).toBeNull()
  })
})

describe('spearman', () => {
  it('is 1 and -1 for perfect monotone pairs', () => {
    expect(spearman([1, 2, 3, 4], [2, 4, 6, 8])).toEqual({ rho: 1, n: 4 })
    expect(spearman([1, 2, 3, 4], [8, 6, 4, 2]).rho).toBe(-1)
  })

  it('uses average ranks when values are tied', () => {
    const result = spearman([1, 2, 2, 4], [1, 2, 3, 4])
    expect(result.n).toBe(4)
    expect(result.rho).not.toBeNull()
    expect(Math.abs(result.rho! - 0.9486832980505139)).toBeLessThanOrEqual(1e-12)
  })

  it('pairs only the finite indexes', () => {
    const result = spearman([1, Number.NaN, 3], [1, 9, 5])
    expect(result.n).toBe(2)
    expect(result.rho).toBe(1)
  })

  it('returns a null rho when either series is constant', () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toEqual({ rho: null, n: 3 })
  })
})

interface ReferenceSeries {
  name?: string
  values: number[]
  t_years?: number[]
  sen_slope_per_year?: number
  sen_slope?: number
  p_value_original?: number
  p?: number
  mk_tau?: number
  tau?: number
}

function referenceSeries(raw: unknown): ReferenceSeries[] {
  if (Array.isArray(raw)) return raw as ReferenceSeries[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { series?: unknown }).series)) {
    return (raw as { series: ReferenceSeries[] }).series
  }
  throw new Error('stats_reference.json must be a series array or an object with a series array')
}

describe('stats_reference.json', () => {
  // P03 owns the fixture and it is not in the repo yet. This test starts
  // asserting as soon as that file appears; until then it is skipped.
  it.skipIf(!existsSync(fixturePath))('matches Sen slope, original p, and tau from the P03 fixture', () => {
    const fixture = referenceSeries(JSON.parse(readFileSync(fixturePath, 'utf8')))
    expect(fixture.length).toBeGreaterThan(0)
    for (const series of fixture) {
      const slope = series.sen_slope_per_year ?? series.sen_slope
      const p = series.p_value_original ?? series.p
      const tau = series.mk_tau ?? series.tau
      if (typeof slope !== 'number' || typeof p !== 'number' || typeof tau !== 'number') {
        throw new Error(
          `series ${series.name ?? '(unnamed)'} is missing sen_slope_per_year, p_value_original, or mk_tau`,
        )
      }
      const values = series.values.map((v) => (v == null || !Number.isFinite(v) ? Number.NaN : v))
      const t = series.t_years ?? values.map((_, i) => i / 12)
      const fit = senSlope(t, values)
      const mk = mannKendall(values)
      expect(fit, series.name).not.toBeNull()
      expect(mk, series.name).not.toBeNull()
      expect(Math.abs(fit!.slope - slope), series.name).toBeLessThanOrEqual(1e-6)
      expect(Math.abs(mk!.tau - tau), series.name).toBeLessThanOrEqual(1e-6)
      expect(Math.abs(mk!.p - p), series.name).toBeLessThanOrEqual(1e-4)
    }
  })
})
