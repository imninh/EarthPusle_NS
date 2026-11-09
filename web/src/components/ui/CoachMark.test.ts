import { describe, expect, it } from 'vitest'
import { isCoachCloseKey } from './CoachMark'

describe('coach close key', () => {
  it('closes only on Escape', () => {
    expect(isCoachCloseKey('Escape')).toBe(true)
    expect(isCoachCloseKey('Esc')).toBe(false)
    expect(isCoachCloseKey('Enter')).toBe(false)
    expect(isCoachCloseKey(' ')).toBe(false)
  })
})
