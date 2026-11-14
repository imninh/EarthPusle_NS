// Pure country-label placement for the globe texture (task G2). No DOM: the
// canvas code calls this with Natural Earth country polygons and a text measurer.

import type { FeatureCollection } from 'geojson'

export const VIETNAM_ID = '704'
export const MAX_LABEL_LATITUDE = 70
/** Largest-ring area in lon/lat square degrees; tuned to about 30-45 labels. */
export const MIN_COUNTRY_AREA = 60

export interface CountryLabel {
  id: string
  name: string
  /** Centroid of the largest polygon ring, unwrapped, then normalised to [-180, 180]. */
  lon: number
  lat: number
  area: number
  /** Vietnam is the demo case and is never dropped. */
  priority: boolean
}

export interface CountryLabelOptions {
  minArea?: number
  width?: number
  height?: number
  fontSize?: number
  measureText?: (name: string, fontSize: number) => number
}

export interface LabelBox {
  left: number
  top: number
  right: number
  bottom: number
}

type Ring = Array<[number, number]>

/** Consecutive longitudes differ by at most 180 degrees (antimeridian-safe). */
export function unwrapCountryRing(ring: ReadonlyArray<ReadonlyArray<number>>): Ring {
  const out: Ring = []
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

/** Absolute shoelace area in square degrees. */
export function ringArea(ring: ReadonlyArray<ReadonlyArray<number>>): number {
  if (ring.length < 3) return 0
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/** Area-weighted centroid of a closed ring; falls back to the mean for zero area. */
export function ringCentroid(ring: ReadonlyArray<ReadonlyArray<number>>): [number, number] {
  if (ring.length === 0) return [0, 0]
  let twiceArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const cross = a[0] * b[1] - b[0] * a[1]
    twiceArea += cross
    cx += (a[0] + b[0]) * cross
    cy += (a[1] + b[1]) * cross
  }
  if (Math.abs(twiceArea) < 1e-9) {
    let sx = 0
    let sy = 0
    for (const p of ring) {
      sx += p[0]
      sy += p[1]
    }
    return [sx / ring.length, sy / ring.length]
  }
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)]
}

function normaliseLon(lon: number): number {
  let value = lon
  while (value > 180) value -= 360
  while (value < -180) value += 360
  return value === 180 ? -180 : value
}

function outerRings(geometry: FeatureCollection['features'][number]['geometry']): Ring[] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ? [geometry.coordinates[0] as Ring] : []
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon[0] as Ring | undefined)
      .filter((ring): ring is Ring => Boolean(ring))
  }
  return []
}

/** One candidate per country: largest outer ring, its centroid, and area. */
export function countryLabelCandidates(
  countries: FeatureCollection,
  minArea: number = MIN_COUNTRY_AREA,
): CountryLabel[] {
  const labels: CountryLabel[] = []
  for (const country of countries.features) {
    const properties = (country.properties ?? {}) as Record<string, unknown>
    const name = String(properties.name ?? properties.NAME ?? '').trim()
    if (!name || name === 'Antarctica') continue
    const id = String(country.id ?? properties.id ?? properties.ISO_N3 ?? '').trim()
    const rings = outerRings(country.geometry).map(unwrapCountryRing)
    let best: Ring | null = null
    let bestArea = 0
    for (const ring of rings) {
      const area = ringArea(ring)
      if (area > bestArea) {
        best = ring
        bestArea = area
      }
    }
    if (!best || bestArea <= 0) continue
    const [lon, lat] = ringCentroid(best)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    if (Math.abs(lat) > MAX_LABEL_LATITUDE) continue
    const priority = id === VIETNAM_ID || name === 'Vietnam'
    if (!priority && bestArea < minArea) continue
    labels.push({
      id,
      name,
      lon: normaliseLon(lon),
      lat,
      area: bestArea,
      priority,
    })
  }
  return labels.sort(
    (a, b) => Number(b.priority) - Number(a.priority) || b.area - a.area || a.name.localeCompare(b.name),
  )
}

function defaultMeasureText(name: string, fontSize: number): number {
  return name.length * fontSize * 0.58
}

/** Pixel box used for the overlap rule, including the horizontal label stretch. */
export function labelBox(
  label: CountryLabel,
  options: Required<Pick<CountryLabelOptions, 'width' | 'height' | 'fontSize' | 'measureText'>>,
): LabelBox {
  const x = ((label.lon + 180) / 360) * options.width
  const y = ((90 - label.lat) / 180) * options.height
  const scale = Math.min(2.5, 1 / Math.max(0.2, Math.cos((Math.abs(label.lat) * Math.PI) / 180)))
  const width = options.measureText(label.name, options.fontSize) * scale
  const height = options.fontSize * 1.25
  return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 }
}

function intersects(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** Place largest countries first; skip a smaller label whose box overlaps one already placed. */
export function placeCountryLabels(
  candidates: readonly CountryLabel[],
  options: CountryLabelOptions = {},
): CountryLabel[] {
  const width = options.width ?? 2048
  const height = options.height ?? 1024
  const fontSize = options.fontSize ?? 22
  const measureText = options.measureText ?? defaultMeasureText
  const placed: CountryLabel[] = []
  const boxes: LabelBox[] = []
  for (const label of candidates) {
    const box = labelBox(label, { width, height, fontSize, measureText })
    if (!label.priority && boxes.some((existing) => intersects(existing, box))) continue
    placed.push(label)
    boxes.push(box)
  }
  return placed
}

export function countryLabels(
  countries: FeatureCollection,
  options: CountryLabelOptions = {},
): CountryLabel[] {
  return placeCountryLabels(countryLabelCandidates(countries, options.minArea), options)
}
