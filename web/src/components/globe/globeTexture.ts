// Builds the equirectangular texture of the globe (docs/UI_SPEC.md §3).
//
// Pure part (testable in node): colour parsing, cell classification and `paintCellLayer`, which
// returns RGBA pixels. DOM part: `buildGlobeCanvas` composes ocean, land, the land-clipped cell
// layer and coastlines on a 2048 x 1024 canvas.
import type { FeatureCollection } from 'geojson'
import { N_COLS, N_ROWS, TREND_DECREASE, TREND_INCREASE, TREND_NOT_SIGNIFICANT } from '../../data/contract'
import { landPolygons, lonLatToPixel } from '../../maps/renderGrid'

export const GLOBE_TEXTURE_WIDTH = 2048
export const GLOBE_TEXTURE_HEIGHT = 1024
export const OCEAN_COLOUR = '#0f2340'
export const LAND_BASE_COLOUR = '#24395c'
export const COAST_COLOUR = 'rgba(234,241,251,0.35)'
/** Lightness factor of "not significant" land (no colour, only a lighter land). */
export const NEUTRAL_LIGHTNESS = 1.25

export type Rgb = [number, number, number]

/** Fallback values of docs/DESIGN.md, used when a CSS variable is missing. */
export const FALLBACK_COLOURS = {
  // The DESIGN.md dark values, which read best on night; same as the defaults on `.globe`.
  increase: '#ef7d63',
  decrease: '#6db3ea',
  marker: '#f2c230',
  onNight: '#eaf1fb',
} as const

export interface GlobeColours {
  increase: Rgb
  decrease: Rgb
  marker: Rgb
  onNight: Rgb
}

