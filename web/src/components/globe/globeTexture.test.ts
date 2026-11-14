import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { INSUFFICIENT_DATA, N_COLS, N_ROWS, OUTSIDE_DOMAIN } from '../../data/contract'
import {
  FALLBACK_COLOURS,
  LAND_BASE_COLOUR,
  NEUTRAL_LIGHTNESS,
  classifyCell,
  paintCellLayer,
  parseCssColour,
  rgbToHex,
  scaleLightness,
  unwrapRing,
  wrappedLandRings,
  type GlobeColours,
  type Rgb,
} from './globeTexture'

// SYNTHETIC grid (not real data): 180 x 360, one cell per pixel, built only for these tests.
const colours: GlobeColours = {
  increase: parseCssColour(FALLBACK_COLOURS.increase) as Rgb,
  decrease: parseCssColour(FALLBACK_COLOURS.decrease) as Rgb,
  marker: parseCssColour(FALLBACK_COLOURS.marker) as Rgb,
  onNight: parseCssColour(FALLBACK_COLOURS.onNight) as Rgb,
}

const at = (row: number, col: number) => row * N_COLS + col

function syntheticGrid() {
  const trend = new Int8Array(N_ROWS * N_COLS).fill(OUTSIDE_DOMAIN)
  const flag = new Int8Array(N_ROWS * N_COLS).fill(OUTSIDE_DOMAIN)
  trend[at(10, 10)] = 1 // increase, clean
  flag[at(10, 10)] = 0
  trend[at(10, 11)] = -1 // decrease, clean
  flag[at(10, 11)] = 0
  trend[at(10, 12)] = 1 // increase, flagged
  flag[at(10, 12)] = 1
  trend[at(10, 13)] = 0 // not significant
  flag[at(10, 13)] = 0
  trend[at(10, 14)] = 0 // not significant, flagged: stays neutral
  flag[at(10, 14)] = 2
  trend[at(10, 15)] = INSUFFICIENT_DATA
  return { trend, flag }
}

function pixel(buf: { data: Uint8ClampedArray; width: number }, x: number, y: number) {
  const o = (y * buf.width + x) * 4
  return [buf.data[o], buf.data[o + 1], buf.data[o + 2], buf.data[o + 3]]
}

describe('classifyCell', () => {
  it('follows the legend', () => {
    expect(classifyCell(1, 0)).toBe('increase')
    expect(classifyCell(-1, 0)).toBe('decrease')
    expect(classifyCell(1, 1)).toBe('flagged')
    expect(classifyCell(-1, 2)).toBe('flagged')
    expect(classifyCell(0, 2)).toBe('neutral')
    expect(classifyCell(1, null)).toBe('increase')
    expect(classifyCell(INSUFFICIENT_DATA, 0)).toBe('none')
    expect(classifyCell(OUTSIDE_DOMAIN, 0)).toBe('none')
  })
})

describe('paintCellLayer (synthetic grid)', () => {
  const { trend, flag } = syntheticGrid()
  const buf = paintCellLayer(trend, flag, colours, N_COLS, N_ROWS)

  it('paints an increase cell with the increase colour', () => {
    expect(pixel(buf, 10, 10)).toEqual([...colours.increase, 255])
  })
  it('paints a decrease cell with the decrease colour', () => {
    expect(pixel(buf, 11, 10)).toEqual([...colours.decrease, 255])
  })
  it('paints a flagged significant cell with the marker colour', () => {
    expect(pixel(buf, 12, 10)).toEqual([...colours.marker, 255])
  })
  it('paints a not significant cell as lighter land, without colour', () => {
    const land = parseCssColour(LAND_BASE_COLOUR) as Rgb
    const lighter = scaleLightness(land, NEUTRAL_LIGHTNESS)
    expect(pixel(buf, 13, 10)).toEqual([...lighter, 255])
    expect(pixel(buf, 14, 10)).toEqual([...lighter, 255])
    expect(lighter[0] + lighter[1] + lighter[2]).toBeGreaterThan(land[0] + land[1] + land[2])
  })
  it('leaves ocean, outside-domain and insufficient-data pixels transparent', () => {
    expect(pixel(buf, 200, 100)[3]).toBe(0)
    expect(pixel(buf, 15, 10)[3]).toBe(0)
  })
  it('maps cells to the texture size', () => {
    const big = paintCellLayer(trend, flag, colours, N_COLS * 2, N_ROWS * 2)
    for (const [x, y] of [[20, 20], [21, 21]]) expect(pixel(big, x, y)).toEqual([...colours.increase, 255])
    expect(pixel(big, 22, 20)).toEqual([...colours.decrease, 255])
  })
  it('rejects a grid of the wrong size', () => {
    expect(() => paintCellLayer(new Int8Array(10), null, colours)).toThrow()
  })
})

describe('colour helpers', () => {
  it('parses hex and rgb()', () => {
    expect(parseCssColour('#0f2340')).toEqual([15, 35, 64])
    expect(parseCssColour(' #fff ')).toEqual([255, 255, 255])
    expect(parseCssColour('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(parseCssColour('nonsense')).toBeNull()
    expect(parseCssColour('')).toBeNull()
  })
  it('round-trips hex', () => {
    expect(rgbToHex([15, 35, 64])).toBe('#0f2340')
  })
})

describe('antimeridian rings (synthetic)', () => {
  // SYNTHETIC ring crossing the antimeridian, like Fiji: 178 E -> 179.5 E -> 179.5 W -> 178 W.
  const ring = [[178, -17], [179.5, -17], [-179.5, -17], [-178, -17], [-178, -18], [178, -18], [178, -17]]
  it('unwraps longitudes so no step exceeds 180 degrees', () => {
    const out = unwrapRing(ring)
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i][0] - out[i - 1][0])).toBeLessThanOrEqual(180)
    expect(out[2][0]).toBeCloseTo(180.5, 9)
    expect(out[3][0]).toBeCloseTo(182, 9)
  })
  it('never draws a segment that jumps across the map', () => {
    const land = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }],
    } as FeatureCollection
    const rings = wrappedLandRings(land, 2048, 1024)
    expect(rings.length).toBe(2) // the part east of 180 re-enters on the west edge
    for (const r of rings) for (let i = 1; i < r.length; i++) expect(Math.abs(r[i][0] - r[i - 1][0])).toBeLessThan(1024)
  })
})
