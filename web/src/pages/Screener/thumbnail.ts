// Local trend thumbnail. One pixel per cell, row 0 at the top (north), full global grid.
// Does not crop to a region bbox and does not import web/src/maps.
import {
  INSUFFICIENT_DATA,
  N_COLS,
  N_ROWS,
  OUTSIDE_DOMAIN,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
} from '../../data/contract'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface TrendColours {
  increase: Rgba
  decrease: Rgba
  neutral: Rgba
  missing: Rgba
}

/** Fallbacks are the light-theme tokens in index.css, used only if a variable cannot be read. */
const FALLBACK: TrendColours = {
  increase: { r: 192, g: 57, b: 43, a: 255 },
  decrease: { r: 36, g: 113, b: 163, a: 255 },
  neutral: { r: 200, g: 204, b: 210, a: 255 },
  missing: { r: 91, g: 101, b: 115, a: 255 },
}

function parseCssColor(input: string): Rgba | null {
  const value = input.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const raw = hex[1] ?? ''
    const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw
    const parsed = Number.parseInt(full, 16)
    return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255, a: 255 }
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value)
  if (!rgb) return null
  const alphaPart = rgb[4]
  const alpha = alphaPart == null ? 255 : Number(alphaPart) <= 1 ? Math.round(Number(alphaPart) * 255) : Math.round(Number(alphaPart))
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha }
}

export function trendColoursFrom(element: Element): TrendColours {
  const style = getComputedStyle(element)
  const pick = (name: keyof TrendColours, token: string): Rgba => parseCssColor(style.getPropertyValue(token)) ?? FALLBACK[name]
  return {
    increase: pick('increase', '--increase'),
    decrease: pick('decrease', '--decrease'),
    neutral: pick('neutral', '--neutral'),
    missing: pick('missing', '--muted'),
  }
}

function colourFor(code: number, colours: TrendColours): Rgba | null {
  if (code === TREND_INCREASE) return colours.increase
  if (code === TREND_DECREASE) return colours.decrease
  if (code === TREND_NOT_SIGNIFICANT) return colours.neutral
  if (code === INSUFFICIENT_DATA) return colours.missing
  if (code === OUTSIDE_DOMAIN) return null
  return null
}

/** Draw the full N_ROWS × N_COLS trend_class grid. Index 0 is the north-west cell. */
export function paintTrendClass(canvas: HTMLCanvasElement, grid: ArrayLike<number>, colours: TrendColours): void {
  const expected = N_ROWS * N_COLS
  if (grid.length !== expected) {
    throw new Error(`trend thumbnail: expected ${expected} values, got ${grid.length}`)
  }
  canvas.width = N_COLS
  canvas.height = N_ROWS
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not draw the trend thumbnail.')
  const image = context.createImageData(N_COLS, N_ROWS)
  const data = image.data
  for (let index = 0; index < grid.length; index++) {
    const colour = colourFor(grid[index] ?? 0, colours)
    const offset = index * 4
    if (!colour) {
      data[offset + 3] = 0
      continue
    }
    data[offset] = colour.r
    data[offset + 1] = colour.g
    data[offset + 2] = colour.b
    data[offset + 3] = colour.a
  }
  context.putImageData(image, 0, 0)
}
