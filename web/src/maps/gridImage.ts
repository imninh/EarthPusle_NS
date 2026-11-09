// One pixel per grid cell. Row 0 is the top (north) and column 0 is the left (west).
import {
  INSUFFICIENT_DATA,
  N_COLS,
  N_ROWS,
  OUTSIDE_DOMAIN,
  PATTERN_COOLING_DRYING,
  PATTERN_COOLING_WETTING,
  PATTERN_MIXED,
  PATTERN_WARMING_DRYING,
  PATTERN_WARMING_WETTING,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
} from '../data/contract'

export type Rgba = [number, number, number, number]

export interface ClassPalette {
  increase: Rgba
  decrease: Rgba
  neutral: Rgba
  insufficientA: Rgba
  insufficientB: Rgba
  warmingDrying: Rgba
  warmingWetting: Rgba
  coolingDrying: Rgba
  coolingWetting: Rgba
  mixed: Rgba
}

/** Finite cells with q at or above the threshold are drawn at this opacity on the rate layer. */
export const NOT_SIGNIFICANT_OPACITY = 0.35

export function gridImage(
  values: ArrayLike<number>,
  colour: (value: number, index: number) => Rgba,
  width: number = N_COLS,
  height: number = N_ROWS,
): ImageData {
  if (values.length !== width * height) {
    throw new Error(`gridImage: expected ${width * height} values, got ${values.length}`)
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!Number.isFinite(value)) continue
    const [red, green, blue, alpha] = colour(value, index)
    const offset = index * 4
    data[offset] = red
    data[offset + 1] = green
    data[offset + 2] = blue
    data[offset + 3] = alpha
  }
  return new ImageData(data, width, height)
}

export function trendColour(code: number, palette: ClassPalette, index: number, width: number = N_COLS): Rgba {
  if (code === TREND_INCREASE) return palette.increase
  if (code === TREND_DECREASE) return palette.decrease
  if (code === TREND_NOT_SIGNIFICANT) return palette.neutral
  if (code === INSUFFICIENT_DATA) return hatch(palette, index, width)
  return [0, 0, 0, 0]
}

export function patternColour(code: number, palette: ClassPalette, index: number, width: number = N_COLS): Rgba {
  if (code === PATTERN_WARMING_DRYING) return palette.warmingDrying
  if (code === PATTERN_WARMING_WETTING) return palette.warmingWetting
  if (code === PATTERN_COOLING_DRYING) return palette.coolingDrying
  if (code === PATTERN_COOLING_WETTING) return palette.coolingWetting
  if (code === PATTERN_MIXED) return palette.mixed
  if (code === INSUFFICIENT_DATA) return hatch(palette, index, width)
  if (code === OUTSIDE_DOMAIN) return [0, 0, 0, 0]
  return [0, 0, 0, 0]
}

function hatch(palette: ClassPalette, index: number, width: number): Rgba {
  const row = Math.floor(index / width)
  const col = index % width
  return (row + col) % 2 === 0 ? palette.insufficientA : palette.insufficientB
}

/** Symmetric diverging colour. `limit` is the absolute value that maps to a fully saturated end. */
export function divergingColour(
  value: number,
  limit: number,
  negative: Rgba,
  positive: Rgba,
  mid: Rgba,
  alpha: number,
): Rgba {
  const span = limit > 0 ? limit : 1
  const t = Math.max(-1, Math.min(1, value / span))
  const mixed = t >= 0 ? mix(mid, positive, t) : mix(mid, negative, -t)
  return [mixed[0], mixed[1], mixed[2], alpha]
}

/** `t` of 0 is `start`, `t` of 1 is `end`. Values outside 0..1 are clamped. */
export function sequentialColour(value: number, start: Rgba, end: Rgba): Rgba {
  const t = Math.max(0, Math.min(1, value))
  return mix(start, end, t)
}

export function rateAlpha(q: number, qThreshold: number): number {
  const significant = Number.isFinite(q) && q < qThreshold
  return significant ? 255 : Math.round(NOT_SIGNIFICANT_OPACITY * 255)
}

/**
 * Nearest-rank percentile of absolute values among finite cells.
 * Index is `ceil(percentile * n) - 1` on the ascending list. Empty input or a
 * zero result returns 1 so a diverging scale stays defined.
 */
export function finiteAbsPercentile(values: ArrayLike<number>, percentile = 0.98): number {
  const absolute: number[] = []
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (Number.isFinite(value)) absolute.push(Math.abs(value))
  }
  if (absolute.length === 0) return 1
  absolute.sort((a, b) => a - b)
  const rank = Math.min(absolute.length - 1, Math.max(0, Math.ceil(percentile * absolute.length) - 1))
  const found = absolute[rank]
  return found > 0 ? found : 1
}

/** Web Mercator latitude where the projected y is ±π. A corner at ±90° does not tile. */
export const MERCATOR_LAT_LIMIT = 85.0511287798

/**
 * Place a plate-carrée grid onto a canvas whose rows match Web Mercator.
 * Corners of the result are ±MERCATOR_LAT_LIMIT. Equator rows stay one pixel
 * tall; polar rows are repeated so a click's latitude hits the same cell.
 */
export function projectGridToMercator(source: ImageData): ImageData {
  const srcWidth = source.width
  const srcHeight = source.height
  const dstWidth = srcWidth
  const dstHeight = srcWidth
  const north = mercatorY(MERCATOR_LAT_LIMIT)
  const south = mercatorY(-MERCATOR_LAT_LIMIT)
  const dst = new ImageData(new Uint8ClampedArray(dstWidth * dstHeight * 4), dstWidth, dstHeight)
  for (let y = 0; y < dstHeight; y++) {
    const fraction = (y + 0.5) / dstHeight
    const latitude = inverseMercator(north + fraction * (south - north))
    const row = Math.min(srcHeight - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * srcHeight)))
    for (let x = 0; x < dstWidth; x++) {
      const column = Math.min(srcWidth - 1, Math.floor((x / dstWidth) * srcWidth))
      const from = (row * srcWidth + column) * 4
      const to = (y * dstWidth + x) * 4
      dst.data[to] = source.data[from]
      dst.data[to + 1] = source.data[from + 1]
      dst.data[to + 2] = source.data[from + 2]
      dst.data[to + 3] = source.data[from + 3]
    }
  }
  return dst
}

function mercatorY(latitude: number): number {
  const radians = (latitude * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + radians / 2))
}

function inverseMercator(y: number): number {
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI
}

function mix(from: Rgba, to: Rgba, t: number): Rgba {
  const clamped = Math.max(0, Math.min(1, t))
  return [
    from[0] + (to[0] - from[0]) * clamped,
    from[1] + (to[1] - from[1]) * clamped,
    from[2] + (to[2] - from[2]) * clamped,
    from[3] + (to[3] - from[3]) * clamped,
  ]
}
