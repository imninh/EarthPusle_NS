import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../data/AppState'
import type { Page } from '../data/types'
import { CoachMark, shouldShowCoach } from './ui'
import { VariableSelect, WindowSelect } from './VariableSelect'

const VIEWS: { id: Page; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'investigate', label: 'Investigate' },
  { id: 'screener', label: 'Variables' },
  { id: 'discovery', label: 'Map' },
  { id: 'story', label: 'Cases' },
  { id: 'method', label: 'How it works' },
]

export function Layout({ children }: { children: ReactNode }) {
  const { index, page, setPage } = useApp()
  // The first-visit coach mark belongs on Home only. A deep link must never be
  // covered by it, even when the dismissal flag has not been stored yet.
  const [coachOpen, setCoachOpen] = useState(() => page === 'home' && shouldShowCoach())
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const showVariable = page === 'discovery' || page === 'region'
  const showPeriod = page === 'screener' || page === 'discovery' || page === 'region'
  const showContextBar = showVariable || showPeriod

  // Leaving Home closes an auto-opened tour; the "?" button can still open it
  // deliberately on any page.
  useEffect(() => {
    if (page !== 'home') setCoachOpen(false)
  }, [page])

  // One help button. With a context bar it lives there; otherwise it stays in the night
  // header so the guided tour is reachable on every page.
  const helpButton = (
    <button
      ref={helpButtonRef}
      type="button"
      className={showContextBar ? 'help-button' : 'help-button help-button--night'}
      onClick={() => setCoachOpen(true)}
      aria-label="Open the guided tour"
      title="Guided tour"
    >
      ?
    </button>
  )

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
        <button type="button" className="brand" onClick={() => setPage('home')}>
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-orbit" />
            <span className="brand-planet" />
          </span>
          <span className="brand-text">
            <strong>EarthPulse</strong>
          </span>
        </button>

        <nav className="tabs" aria-label="Views">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className={view.id === page ? 'tab active' : 'tab'}
              onClick={() => setPage(view.id)}
              aria-current={view.id === page ? 'page' : undefined}
            >
              {view.label}
            </button>
          ))}
        </nav>

        {showContextBar ? null : <div className="header-tools">{helpButton}</div>}
      </header>
      {showContextBar ? (
        <div className="context-bar">
          <div className="context-bar-inner">
            <div className="controls" role="group" aria-label="Data controls">
              {showVariable ? <VariableSelect /> : null}
              {showPeriod ? <WindowSelect /> : null}
            </div>
            {helpButton}
          </div>
        </div>
      ) : null}
      <main id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="app-footer">
        <span>
          Data: NASA GES DISC (GLDAS-2.1, GPM IMERG). Map coastlines: Natural Earth. Method: Sen&apos;s slope +
          Hamed–Rao Mann–Kendall with FDR correction.
        </span>
        <span>Not a verdict: a significant trend is evidence to read, not proof of cause.</span>
        <button type="button" className="button ghost" onClick={() => setPage('method')}>
          How it works
        </button>
      </footer>
      <CoachMark
        open={coachOpen}
        onClose={() => setCoachOpen(false)}
        returnFocusRef={helpButtonRef}
      />
    </div>
  )
}
