// High-resolution, coastline-clipped rendering for the Discovery map (P09).
//
// The contract grid is equirectangular (360 x 180 cell centres). We render it
// at PIXELS_PER_DEG pixels per degree so the canvas is smooth at map zoom, then
// clip the result to the Natural Earth land polygons. Continuous layers use
// bilinear interpolation between valid neighbours; class layers stay crisp.
import type { FeatureCollection, Geometry, Position } from 'geojson'
import { N_COLS, N_ROWS, QUALITY_STEP, QUALITY_STEP_KNOWN_FORCING } from '../data/contract'
import { MERCATOR_LAT_LIMIT, type Rgba } from './gridImage'

/** 8 px per 1° cell: 2880 x 1440 for the global grid. */
export const PIXELS_PER_DEG = 8
export const QUALITY_HATCH_ALPHA = 205

export type PolygonRings = Position[][]

export function gridCanvasSize(pixelsPerDegree: number = PIXELS_PER_DEG): { width: number; height: number } {
  return { width: N_COLS * pixelsPerDegree, height: N_ROWS * pixelsPerDegree }
}

/**
 * Bilinear sample at cell-index coordinates (integer = cell centre).
 * If a neighbour with non-zero weight is NaN, the sample is NaN: gaps never
 * blend into a colour. Coordinates are clamped at the grid edge.
 */
export function bilinearValue(
  values: ArrayLike<number>,
  x: number,
  y: number,
  width: number = N_COLS,
  height: number = N_ROWS,
): number {
  if (values.length !== width * height) {
    throw new Error(`bilinearValue: expected ${width * height} values, got ${values.length}`)
  }
  return bilinearCore(values, x, y, width, height)
}

function bilinearCore(
  values: ArrayLike<number>,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const cx = Math.max(0, Math.min(width - 1, x))
  const cy = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const w00 = (1 - fx) * (1 - fy)
  const w10 = fx * (1 - fy)
  const w01 = (1 - fx) * fy
  const w11 = fx * fy
  const v00 = values[y0 * width + x0] ?? Number.NaN
  const v10 = values[y0 * width + x1] ?? Number.NaN
  const v01 = values[y1 * width + x0] ?? Number.NaN
  const v11 = values[y1 * width + x1] ?? Number.NaN
  if ((w00 > 0 && !Number.isFinite(v00)) || (w10 > 0 && !Number.isFinite(v10))) return Number.NaN
  if ((w01 > 0 && !Number.isFinite(v01)) || (w11 > 0 && !Number.isFinite(v11))) return Number.NaN
  const weight = w00 + w10 + w01 + w11
  if (weight <= 0) return Number.NaN
  let total = 0
  if (w00 > 0) total += v00 * w00
  if (w10 > 0) total += v10 * w10
  if (w01 > 0) total += v01 * w01
  if (w11 > 0) total += v11 * w11
  return total / weight
}

/** Bilinear continuous layer at canvas resolution. */
export function renderContinuousImage(
  values: ArrayLike<number>,
  colour: (value: number, index: number) => Rgba,
  pixelsPerDegree: number = PIXELS_PER_DEG,
): ImageData {
  const { width, height } = gridCanvasSize(pixelsPerDegree)
  if (values.length !== N_ROWS * N_COLS) {
    throw new Error(`renderContinuousImage: expected ${N_ROWS * N_COLS} values, got ${values.length}`)
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const cellY = (y + 0.5) / pixelsPerDegree - 0.5
    const row = Math.min(N_ROWS - 1, Math.max(0, Math.floor(cellY + 0.5)))
    for (let x = 0; x < width; x++) {
      const cellX = (x + 0.5) / pixelsPerDegree - 0.5
      const col = Math.min(N_COLS - 1, Math.max(0, Math.floor(cellX + 0.5)))
      const value = bilinearCore(values, cellX, cellY, N_COLS, N_ROWS)
      if (!Number.isFinite(value)) continue
      const [red, green, blue, alpha] = colour(value, row * N_COLS + col)
      const offset = (y * width + x) * 4
      data[offset] = red
      data[offset + 1] = green
      data[offset + 2] = blue
      data[offset + 3] = alpha
    }
  }
  return new ImageData(data, width, height)
}

