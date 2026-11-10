import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Layout } from './components/Layout'
import { AppStateProvider, useApp } from './data/AppState'

// Pages are code-split: MapLibre (Discovery) and Plotly (Region) are large, so each
// loads only when its page is opened instead of in one ~6 MB bundle.
const ScreenerPage = lazy(() => import('./pages/Screener'))
const DiscoveryPage = lazy(() => import('./pages/Discovery'))
const RegionPage = lazy(() => import('./pages/Region'))
const HomePage = lazy(() => import('./pages/Home'))
const StoryPage = lazy(() => import('./pages/Story'))
const MethodPage = lazy(() => import('./pages/Method'))

function CurrentPage() {
  const { page } = useApp()
  if (page === 'discovery') return <DiscoveryPage />
  if (page === 'region') return <RegionPage />
  if (page === 'home') return <HomePage />
  if (page === 'story') return <StoryPage />
  if (page === 'method') return <MethodPage />
  return <ScreenerPage />
}

/**
 * A failed lazy chunk or a render error in one view must not blank the whole shell.
 * The boundary resets when the user changes view, so the other pages stay usable.
 */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('EarthPulse view failed to render', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="state-message" role="alert">
        <h2>This view could not load</h2>
        <p>{this.state.error.message}</p>
        <p>Use the navigation bar to open another view.</p>
      </div>
    )
  }
}

function Shell() {
  const { page } = useApp()
  return (
    <Layout>
      <PageBoundary key={page}>
        <Suspense fallback={<div className="state-message">Loading view…</div>}>
          <CurrentPage />
        </Suspense>
      </PageBoundary>
    </Layout>
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  )
}
