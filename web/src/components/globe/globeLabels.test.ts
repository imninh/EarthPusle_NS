import { describe, expect, it } from 'vitest'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import {
  MAX_LABEL_LATITUDE,
  countryLabelCandidates,
  countryLabels,
  ringArea,
  ringCentroid,
  unwrapCountryRing,
} from './globeLabels'

function box(
  name: string,
  id: string,
  west: number,
  south: number,
  east: number,
  north: number,
): Feature<Polygon> {
  return {
    type: 'Feature',
    id,
    properties: { name },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  }
}

const collection = (...features: Feature<Polygon>[]): FeatureCollection<Polygon> => ({
  type: 'FeatureCollection',
  features,
})

describe('country rings', () => {
  it('finds the centroid and area of a simple square', () => {
    const square = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ] as Array<[number, number]>
    expect(ringArea(square)).toBeCloseTo(4, 9)
    const [lon, lat] = ringCentroid(square)
    expect(lon).toBeCloseTo(1, 9)
    expect(lat).toBeCloseTo(1, 9)
  })

  it('unwraps a ring across the antimeridian and keeps its area', () => {
    const fiji = [
      [179, 0],
      [-179, 0],
      [-179, 2],
      [179, 2],
      [179, 0],
    ] as Array<[number, number]>
    const unwrapped = unwrapCountryRing(fiji)
    for (let i = 1; i < unwrapped.length; i++) {
      expect(Math.abs(unwrapped[i][0] - unwrapped[i - 1][0])).toBeLessThanOrEqual(180)
    }
    expect(ringArea(unwrapped)).toBeCloseTo(4, 9)
    expect(ringCentroid(unwrapped)[0]).toBeCloseTo(180, 9)
  })
})

describe('countryLabels', () => {
  it('always includes Vietnam even when its ring is small', () => {
    const countries = collection(
      box('Vietnam', '704', 104, 8, 109, 23),
      box('Big', '999', -20, -20, 20, 20),
    )
    const labels = countryLabels(countries, { minArea: 10_000 })
    expect(labels.map((label) => label.name)).toEqual(['Vietnam'])
  })

  it('skips Antarctica and labels above 70 degrees latitude', () => {
    const countries = collection(
      box('Antarctica', '010', -180, -90, 180, -80),
      box('Far North', '998', -10, 75, 10, 80),
      box('Normal', '997', -10, 0, 10, 10),
    )
    const labels = countryLabelCandidates(countries, 0)
    expect(labels.map((label) => label.name)).toEqual(['Normal'])
    expect(labels[0].lat).toBeLessThanOrEqual(MAX_LABEL_LATITUDE)
  })

  it('skips the smaller country when two label boxes overlap', () => {
    const countries = collection(
      box('Big', '996', 0, 0, 20, 20),
      box('Small', '995', 9, 9, 11, 11),
    )
    const labels = countryLabels(countries, { minArea: 0, width: 2048, height: 1024 })
    expect(labels.map((label) => label.name)).toEqual(['Big'])
  })
})
