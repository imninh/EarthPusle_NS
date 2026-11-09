import { useRef, useState, type ReactNode } from 'react'
import { useApp } from '../data/AppState'
import type { Page } from '../data/types'
import { CoachMark, shouldShowCoach } from './ui'
import { VariableSelect, WindowSelect } from './VariableSelect'

const VIEWS: { id: Page; label: string; short: string }[] = [
  { id: 'home', label: 'Home', short: 'Home' },
  { id: 'screener', label: 'Explore variables', short: 'Variables' },
  { id: 'discovery', label: 'Explore the map', short: 'Map' },
  { id: 'story', label: 'Follow a case', short: 'Story' },
]

export function Layout({ children }: { children: ReactNode }) {
  const { index, page, setPage } = useApp()
  const [coachOpen, setCoachOpen] = useState(shouldShowCoach)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const showVariable = page === 'discovery' || page === 'region'
  const showPeriod = page === 'screener' || page === 'discovery' || page === 'region'

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {index.synthetic && (
        <div className="synthetic-banner" role="alert">
          SYNTHETIC DATA: development mock, not NASA results
        </div>
      )}
      <header className="app-header">
        <button type="button" className="brand" onClick={() => setPage('home')} aria-label="EarthPulse home">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-orbit" />
            <span className="brand-planet" />
          </span>
          <span className="brand-text">
            <strong>EarthPulse</strong>
            <span>Earth system trend detective</span>
          </span>
        </button>

        <nav className="tabs" aria-label="Views">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              className={view.id === page ? 'tab active' : 'tab'}
              onClick={() => setPage(view.id)}
              aria-current={view.id === page ? 'page' : undefined}
            >
              <span className="tab-long">{view.label}</span>
              <span className="tab-short">{view.short}</span>
            </button>
          ))}
        </nav>

        <div className="header-tools">
          {showVariable || showPeriod ? (
            <div className="controls" role="group" aria-label="Data controls">
              {showVariable ? <VariableSelect /> : null}
              {showPeriod ? <WindowSelect /> : null}
            </div>
          ) : null}
          <button
            ref={helpButtonRef}
            type="button"
            className="help-button"
            onClick={() => setCoachOpen(true)}
            aria-label="Open the guided tour"
            title="Guided tour"
          >
            ?
          </button>
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="app-footer">
        <span>
          Data: NASA GES DISC (GLDAS-2.1, GPM IMERG). Map coastlines: Natural Earth. Method: Sen&apos;s slope +
          Hamed–Rao Mann–Kendall with FDR correction.
        </span>
        <span>Not a verdict: a significant trend is evidence to read, not proof of cause.</span>
      </footer>
      <CoachMark
        open={coachOpen}
        onClose={() => setCoachOpen(false)}
        returnFocusRef={helpButtonRef}
      />
    </div>
  )
}
