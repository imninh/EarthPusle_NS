// Case-file header: place name, the real Natural Earth country outline, and the existing
// plainVerdict label as a stamp. The outline uses the same bundled world-atlas geometry
// that the Discovery basemap loads; boxes and cells fall back to the block locator.
import { useEffect, useState } from 'react'
import countriesUrl from 'world-atlas/countries-50m.json?url'
import { feature } from 'topojson-client'
import type { Feature, Geometry, Position } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { VerdictStamp } from '../../components/ui'
import { useStrings } from '../../i18n'
import type { Country } from '../../data/types'
import { verdictKindOfLabel, type PlainVerdict } from '../../lib/format'
import { CountryLocator } from './CountryLocator'
import { HEADER_STRINGS } from './strings'

export type StampTone = 'strong' | 'caution' | 'not-yet' | 'none'

/**
 * Presentation mapping only: the verdict itself is plainVerdict's label, unchanged.
 * Caution uses marker yellow; "not enough data" is the neutral stamp.
 */
export function verdictStampTone(verdict: PlainVerdict | null): StampTone {
  if (!verdict) return 'none'
  if (verdict.tone === 'warn') return 'caution'
  // The kind is recognised in either language, so a Vietnamese label gives the same tone.
  const kind = verdictKindOfLabel(verdict.label)
  if (kind === 'caution') return 'caution'
  if (kind === 'notEnough') return 'none'
  if (kind === 'notYet' || kind === 'noClear') return 'not-yet'
  return 'strong'
}

type CountryTopology = Topology<{ countries: GeometryCollection }>

let topologyPromise: Promise<CountryTopology> | null = null
const shapeCache = new Map<string, string>()

function loadTopology(): Promise<CountryTopology> {
  if (!topologyPromise) {
    topologyPromise = fetch(countriesUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${countriesUrl}: HTTP ${response.status}`)
      return (await response.json()) as CountryTopology
    })
  }
  return topologyPromise
}

function unwrapRing(ring: Position[]): [number, number][] {
  const out: [number, number][] = []
  for (const point of ring) {
    let lon = point[0]
    const lat = point[1]
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    if (out.length > 0) {
      const previous = out[out.length - 1][0]
      while (lon - previous > 180) lon -= 360
      while (previous - lon > 180) lon += 360
    }
    out.push([lon, lat])
  }
  return out
}

/**
 * Project a Polygon/MultiPolygon to the 96 × 120 outline box, preserving its aspect.
 * Rings are unwrapped across the antimeridian so Russia and Fiji do not draw a line
 * across the whole glyph. Holes use the even-odd fill rule in the SVG.
 */
export function outlinePath(geometry: Geometry | null | undefined): string {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return ''
  const rings =
    geometry.type === 'Polygon'
      ? geometry.coordinates.map(unwrapRing)
      : geometry.coordinates.flat().map(unwrapRing)
  const usable = rings.filter((ring) => ring.length > 1)
  if (usable.length === 0) return ''

  // Keep separate islands in the same longitude frame as the first ring.
  const anchor = usable[0][0][0]
  for (let i = 1; i < usable.length; i++) {
    const shift = Math.round((anchor - usable[i][0][0]) / 360) * 360
    if (shift !== 0) for (const point of usable[i]) point[0] += shift
  }

  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const ring of usable) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  const width = maxLon - minLon
  const height = maxLat - minLat
  if (!(width > 0) || !(height > 0)) return ''

  const pad = 4
  const scale = Math.min((96 - 2 * pad) / width, (120 - 2 * pad) / height)
  if (!Number.isFinite(scale) || scale <= 0) return ''
  const offsetX = (96 - width * scale) / 2
  const offsetY = (120 - height * scale) / 2

  const paths: string[] = []
  for (const ring of usable) {
    const points = ring.map(([lon, lat], index) => {
      const x = offsetX + (lon - minLon) * scale
      const y = offsetY + (maxLat - lat) * scale
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    paths.push(`${points.join('')}Z`)
  }
  return paths.join(' ')
}

function findCountryGeometry(topology: CountryTopology, country: Country) {
  const geometries = topology.objects.countries.geometries
  if (country.iso_numeric) {
    const numeric = Number(country.iso_numeric)
    if (Number.isFinite(numeric)) {
      const byId = geometries.find((item) => item.id != null && Number(item.id) === numeric)
      if (byId) return byId
    }
  }
  const label = country.label.trim().toLowerCase()
  return (
    geometries.find((item) => {
      const name = (item.properties as { name?: string } | undefined)?.name
      return typeof name === 'string' && name.trim().toLowerCase() === label
    }) ?? null
  )
}

async function loadCountryShape(country: Country): Promise<string> {
  const key = `${country.iso_numeric}|${country.label}`
  const cached = shapeCache.get(key)
  if (cached != null) return cached
  const topology = await loadTopology()
  const source = findCountryGeometry(topology, country)
  if (!source) return ''
  const shape = feature(topology, source) as unknown as Feature
  const path = outlinePath(shape.geometry)
  if (path) shapeCache.set(key, path)
  return path
}

type OutlineState = { status: 'loading' | 'missing' | 'error' } | { status: 'ready'; d: string }

function CountryOutline({ country }: { country: Country }) {
  const [state, setState] = useState<OutlineState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loadCountryShape(country)
      .then((path) => {
        if (cancelled) return
        setState(path ? { status: 'ready', d: path } : { status: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [country])

  if (state.status === 'ready') {
    return (
      <svg className="case-outline-svg" viewBox="0 0 96 120" aria-hidden="true" focusable="false">
        <path d={state.d} fillRule="evenodd" />
      </svg>
    )
  }
  if (state.status === 'loading') return <span className="case-outline-placeholder" aria-hidden="true" />
  return <CountryLocator country={country} />
}

export interface CaseHeaderProps {
  title: string
  variableLabel: string
  windowStart: string
  windowEnd: string
  detail?: string | null
  country?: Country | null
  verdict: PlainVerdict | null
  onChoose: () => void
}

/** The top row of the case file (docs/UI_SPEC.md §7). */
export function CaseHeader({
  title,
  variableLabel,
  windowStart,
  windowEnd,
  detail,
  country,
  verdict,
  onChoose,
}: CaseHeaderProps) {
  const s = useStrings(HEADER_STRINGS)
  const from = windowStart.slice(0, 4)
  const to = windowEnd.slice(0, 4)
  const years = from && to ? `${from}–${to}` : `${windowStart}–${windowEnd}`
  return (
    <header className={`region-case-head${country ? '' : ' region-case-head--no-outline'}`}>
      {country && (
        <div className="region-case-outline">
          <CountryOutline country={country} />
          <p className="region-case-outline-caption">{s.boundary}</p>
        </div>
      )}
      <div className="region-case-title">
        <p className="label-caps region-case-eyebrow">{s.caseFile} · {variableLabel} · {years}</p>
        <h1 className="display region-case-place">{title}</h1>
        {detail && <p className="region-case-detail">{detail}</p>}
        <div className="region-case-actions">
          <button type="button" className="region-button secondary" onClick={onChoose}>
            {s.chooseDifferent}
          </button>
        </div>
      </div>
      {verdict && (
        <div className="region-case-stamp">
          <p className="label-caps region-case-stamp-caps">{s.verdict}</p>
          <VerdictStamp label={verdict.label} tone={verdictStampTone(verdict)} size="lg" />
        </div>
      )}
    </header>
  )
}
