import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { N_COLS, N_ROWS, QUALITY_STEP, QUALITY_STEP_KNOWN_FORCING } from '../data/contract'
import {
  applyQualityHatch,
  bilinearValue,
  gridCanvasSize,
  landPixelPolygons,
  lonLatToPixel,
  projectEquirectToMercator,
  renderClassImage,
  renderContinuousImage,
  renderQualityImage,
} from './renderGrid'

// Node's vitest environment has no DOM ImageData, and this package cannot add one.
function installImageDataShim(): void {
  if (typeof globalThis.ImageData === 'function') return
  class ImageDataShim {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data
      this.width = width
      this.height = height ?? Math.floor(data.length / (4 * width))
    }
  }
  Object.defineProperty(globalThis, 'ImageData', { value: ImageDataShim, configurable: true, writable: true })
}

installImageDataShim()

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]]
}

describe('bilinearValue', () => {
  it('interpolates a 2 x 2 grid at the centre', () => {
    expect(bilinearValue([1, 2, 3, 4], 0.5, 0.5, 2, 2)).toBe(2.5)
  })

  it('never blends a non-zero weight with NaN', () => {
    expect(Number.isNaN(bilinearValue([1, Number.NaN, 3, 4], 0.25, 0.5, 2, 2))).toBe(true)
    // At the exact centre only the top-left cell has weight.
    expect(bilinearValue([1, Number.NaN, 3, 4], 0, 0, 2, 2)).toBe(1)
  })

  it('clamps samples at the grid edge', () => {
    expect(bilinearValue([1, 2, 3, 4], -5, -5, 2, 2)).toBe(1)
    expect(bilinearValue([1, 2, 3, 4], 99, 99, 2, 2)).toBe(4)
  })
})

describe('high-resolution rendering', () => {
  it('uses the documented 8 px per degree canvas', () => {
    expect(gridCanvasSize()).toEqual({ width: N_COLS * 8, height: N_ROWS * 8 })
  })

  it('renders a continuous field with transparent gaps', () => {
    const values = new Float32Array(N_ROWS * N_COLS).fill(1)
    values[0] = Number.NaN
    const image = renderContinuousImage(values, (value) => [Math.round(value), 0, 0, 255], 1)
    expect(image.width).toBe(N_COLS)
    expect(image.height).toBe(N_ROWS)
    expect(pixel(image, 10, 10)).toEqual([1, 0, 0, 255])
    expect(pixel(image, 0, 0)[3]).toBe(0)
  })

  it('keeps class cells crisp at one pixel per cell', () => {
    const values = new Int8Array(N_ROWS * N_COLS)
    values[0] = 1
    const image = renderClassImage(values, (value) => (value === 1 ? [255, 0, 0, 255] : [0, 0, 0, 0]), 1)
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(image, 1, 0)[3]).toBe(0)
  })

  it('hatches only flagged quality cells', () => {
    const image = new ImageData(new Uint8ClampedArray(N_COLS * N_ROWS * 4), N_COLS, N_ROWS)
    for (let index = 0; index < image.data.length; index += 4) image.data[index + 3] = 255
    const quality = new Int8Array(N_ROWS * N_COLS)
    quality[10 * N_COLS + 10] = QUALITY_STEP
    quality[11 * N_COLS + 10] = QUALITY_STEP_KNOWN_FORCING
    applyQualityHatch(image, quality, 1)
    expect(pixel(image, 10, 10)[3]).toBeGreaterThan(0)
    expect(pixel(image, 11, 10)[3]).toBeGreaterThan(0)
    expect(pixel(image, 12, 12)).toEqual([0, 0, 0, 255])
  })

  it('renders the quality layer over the trend colours', () => {
    const trend = new Int8Array(N_ROWS * N_COLS)
    const quality = new Int8Array(N_ROWS * N_COLS)
    quality[66 * N_COLS + 192] = QUALITY_STEP
    const image = renderQualityImage(trend, quality, () => [10, 20, 30, 255], 1)
    expect(pixel(image, 192, 66)[3]).toBeGreaterThan(0)
  })
})

describe('coastline geometry', () => {
  it('maps longitude/latitude to canvas pixels', () => {
    expect(lonLatToPixel(-180, 90, 360, 180)).toEqual([0, 0])
    expect(lonLatToPixel(180, -90, 360, 180)).toEqual([360, 180])
    expect(lonLatToPixel(0, 0, 360, 180)).toEqual([180, 90])
  })

  it('flattens Polygon and MultiPolygon land features', () => {
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-10, 0],
                [0, 0],
                [0, 10],
                [-10, 0],
              ],
            ],
          },
        },
      ],
    }
    const polygons = landPixelPolygons(collection, 360, 180)
    expect(polygons).toHaveLength(1)
    expect(polygons[0][0].length).toBe(4)
    expect(polygons[0][0][0]).toEqual([170, 90])
  })
})

describe('projectEquirectToMercator', () => {
  it('returns a square image with the equator near the middle', () => {
    const source = new ImageData(new Uint8ClampedArray(360 * 180 * 4), 360, 180)
    for (let index = 0; index < source.data.length; index += 4) {
      source.data[index] = 1
      source.data[index + 3] = 255
    }
    const image = projectEquirectToMercator(source)
    expect(image.width).toBe(360)
    expect(image.height).toBe(360)
    expect(pixel(image, 180, 180)[3]).toBe(255)
  })
})
