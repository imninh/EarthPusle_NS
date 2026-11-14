import { describe, expect, it } from 'vitest'
import { INSUFFICIENT_DATA, OUTSIDE_DOMAIN, TREND_DECREASE, TREND_INCREASE, TREND_NOT_SIGNIFICANT } from '../../data/contract'
import { VERDICT_LABELS, plainVerdict } from './verdict'

describe('plainVerdict', () => {
  it('names an increasing direction with the variable’s own meaning', () => {
    expect(plainVerdict({ trendClass: TREND_INCREASE, increaseMeans: 'warmer' })).toEqual({
      label: 'Warmer, strong evidence',
      tone: 'accent',
    })
    expect(plainVerdict({ trendClass: TREND_INCREASE, increaseMeans: 'wetter' }).label).toBe('Wetter, strong evidence')
  })

  it('falls back to Rising when the registry gives no direction word', () => {
    expect(plainVerdict({ trendClass: TREND_INCREASE })).toEqual({
      label: VERDICT_LABELS.rising,
      tone: 'accent',
    })
    expect(plainVerdict({ trendClass: TREND_INCREASE, increaseMeans: '   ' }).label).toBe('Rising, strong evidence')
  })

  it('names a decreasing direction', () => {
    expect(plainVerdict({ trendClass: TREND_DECREASE, increaseMeans: 'warmer' })).toEqual({
      label: 'Falling, strong evidence',
      tone: 'accent',
    })
  })

  it('says a direction is visible but not significant yet', () => {
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, slope: -0.2 })).toEqual({
      label: VERDICT_LABELS.notYet,
      tone: 'default',
    })
    // No slope information must not be turned into a claim that nothing changed.
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT }).label).toBe('A direction, not yet significant')
  })

  it('says no clear trend only when the slope really is zero', () => {
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, slope: 0 }).label).toBe('No clear trend')
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, slope: Number.NaN }).label).toBe(
      'A direction, not yet significant',
    )
  })

  it('adds the caution label for a flagged significant trend', () => {
    expect(plainVerdict({ trendClass: TREND_INCREASE, flagged: true, increaseMeans: 'warmer' })).toEqual({
      label: 'Read with caution',
      tone: 'warn',
    })
    expect(plainVerdict({ trendClass: TREND_DECREASE, flagged: true }).label).toBe('Read with caution')
  })

  it('adds the caution label for either disagreeing witness code', () => {
    expect(plainVerdict({ trendClass: TREND_INCREASE, witnessCode: -1 }).label).toBe('Read with caution')
    expect(plainVerdict({ trendClass: TREND_INCREASE, witnessCode: -2 }).label).toBe('Read with caution')
    expect(plainVerdict({ trendClass: TREND_DECREASE, witnessCode: -2 }).tone).toBe('warn')
  })

  it('does not add caution for agreeing or not-evaluated witness codes', () => {
    for (const witnessCode of [2, 1, 0, -9, null, undefined]) {
      expect(plainVerdict({ trendClass: TREND_INCREASE, witnessCode, increaseMeans: 'warmer' }).label).toBe(
        'Warmer, strong evidence',
      )
    }
  })

  it('does not add caution to a non-significant result', () => {
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, flagged: true, witnessCode: -2 }).label).toBe(
      'A direction, not yet significant',
    )
  })

  it('maps insufficient data and outside-domain cells to Not enough data', () => {
    expect(plainVerdict({ trendClass: INSUFFICIENT_DATA })).toEqual({
      label: VERDICT_LABELS.notEnough,
      tone: 'default',
    })
    expect(plainVerdict({ trendClass: OUTSIDE_DOMAIN })).toEqual({
      label: VERDICT_LABELS.notEnough,
      tone: 'default',
    })
  })

  it('never invents a verdict for an unknown class', () => {
    expect(plainVerdict({ trendClass: 7 }).label).toBe('Not enough data')
    expect(plainVerdict({ trendClass: Number.NaN }).label).toBe('Not enough data')
  })

  it('uses only the fixed verdict vocabulary', () => {
    const labels = new Set(
      [
        plainVerdict({ trendClass: TREND_INCREASE, increaseMeans: 'warmer' }).label,
        plainVerdict({ trendClass: TREND_DECREASE }).label,
        plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT }).label,
        plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, slope: 0 }).label,
        plainVerdict({ trendClass: TREND_INCREASE, flagged: true }).label,
        plainVerdict({ trendClass: INSUFFICIENT_DATA }).label,
      ],
    )
    expect([...labels].sort()).toEqual(
      [
        VERDICT_LABELS.caution,
        VERDICT_LABELS.falling,
        VERDICT_LABELS.noClear,
        VERDICT_LABELS.notEnough,
        VERDICT_LABELS.notYet,
        'Warmer, strong evidence',
      ].sort(),
    )
  })
})