/** Nearest-cell class layer: crisp edges, no interpolation. */
export function renderClassImage(
  values: ArrayLike<number>,
  colour: (value: number, index: number) => Rgba,
  pixelsPerDegree: number = PIXELS_PER_DEG,
): ImageData {
  if (values.length !== N_ROWS * N_COLS) {
    throw new Error(`renderClassImage: expected ${N_ROWS * N_COLS} values, got ${values.length}`)
  }
  const { width, height } = gridCanvasSize(pixelsPerDegree)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = Math.min(N_ROWS - 1, Math.floor(y / pixelsPerDegree))
    for (let x = 0; x < width; x++) {
      const col = Math.min(N_COLS - 1, Math.floor(x / pixelsPerDegree))
      const index = row * N_COLS + col
      const value = values[index]
      if (!Number.isFinite(value)) continue
      const [red, green, blue, alpha] = colour(value, index)
      const offset = (y * width + x) * 4
      data[offset] = red
      data[offset + 1] = green
      data[offset + 2] = blue
      data[offset + 3] = alpha
    }
  }
  return new ImageData(data, width, height)
}

/**
 * Overlay a diagonal hatch on cells whose quality flag is 1 or 2.
 * The hatch is drawn in canvas pixels, so it stays legible at every zoom while
 * the underlying trend colour remains visible between stripes.
 */
export function applyQualityHatch(
  image: ImageData,
  quality: ArrayLike<number>,
  pixelsPerDegree: number = PIXELS_PER_DEG,
): ImageData {
  if (quality.length !== N_ROWS * N_COLS) {
    throw new Error(`applyQualityHatch: expected ${N_ROWS * N_COLS} values, got ${quality.length}`)
  }
  const data = image.data
  const stripePeriod = Math.max(4, Math.round(pixelsPerDegree / 2))
  const stripeWidth = Math.max(1, Math.round(stripePeriod / 2))
  for (let row = 0; row < N_ROWS; row++) {
    for (let col = 0; col < N_COLS; col++) {
      const flag = quality[row * N_COLS + col]
      if (flag !== QUALITY_STEP && flag !== QUALITY_STEP_KNOWN_FORCING) continue
      const tone: Rgba = flag === QUALITY_STEP_KNOWN_FORCING ? [122, 43, 13, QUALITY_HATCH_ALPHA] : [24, 28, 34, QUALITY_HATCH_ALPHA]
      for (let y = row * pixelsPerDegree; y < (row + 1) * pixelsPerDegree; y++) {
        for (let x = col * pixelsPerDegree; x < (col + 1) * pixelsPerDegree; x++) {
          if ((x + y) % stripePeriod >= stripeWidth) continue
          const offset = (y * image.width + x) * 4
          const alpha = tone[3] / 255
          data[offset] = data[offset] * (1 - alpha) + tone[0] * alpha
          data[offset + 1] = data[offset + 1] * (1 - alpha) + tone[1] * alpha
          data[offset + 2] = data[offset + 2] * (1 - alpha) + tone[2] * alpha
          data[offset + 3] = Math.max(data[offset + 3], tone[3])
        }
      }
    }
  }
  return image
}

export function renderQualityImage(
  trend: ArrayLike<number>,
  quality: ArrayLike<number>,
  colour: (value: number, index: number) => Rgba,
  pixelsPerDegree: number = PIXELS_PER_DEG,
): ImageData {
  return applyQualityHatch(renderClassImage(trend, colour, pixelsPerDegree), quality, pixelsPerDegree)
}

