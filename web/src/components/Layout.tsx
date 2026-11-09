import type { ReactNode } from 'react'
import { useApp } from '../data/AppState'
import type { Page } from '../data/types'
import { VariableSelect, WindowSelect } from './VariableSelect'

const TABS: { id: Page; label: string }[] = [
  { id: 'screener', label: 'Variable Screener' },
  { id: 'discovery', label: 'Global Discovery' },
  { id: 'region', label: 'Region Explorer' },
]

export function Layout({ children }: { children: ReactNode }) {
  const { index, page, setPage } = useApp()
  return (
    <div className="app">
      {index.synthetic && (
        <div className="synthetic-banner" role="alert">
          SYNTHETIC DATA: development mock, not NASA results
        </div>
      )}
      <header className="app-header">
        <h1>EarthPulse</h1>
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === page ? 'tab active' : 'tab'} onClick={() => setPage(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="controls">
          <VariableSelect />
          <WindowSelect />
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
