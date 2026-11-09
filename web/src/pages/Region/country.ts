// Pure helpers for the small static country locator map (schema 1.2, §11).
import { N_COLS, N_ROWS, cellIndex } from '../../data/contract'

export interface CountryCellExtent {
  row0: number
  row1: number
  col0: number
  col1: number
  count: number
}

/** Inclusive cell bounds of a country in `country_grid.i16`; null when it has no cells. */
export function countryCellExtent(
  grid: ArrayLike<number> | null | undefined,
  countryIndex: number,
): CountryCellExtent | null {
  if (!grid) return null
  let row0 = N_ROWS
  let row1 = -1
  let col0 = N_COLS
  let col1 = -1
  let count = 0
  for (let row = 0; row < N_ROWS; row++) {
    for (let col = 0; col < N_COLS; col++) {
      if (grid[cellIndex(row, col)] !== countryIndex) continue
      count += 1
      if (row < row0) row0 = row
      if (row > row1) row1 = row
      if (col < col0) col0 = col
      if (col > col1) col1 = col
    }
  }
  return count === 0 ? null : { row0, row1, col0, col1, count }
}
