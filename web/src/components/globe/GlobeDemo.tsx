// Dev-only review page for the globe (task W1). Not routed anywhere.
//
// To mount it temporarily, either:
//   * in web/src/App.tsx render `<GlobeDemo />` instead of the page, or
//   * open web/src/components/globe/demo.html on a dev server (any free port, not the architect's
//     5173), e.g. `npx vite --port 5199` then http://localhost:5199/src/components/globe/demo.html
// It loads the real air_temperature 2001-2024 trend class, its quality flag, Natural Earth land
// and the published cases; pulses are at the centre of each case's region bbox.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { loadCases, loadQualityFlag, loadTrendClass } from '../../data/loaders'
import { loadNaturalEarth } from '../../maps/basemap'
import type { GlobePulse } from './EarthGlobe'

const EarthGlobe = lazy(() => import('./EarthGlobe'))

const VARIABLE_ID = 'air_temperature'
const WINDOW_ID = '2001-2024'

interface DemoData {
  trendClass: Int8Array
  qualityFlag: Int8Array | null
  land: FeatureCollection
  pulses: GlobePulse[]
}

export default function GlobeDemo() {
  const [data, setData] = useState<DemoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadTrendClass(VARIABLE_ID, WINDOW_ID),
      loadQualityFlag(VARIABLE_ID, WINDOW_ID),
      loadNaturalEarth(),
      loadCases(),
    ])
      .then(([trendClass, qualityFlag, basemap, cases]) => {
        if (cancelled) return
        const pulses = cases.cases.map((c): GlobePulse => {
          const [west, south, east, north] = c.region.bbox
          return { id: c.id, lat: (south + north) / 2, lon: (west + east) / 2, label: c.title }
        })
        setData({ trendClass, qualityFlag, land: basemap.land, pulses })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        background: 'var(--night, #0b1b33)',
        color: 'var(--on-night, #eaf1fb)',
        minHeight: '100vh',
        padding: '32px 16px',
      }}
    >
      <div style={{ width: 460, maxWidth: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 16px' }}>
          Globe demo (dev only): air temperature, {WINDOW_ID}
        </h1>
        {error && <p>Could not load the demo data: {error}</p>}
        {!error && !data && <p>Loading data...</p>}
        {data && (
          <Suspense fallback={<p>Loading globe...</p>}>
            <EarthGlobe
              trendClass={data.trendClass}
              qualityFlag={data.qualityFlag}
              land={data.land}
              pulses={data.pulses}
              onPulseSelect={setSelected}
              ariaLabel="Globe of the 2001 to 2024 air temperature trend, with one pulse for each published case."
            />
          </Suspense>
        )}
        <p style={{ marginTop: 16, fontSize: '0.875rem' }}>Selected pulse: {selected ?? 'none'}</p>
      </div>
    </div>
  )
}
