// Offline Natural Earth basemap for the Discovery map (P09).
//
// The TopoJSON files are bundled by Vite (`?url`). Nothing is fetched from a
// tile server at runtime: land, country borders and graticule are local
// GeoJSON sources in one MapLibre style.
import landUrl from 'world-atlas/land-50m.json?url'
import countriesUrl from 'world-atlas/countries-50m.json?url'
import { feature, mesh } from 'topojson-client'
import type { FeatureCollection, LineString, MultiLineString } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Map as MapLibreMap, SkySpecification, StyleSpecification } from 'maplibre-gl'

export interface BasemapData {
  land: FeatureCollection
  borders: MultiLineString
  style: StyleSpecification
}

export interface BasemapColours {
  ocean: string
  land: string
  coastline: string
  border: string
  graticule: string
}

let cached: Promise<BasemapData> | null = null

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** Load the bundled Natural Earth TopoJSON once per session. */
export function loadNaturalEarth(): Promise<BasemapData> {
  if (!cached) {
    cached = Promise.all([
      loadJson<Topology<{ land: GeometryCollection }>>(landUrl),
      loadJson<Topology<{ countries: GeometryCollection }>>(countriesUrl),
    ]).then(([landTopo, countriesTopo]) => {
      const land = feature(landTopo, landTopo.objects.land) as unknown as FeatureCollection
      const borders = mesh(
        countriesTopo,
        countriesTopo.objects.countries,
        (a, b) => a !== b,
      ) as MultiLineString
      return { land, borders, style: buildBasemapStyle(false, land, borders, 'globe') }
    })
  }
  return cached
}

export function basemapColours(dark: boolean): BasemapColours {
  return dark
    ? {
        ocean: '#0b1721',
        land: '#1c2b31',
        coastline: '#4b606d',
        border: '#40515c',
        graticule: 'rgba(255,255,255,0.11)',
      }
    : {
        ocean: '#d9ecf7',
        land: '#eef1e7',
        coastline: '#9eafb9',
        border: '#b4c0c8',
        graticule: 'rgba(31,72,96,0.13)',
      }
}

export function basemapSky(dark: boolean): SkySpecification {
  return dark
    ? {
        'sky-color': '#081725',
        'horizon-color': '#152b3d',
        'fog-color': '#081725',
        'fog-ground-blend': 0.75,
        'horizon-fog-blend': 0.6,
        'sky-horizon-blend': 0.5,
        'atmosphere-blend': 0.75,
      }
    : {
        'sky-color': '#b9daf2',
        'horizon-color': '#e8f4fb',
        'fog-color': '#f7fbff',
        'fog-ground-blend': 0.75,
        'horizon-fog-blend': 0.6,
        'sky-horizon-blend': 0.5,
        'atmosphere-blend': 0.75,
      }
}

/** Subtle graticule every `step` degrees. */
export function graticule(step = 30): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>['features'] = []
  for (let lon = -180; lon <= 180; lon += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] },
    })
  }
  for (let lat = -60; lat <= 60; lat += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function buildBasemapStyle(
  dark: boolean,
  land: FeatureCollection,
  borders: MultiLineString,
  projection: 'globe' | 'mercator' = 'globe',
): StyleSpecification {
  const colours = basemapColours(dark)
  return {
    version: 8,
    projection: { type: projection },
    sources: {
      land: { type: 'geojson', data: land },
      borders: { type: 'geojson', data: borders },
      graticule: { type: 'geojson', data: graticule() },
    },
    layers: [
      {
        id: 'ocean',
        type: 'background',
        paint: { 'background-color': colours.ocean },
      },
      {
        id: 'graticule',
        type: 'line',
        source: 'graticule',
        paint: { 'line-color': colours.graticule, 'line-width': 0.6 },
      },
      {
        id: 'land-fill',
        type: 'fill',
        source: 'land',
        paint: { 'fill-color': colours.land, 'fill-antialias': true },
      },
      {
        id: 'coastline',
        type: 'line',
        source: 'land',
        paint: { 'line-color': colours.coastline, 'line-width': 0.9 },
      },
      {
        id: 'country-borders',
        type: 'line',
        source: 'borders',
        paint: { 'line-color': colours.border, 'line-width': 0.65, 'line-opacity': 0.85 },
      },
    ],
    sky: basemapSky(dark),
  } as StyleSpecification
}

/** Switch the existing style's paint properties without reloading sources. */
export function applyBasemapTheme(map: MapLibreMap, dark: boolean): void {
  const colours = basemapColours(dark)
  if (map.getLayer('ocean')) map.setPaintProperty('ocean', 'background-color', colours.ocean)
  if (map.getLayer('graticule')) map.setPaintProperty('graticule', 'line-color', colours.graticule)
  if (map.getLayer('land-fill')) map.setPaintProperty('land-fill', 'fill-color', colours.land)
  if (map.getLayer('coastline')) map.setPaintProperty('coastline', 'line-color', colours.coastline)
  if (map.getLayer('country-borders')) map.setPaintProperty('country-borders', 'line-color', colours.border)
  map.setSky(basemapSky(dark))
}

// --- Night stage (task V5): the Discovery stage is always night, in light and dark mode. ---

export function nightBasemapColours(dark: boolean): BasemapColours {
  return {
    ocean: dark ? '#070f1d' : '#0b1b33',
    land: dark ? '#14243b' : '#1a3153',
    coastline: '#5a77a3',
    border: '#3a5480',
    graticule: 'rgba(234,241,251,0.10)',
  }
}

/** Same layers as `buildBasemapStyle`, painted in night colours, with the existing dark sky. */
export function buildNightBasemapStyle(
  dark: boolean,
  land: FeatureCollection,
  borders: MultiLineString,
  projection: 'globe' | 'mercator' = 'globe',
): StyleSpecification {
  const style = buildBasemapStyle(dark, land, borders, projection)
  const colours = nightBasemapColours(dark)
  const paint: Record<string, [string, string]> = {
    ocean: ['background-color', colours.ocean],
    graticule: ['line-color', colours.graticule],
    'land-fill': ['fill-color', colours.land],
    coastline: ['line-color', colours.coastline],
    'country-borders': ['line-color', colours.border],
  }
  for (const layer of style.layers) {
    const entry = paint[layer.id]
    if (entry) (layer as { paint?: Record<string, unknown> }).paint = { ...(layer.paint ?? {}), [entry[0]]: entry[1] }
  }
  return { ...style, sky: basemapSky(true) } as StyleSpecification
}

export function applyNightBasemapTheme(map: MapLibreMap, dark: boolean): void {
  const colours = nightBasemapColours(dark)
  if (map.getLayer('ocean')) map.setPaintProperty('ocean', 'background-color', colours.ocean)
  if (map.getLayer('graticule')) map.setPaintProperty('graticule', 'line-color', colours.graticule)
  if (map.getLayer('land-fill')) map.setPaintProperty('land-fill', 'fill-color', colours.land)
  if (map.getLayer('coastline')) map.setPaintProperty('coastline', 'line-color', colours.coastline)
  if (map.getLayer('country-borders')) map.setPaintProperty('country-borders', 'line-color', colours.border)
  map.setSky(basemapSky(true))
}
