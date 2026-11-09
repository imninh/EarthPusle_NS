import { describe, expect, it } from 'vitest'
import type { FeatureCollection, MultiLineString } from 'geojson'
import { basemapColours, basemapSky, buildBasemapStyle, graticule } from './basemap'

const emptyLand: FeatureCollection = { type: 'FeatureCollection', features: [] }
const emptyBorders: MultiLineString = { type: 'MultiLineString', coordinates: [] }

describe('offline Natural Earth basemap', () => {
  it('builds a globe style with local sources and no remote URLs', () => {
    const style = buildBasemapStyle(false, emptyLand, emptyBorders)
    expect(style.projection).toEqual({ type: 'globe' })
    expect(Object.keys(style.sources ?? {}).sort()).toEqual(['borders', 'graticule', 'land'])
    const ids = (style.layers ?? []).map((layer) => layer.id)
    expect(ids).toEqual(['ocean', 'graticule', 'land-fill', 'coastline', 'country-borders'])
    expect(JSON.stringify(style)).not.toContain('http')
  })

  it('can build a flat Mercator style', () => {
    const style = buildBasemapStyle(true, emptyLand, emptyBorders, 'mercator')
    expect(style.projection).toEqual({ type: 'mercator' })
  })

  it('uses different light and dark palettes', () => {
    expect(basemapColours(true).ocean).not.toBe(basemapColours(false).ocean)
    expect(basemapSky(true)['sky-color']).not.toBe(basemapSky(false)['sky-color'])
  })

  it('creates a subtle graticule every 30 degrees', () => {
    const lines = graticule()
    expect(lines.type).toBe('FeatureCollection')
    expect(lines.features).toHaveLength(18)
  })
})
