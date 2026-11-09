import { describe, expect, it } from 'vitest'
import { cellIndex, colToLon, latToRow, lonToCol, rowToLat, tileIdFor } from './contract'
import { cellSeriesFromTile, reconstructValues } from './loaders'

describe('values reconstruction (schema 1.1)', () => {
  it('adds the calendar-month climatology of the right cell', () => {
    const anomalies = new Float32Array(288 * 100).fill(1)
    const clim = new Float32Array(12 * 180 * 360)
    // cell row 61, col 193 lies in tile r060_c190 at (1, 3)
    for (let mo = 0; mo < 12; mo++) clim[mo * 64800 + 61 * 360 + 193] = 10 * (mo + 1)
    const v = reconstructValues(anomalies, clim, 'r060_c190')
    const s = cellSeriesFromTile(v, 61, 193)
    expect(s[0]).toBe(11) // Jan 2001
    expect(s[13]).toBe(21) // Feb 2002
    expect(s[287]).toBe(121) // Dec 2024
    expect(cellSeriesFromTile(v, 60, 190)[0]).toBe(1) // other cell: climatology 0
  })
})

describe('grid helpers', () => {
  it('maps row 0 to the north and col 0 to the west', () => {
    expect(rowToLat(0)).toBe(89.5)
    expect(colToLon(0)).toBe(-179.5)
  })
  it('round-trips lat/lon to row/col', () => {
    expect(latToRow(23.5)).toBe(66)
    expect(lonToCol(12.5)).toBe(192)
    expect(rowToLat(latToRow(23.5))).toBe(23.5)
    expect(cellIndex(1, 2)).toBe(362)
  })
  it('builds tile ids', () => {
    expect(tileIdFor(66, 192)).toBe('r060_c190')
  })
  it('extracts a cell series from a tile', () => {
    const tile = new Float32Array(288 * 100).map((_, i) => i)
    const s = cellSeriesFromTile(tile, 61, 193)
    expect(s[0]).toBe(1 * 10 + 3)
    expect(s[1]).toBe(100 + 13)
  })
})
