import { describe, expect, it } from 'vitest'
import { N_COLS, N_ROWS, cellIndex } from '../../data/contract'
import { countryCellExtent } from './country'

describe('countryCellExtent', () => {
  it('returns inclusive bounds and a count for one country index', () => {
    const grid = new Int16Array(N_ROWS * N_COLS).fill(-1)
    grid[cellIndex(10, 20)] = 5
    grid[cellIndex(12, 22)] = 5
    grid[cellIndex(11, 21)] = 5
    grid[cellIndex(30, 30)] = 6
    expect(countryCellExtent(grid, 5)).toEqual({ row0: 10, row1: 12, col0: 20, col1: 22, count: 3 })
  })

  it('returns null for an absent country or a missing grid', () => {
    const grid = new Int16Array(N_ROWS * N_COLS).fill(-1)
    expect(countryCellExtent(grid, 5)).toBeNull()
    expect(countryCellExtent(null, 5)).toBeNull()
  })
})
