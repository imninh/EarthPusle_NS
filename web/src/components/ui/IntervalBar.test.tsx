import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IntervalBar, intervalLayout } from './IntervalBar'

// Synthetic numbers: they only exercise the geometry.
describe('intervalLayout', () => {
  it('is symmetric around zero when the interval crosses it', () => {
    const l = intervalLayout(0.2, -0.5, 1)!
    expect(l.zero).toBeCloseTo(0.5, 6)
    expect(l.upper).toBeCloseTo(1, 6)
    expect(l.lower).toBeCloseTo(0.25, 6)
    expect(l.value).toBeGreaterThan(l.zero)
  })
  it('runs from zero to 1.15 x the far end when all positive', () => {
    const l = intervalLayout(0.4, 0.3, 0.55)!
    expect(l.zero).toBe(0)
    expect(l.upper).toBeCloseTo(1 / 1.15, 6)
    expect(l.lower).toBeLessThan(l.value)
    expect(l.value).toBeLessThan(l.upper)
  })
  it('puts zero at the right edge when all negative', () => {
    const l = intervalLayout(-0.4, -0.55, -0.3)!
    expect(l.zero).toBe(1)
    expect(l.lower).toBeCloseTo(1 - 1 / 1.15, 6)
    expect(l.upper).toBeLessThan(1)
  })
  it('returns null for non-finite input', () => {
    expect(intervalLayout(Number.NaN, 0, 1)).toBeNull()
    expect(intervalLayout(0, Number.NEGATIVE_INFINITY, 1)).toBeNull()
    expect(intervalLayout(0, 0, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('IntervalBar', () => {
  const base = {
    value: 0.4,
    lower: 0.3,
    upper: 0.55,
    valueLabel: 'V',
    lowerLabel: 'LOW',
    upperLabel: 'UP',
    direction: 'increase' as const,
    summary: '95% interval does not cross zero',
  }
  it('renders its labels and the summary as the accessible name', () => {
    const html = renderToStaticMarkup(<IntervalBar {...base} />)
    expect(html).toContain('LOW')
    expect(html).toContain('UP')
    expect(html).toContain('>V<')
    expect(html).toContain('aria-label="95% interval does not cross zero"')
    expect(html).toContain('ui-ibar--increase')
    expect(html).toContain('ui-ibar-zero')
  })
  it('renders nothing when a number is not finite', () => {
    expect(renderToStaticMarkup(<IntervalBar {...base} value={Number.NaN} />)).toBe('')
  })
})
