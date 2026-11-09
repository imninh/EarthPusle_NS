import { lazy, Suspense } from 'react'
import { Layout } from './components/Layout'
import { AppStateProvider, useApp } from './data/AppState'

// Pages are code-split: MapLibre (Discovery) and Plotly (Region) are large, so each
// loads only when its page is opened instead of in one ~6 MB bundle.
const ScreenerPage = lazy(() => import('./pages/Screener'))
const DiscoveryPage = lazy(() => import('./pages/Discovery'))
const RegionPage = lazy(() => import('./pages/Region'))

function CurrentPage() {
  const { page } = useApp()
  if (page === 'discovery') return <DiscoveryPage />
  if (page === 'region') return <RegionPage />
  return <ScreenerPage />
}

export default function App() {
  return (
    <AppStateProvider>
      <Layout>
        <Suspense fallback={<div className="state-message">Loading view…</div>}>
          <CurrentPage />
        </Suspense>
      </Layout>
    </AppStateProvider>
  )
}