/** Flatten Polygon / MultiPolygon / GeometryCollection features to polygon rings. */
export function landPolygons(collection: FeatureCollection): PolygonRings[] {
  const polygons: PolygonRings[] = []
  const visit = (geometry: Geometry | null): void => {
    if (!geometry) return
    if (geometry.type === 'Polygon') polygons.push(geometry.coordinates)
    else if (geometry.type === 'MultiPolygon') polygons.push(...geometry.coordinates)
    else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(visit)
  }
  for (const feature of collection.features) visit(feature.geometry)
  return polygons
}

/** Longitude/latitude to pixels on the equirectangular canvas. */
export function lonLatToPixel(
  lon: number,
  lat: number,
  width: number,
  height: number,
): [number, number] {
  return [((lon + 180) / 360) * width, ((90 - lat) / 180) * height]
}

/** Land rings in canvas pixels (pure, testable). */
export type PixelPolygon = Array<Array<[number, number]>>

export function landPixelPolygons(
  collection: FeatureCollection,
  width: number,
  height: number,
): PixelPolygon[] {
  return landPolygons(collection).map((polygon) =>
    polygon.map((ring) =>
      ring.map((position) => lonLatToPixel(position[0] ?? 0, position[1] ?? 0, width, height)),
    ),
  )
}

const pathCache = new WeakMap<FeatureCollection, Map<string, Path2D>>()

export function landPath(collection: FeatureCollection, width: number, height: number): Path2D {
  let cache = pathCache.get(collection)
  if (!cache) {
    cache = new Map()
    pathCache.set(collection, cache)
  }
  const key = `${width}x${height}`
  const cached = cache.get(key)
  if (cached) return cached
  const path = new Path2D()
  for (const polygon of landPixelPolygons(collection, width, height)) {
    for (const ring of polygon) {
      if (ring.length === 0) continue
      path.moveTo(ring[0][0], ring[0][1])
      for (let index = 1; index < ring.length; index++) path.lineTo(ring[index][0], ring[index][1])
      path.closePath()
    }
  }
  cache.set(key, path)
  return path
}

/** Put an ImageData on a canvas and keep only pixels inside the land polygons. */
export function clipImageToLand(image: ImageData, collection: FeatureCollection): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the map canvas.')
  context.putImageData(image, 0, 0)
  const path = landPath(collection, image.width, image.height)
  context.save()
  context.globalCompositeOperation = 'destination-in'
  context.fillStyle = '#fff'
  context.fill(path)
  context.restore()
  return canvas
}

/** Web Mercator y for a latitude, with y growing south. */
function mercatorY(latitude: number): number {
  const radians = (latitude * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + radians / 2))
}

function inverseMercator(y: number): number {
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI
}

/**
 * Project an equirectangular rgba image to a square Web Mercator canvas whose
 * vertical extent is ±MERCATOR_LAT_LIMIT. Used only in flat-map mode.
 */
export function projectEquirectToMercator(
  source: ImageData,
  latLimit: number = MERCATOR_LAT_LIMIT,
): ImageData {
  const size = source.width
  const north = mercatorY(latLimit)
  const south = mercatorY(-latLimit)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    const fraction = (y + 0.5) / size
    const latitude = inverseMercator(north + fraction * (south - north))
    const sourceY = Math.min(source.height - 1, Math.max(0, Math.round(((90 - latitude) / 180) * source.height - 0.5)))
    for (let x = 0; x < size; x++) {
      const sourceX = Math.min(source.width - 1, Math.max(0, Math.round(((x + 0.5) / size) * source.width - 0.5)))
      const from = (sourceY * source.width + sourceX) * 4
      const to = (y * size + x) * 4
      data[to] = source.data[from]
      data[to + 1] = source.data[from + 1]
      data[to + 2] = source.data[from + 2]
      data[to + 3] = source.data[from + 3]
    }
  }
  return new ImageData(data, size, size)
}
