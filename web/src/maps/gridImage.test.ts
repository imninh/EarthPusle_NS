import { describe, expect, it } from 'vitest'
import {
  INSUFFICIENT_DATA,
  N_COLS,
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
import {
  type ClassPalette,
  finiteAbsPercentile,
  gridImage,
  patternColour,
  projectGridToMercator,
  rateAlpha,
  trendColour,
} from './gridImage'

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

const palette: ClassPalette = {
  increase: [192, 57, 43, 255],
  decrease: [36, 113, 163, 255],
  neutral: [200, 204, 210, 255],
  insufficientA: [213, 216, 222, 255],
  insufficientB: [154, 163, 175, 255],
  warmingDrying: [194, 65, 12, 255],
  warmingWetting: [15, 118, 110, 255],
  coolingDrying: [124, 58, 237, 255],
  coolingWetting: [3, 105, 161, 255],
  mixed: [107, 114, 128, 255],
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]]
}

describe('gridImage', () => {
  it('maps row 0 to the top of the image and col 0 to the left', () => {
    const width = 3
    const height = 2
    const values = new Float32Array([10, 20, 30, 40, 50, 60])
    const image = gridImage(values, (value) => [value, 0, 0, 255], width, height)
    expect(image.width).toBe(width)
    expect(image.height).toBe(height)
    expect(pixel(image, 0, 0)).toEqual([10, 0, 0, 255])
    expect(pixel(image, 1, 0)).toEqual([20, 0, 0, 255])
    expect(pixel(image, 0, 1)).toEqual([40, 0, 0, 255])
    expect(pixel(image, 2, 1)).toEqual([60, 0, 0, 255])
  })

  it('makes NaN transparent and does not ask the colour function to handle it', () => {
    const values = new Float32Array([1, Number.NaN, 3, Number.NaN])
    const image = gridImage(
      values,
      (value) => {
        if (!Number.isFinite(value)) throw new Error('colour called for a non-finite value')
        return [value, 2, 3, 255]
      },
      2,
      2,
    )
    expect(pixel(image, 0, 0)).toEqual([1, 2, 3, 255])
    expect(pixel(image, 1, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(image, 1, 1)).toEqual([0, 0, 0, 0])
  })

  it('maps trend class codes to the expected colours', () => {
    const codes = new Int8Array([
      TREND_INCREASE,
      TREND_DECREASE,
      TREND_NOT_SIGNIFICANT,
      INSUFFICIENT_DATA,
      INSUFFICIENT_DATA,
      OUTSIDE_DOMAIN,
    ])
    const image = gridImage(codes, (value, index) => trendColour(value, palette, index, codes.length), codes.length, 1)
    expect(pixel(image, 0, 0)).toEqual(palette.increase)
    expect(pixel(image, 1, 0)).toEqual(palette.decrease)
    expect(pixel(image, 2, 0)).toEqual(palette.neutral)
    expect(pixel(image, 3, 0)).toEqual(palette.insufficientB)
    expect(pixel(image, 4, 0)).toEqual(palette.insufficientA)
    expect(pixel(image, 5, 0)).toEqual([0, 0, 0, 0])
  })

  it('maps pattern class codes to the expected colours', () => {
    const codes = new Int8Array([
      PATTERN_WARMING_DRYING,
      PATTERN_WARMING_WETTING,
      PATTERN_COOLING_DRYING,
      PATTERN_COOLING_WETTING,
      PATTERN_MIXED,
      INSUFFICIENT_DATA,
      OUTSIDE_DOMAIN,
    ])
    const image = gridImage(codes, (value, index) => patternColour(value, palette, index, codes.length), codes.length, 1)
    expect(pixel(image, 0, 0)).toEqual(palette.warmingDrying)
    expect(pixel(image, 1, 0)).toEqual(palette.warmingWetting)
    expect(pixel(image, 2, 0)).toEqual(palette.coolingDrying)
    expect(pixel(image, 3, 0)).toEqual(palette.coolingWetting)
    expect(pixel(image, 4, 0)).toEqual(palette.mixed)
    expect(pixel(image, 5, 0)[3]).toBe(255)
    expect(pixel(image, 6, 0)).toEqual([0, 0, 0, 0])
  })

  it('places a northern cell in the first image row of the contract grid', () => {
    const values = new Int8Array(N_COLS * 2)
    values.fill(OUTSIDE_DOMAIN)
    values[0] = TREND_INCREASE
    values[N_COLS] = TREND_DECREASE
    const image = gridImage(values, (value, index) => trendColour(value, palette, index, N_COLS), N_COLS, 2)
    expect(pixel(image, 0, 0)).toEqual([...palette.increase])
    expect(pixel(image, 0, 1)).toEqual([...palette.decrease])
  })
})

describe('projectGridToMercator', () => {
  it('keeps the equator near the middle and clips the pole below the top row', () => {
    const width = 180
    const height = 180
    const data = new Uint8ClampedArray(width * height * 4)
    for (let row = 0; row < height; row++) data[row * width * 4] = row
    const image = projectGridToMercator(new ImageData(data, width, height))
    const top = pixel(image, 0, 0)[0]
    const middle = pixel(image, 0, Math.floor(image.height / 2))[0]
    expect(image.height).toBe(width)
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(12)
    expect(middle).toBeGreaterThan(85)
    expect(middle).toBeLessThan(95)
  })
})

describe('rate scale', () => {
  it('takes the 98th percentile of finite absolute values', () => {
    const values = new Float32Array([Number.NaN, 1, -2, 3])
    expect(finiteAbsPercentile(values, 0.98)).toBe(3)
    expect(finiteAbsPercentile(new Float32Array([0, Number.NaN]), 0.98)).toBe(1)
  })

  it('draws q at or above the threshold at 35% opacity', () => {
    expect(rateAlpha(0.04, 0.05)).toBe(255)
    expect(rateAlpha(0.05, 0.05)).toBe(89)
    expect(rateAlpha(Number.NaN, 0.05)).toBe(89)
  })
})