/** Parse `#rgb`, `#rrggbb` or `rgb(r, g, b)` / `rgb(r g b)`. Returns null when not understood. */
export function parseCssColour(text: string | null | undefined): Rgb | null {
  if (!text) return null
  const value = text.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ]
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(value)
  if (rgb) return [Math.round(+rgb[1]), Math.round(+rgb[2]), Math.round(+rgb[3])]
  return null
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`
}

/** Multiply the HSL lightness of a colour by `factor` (capped at 1). */
export function scaleLightness([r, g, b]: Rgb, factor: number): Rgb {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  const l2 = Math.min(1, l * factor)
  const c = (1 - Math.abs(2 * l2 - 1)) * s
  const hue = (n: number) => {
    const k = (n + h * 12) % 12
    return l2 - (c / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [Math.round(hue(0) * 255), Math.round(hue(8) * 255), Math.round(hue(4) * 255)]
}

/** The colour of a CSS variable on `element`, trying each name in turn, else the fallback. */
function readColour(style: CSSStyleDeclaration, names: string[], fallback: string): Rgb {
  for (const name of names) {
    const parsed = parseCssColour(style.getPropertyValue(name))
    if (parsed) return parsed
  }
  return parseCssColour(fallback) as Rgb
}

/**
 * Read the globe colours from CSS variables at runtime (`--globe-increase` / `--globe-decrease`
 * may override `--increase` / `--decrease` for the night surface), falling back to DESIGN.md.
 */
export function readGlobeColours(element?: Element): GlobeColours {
  // Default: a probe with the `.globe` class, so the defaults defined on the component root in
  // globe.css apply (the legend swatches use the same variables, so they always match).
  let probe: HTMLElement | null = null
  if (!element) {
    probe = document.createElement('div')
    probe.className = 'globe'
    probe.style.display = 'none'
    document.body.appendChild(probe)
  }
  try {
    return readColoursFrom(getComputedStyle(element ?? (probe as HTMLElement)))
  } finally {
    probe?.remove()
  }
}

function readColoursFrom(style: CSSStyleDeclaration): GlobeColours {
  return {
    increase: readColour(style, ['--globe-increase', '--increase'], FALLBACK_COLOURS.increase),
    decrease: readColour(style, ['--globe-decrease', '--decrease'], FALLBACK_COLOURS.decrease),
    marker: readColour(style, ['--marker'], FALLBACK_COLOURS.marker),
    onNight: readColour(style, ['--on-night'], FALLBACK_COLOURS.onNight),
  }
}

export type CellClass = 'increase' | 'decrease' | 'flagged' | 'neutral' | 'none'

/**
 * Class of a cell. Significant trend: increase or decrease; significant **and** flagged
 * (quality flag >= 1): flagged. Evaluated but not significant: neutral. Anything else
 * (insufficient data, outside the domain): none.
 */
export function classifyCell(trend: number, flag: number | undefined | null): CellClass {
  if (trend === TREND_INCREASE || trend === TREND_DECREASE) {
    if (flag != null && flag >= 1) return 'flagged'
    return trend === TREND_INCREASE ? 'increase' : 'decrease'
  }
  if (trend === TREND_NOT_SIGNIFICANT) return 'neutral'
  return 'none'
}

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * RGBA pixels of the cell layer (transparent where there is nothing to draw). Cells are sampled
 * by nearest cell, so the layer is crisp and every colour is exactly the legend colour.
 */
export function paintCellLayer(
  trendClass: ArrayLike<number>,
  qualityFlag: ArrayLike<number> | null | undefined,
  colours: GlobeColours,
  width: number = GLOBE_TEXTURE_WIDTH,
  height: number = GLOBE_TEXTURE_HEIGHT,
): PixelBuffer {
  if (trendClass.length !== N_ROWS * N_COLS) {
    throw new Error(`paintCellLayer: expected ${N_ROWS * N_COLS} trend values, got ${trendClass.length}`)
  }
  if (qualityFlag && qualityFlag.length !== N_ROWS * N_COLS) {
    throw new Error(`paintCellLayer: expected ${N_ROWS * N_COLS} quality values, got ${qualityFlag.length}`)
  }
  const land = parseCssColour(LAND_BASE_COLOUR) as Rgb
  const palette: Record<Exclude<CellClass, 'none'>, Rgb> = {
    increase: colours.increase,
    decrease: colours.decrease,
    flagged: colours.marker,
    neutral: scaleLightness(land, NEUTRAL_LIGHTNESS),
  }
  // One RGBA entry per cell, so the per-pixel loop is a lookup.
  const cellRgba = new Uint8ClampedArray(N_ROWS * N_COLS * 4)
  for (let i = 0; i < N_ROWS * N_COLS; i++) {
    const cls = classifyCell(trendClass[i], qualityFlag ? qualityFlag[i] : null)
    if (cls === 'none') continue
    const [r, g, b] = palette[cls]
    cellRgba[i * 4] = r
    cellRgba[i * 4 + 1] = g
    cellRgba[i * 4 + 2] = b
    cellRgba[i * 4 + 3] = 255
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = Math.min(N_ROWS - 1, Math.floor((y * N_ROWS) / height))
    for (let x = 0; x < width; x++) {
      const col = Math.min(N_COLS - 1, Math.floor((x * N_COLS) / width))
      const from = (row * N_COLS + col) * 4
      if (cellRgba[from + 3] === 0) continue
      const to = (y * width + x) * 4
      data[to] = cellRgba[from]
      data[to + 1] = cellRgba[from + 1]
      data[to + 2] = cellRgba[from + 2]
      data[to + 3] = 255
    }
  }
  return { data, width, height }
}

/**
 * Make consecutive longitudes of a ring differ by at most 180 degrees (adding multiples of 360), so a
 * polygon that crosses the antimeridian (Fiji, Chukotka) is one continuous shape instead of a
 * segment that jumps across the whole map.
 */
export function unwrapRing(ring: ReadonlyArray<ReadonlyArray<number>>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let offset = 0
  let previous = 0
  ring.forEach((position, index) => {
    const lon = position[0] ?? 0
    const lat = position[1] ?? 0
    if (index > 0) {
      const jump = lon - previous
      if (jump > 180) offset -= 360
      else if (jump < -180) offset += 360
    }
    previous = lon
    out.push([lon + offset, lat])
  })
  return out
}

/**
 * Land rings in canvas pixels, unwrapped across the antimeridian and repeated one map width to the
 * west and east, so the part that leaves the texture on one side re-enters on the other.
 */
export function wrappedLandRings(
  land: FeatureCollection,
  width: number,
  height: number,
): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = []
  for (const polygon of landPolygons(land)) {
    for (const ring of polygon) {
      if (ring.length === 0) continue
      const pixels = unwrapRing(ring).map(([lon, lat]) => lonLatToPixel(lon, lat, width, height))
      let minX = Infinity
      let maxX = -Infinity
      for (const [x] of pixels) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
      for (const shift of [-width, 0, width]) {
        if (maxX + shift < 0 || minX + shift > width) continue // cannot touch the canvas
        rings.push(pixels.map(([x, y]) => [x + shift, y] as [number, number]))
      }
    }
  }
  return rings
}

function wrappedLandPath(land: FeatureCollection, width: number, height: number): Path2D {
  const path = new Path2D()
  for (const ring of wrappedLandRings(land, width, height)) {
    path.moveTo(ring[0][0], ring[0][1])
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1])
    path.closePath()
  }
  return path
}

/**
 * The 2048 x 1024 equirectangular canvas: ocean, land base, cells clipped to land, coastlines.
 * No lighting and no labels: what is drawn here is what the legend says.
 */
export function buildGlobeCanvas(
  trendClass: ArrayLike<number>,
  qualityFlag: ArrayLike<number> | null | undefined,
  land: FeatureCollection,
  colours: GlobeColours,
  width: number = GLOBE_TEXTURE_WIDTH,
  height: number = GLOBE_TEXTURE_HEIGHT,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the globe texture canvas.')
  context.fillStyle = OCEAN_COLOUR
  context.fillRect(0, 0, width, height)
  const path = wrappedLandPath(land, width, height)
  context.fillStyle = LAND_BASE_COLOUR
  context.fill(path)
  // Cell layer, clipped to the same antimeridian-safe land path.
  const pixels = paintCellLayer(trendClass, qualityFlag, colours, width, height)
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const layerContext = layer.getContext('2d')
  if (!layerContext) throw new Error('Could not create the globe texture canvas.')
  layerContext.putImageData(new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  layerContext.globalCompositeOperation = 'destination-in'
  layerContext.fillStyle = '#fff'
  layerContext.fill(path)
  context.drawImage(layer, 0, 0)
  context.strokeStyle = COAST_COLOUR
  context.lineWidth = 1
  context.lineJoin = 'round'
  context.stroke(path)
  return canvas
}
