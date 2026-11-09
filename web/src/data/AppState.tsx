// Shared app state: data index, selected variable/window, current selection and page.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadIndex } from './loaders'
import type { DataIndex, Page, Selection, VariableMeta } from './types'

export interface AppState {
  index: DataIndex
  page: Page
  setPage: (p: Page) => void
  variableId: string
  setVariableId: (id: string) => void
  variable: VariableMeta
  windowId: string
  setWindowId: (id: string) => void
  selection: Selection
  setSelection: (s: Selection) => void
  /** Select something and open a page in one call. */
  navigate: (page: Page, opts?: { variableId?: string; selection?: Selection }) => void
}

const Ctx = createContext<AppState | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside <AppStateProvider>')
  return v
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<DataIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('screener')
  const [variableId, setVariableId] = useState('')
  const [windowId, setWindowId] = useState('')
  const [selection, setSelection] = useState<Selection>(null)

  useEffect(() => {
    loadIndex()
      .then((idx) => {
        setIndex(idx)
        setVariableId(idx.variables.find((v) => v.core)?.id ?? idx.variables[0]?.id ?? '')
        setWindowId(idx.windows[0]?.id ?? '')
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const value = useMemo<AppState | null>(() => {
    if (!index) return null
    const variable = index.variables.find((v) => v.id === variableId) ?? index.variables[0]
    return {
      index,
      page,
      setPage,
      variableId: variable.id,
      setVariableId,
      variable,
      windowId,
      setWindowId,
      selection,
      setSelection,
      navigate: (p, opts) => {
        if (opts?.variableId) setVariableId(opts.variableId)
        if (opts && 'selection' in opts) setSelection(opts.selection ?? null)
        setPage(p)
      },
    }
  }, [index, page, variableId, windowId, selection])

  if (error) return <div className="state-message">Could not load data: {error}</div>
  if (!value) return <div className="state-message">Loading EarthPulse data…</div>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
