// Shared app state: data index, selected variable/window, current selection and page.
// The URL hash is the source of truth for shareable state; every setter keeps it in sync.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { loadIndex } from './loaders'
import type { DataIndex, Page, Selection, VariableMeta } from './types'
import { parseHash, serializeHash, type RouteState } from '../pages/Home/urlState'

export interface NavigationOptions {
  variableId?: string
  windowId?: string
  selection?: Selection
  domain?: string
  caseId?: string | null
}

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
  /** Screener domain: "global", a box region id, or a schema-1.2 country id. */
  domain: string
  setDomain: (id: string) => void
  /** Story step: null is the intro, otherwise a case id. */
  caseId: string | null
  setCaseId: (id: string | null) => void
  /** Select something and open a page in one call. */
  navigate: (page: Page, opts?: NavigationOptions) => void
}

const Ctx = createContext<AppState | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside <AppStateProvider>')
  return v
}

function fallbackVariableId(index: DataIndex): string {
  return index.variables.find((v) => v.core)?.id ?? index.variables[0]?.id ?? ''
}

/** Validate URL values against the loaded index, falling back to sensible defaults. */
function normalizeRoute(route: RouteState, index: DataIndex): RouteState {
  const variableId =
    route.variableId && index.variables.some((v) => v.id === route.variableId)
      ? route.variableId
      : fallbackVariableId(index)
  const windowId =
    route.windowId && index.windows.some((w) => w.id === route.windowId)
      ? route.windowId
      : (index.windows[0]?.id ?? '')
  return { ...route, variableId, windowId }
}

function writeLocation(route: RouteState, mode: 'push' | 'replace') {
  if (typeof window === 'undefined') return
  const hash = serializeHash(route)
  if (window.location.hash === hash) return
  const url = `${window.location.pathname}${window.location.search}${hash}`
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<DataIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const initialRoute = useRef<RouteState | null>(null)
  let start = initialRoute.current
  if (start === null) {
    start = parseHash(window.location.hash)
    initialRoute.current = start
  }

  const [page, setPageState] = useState<Page>(start.page)
  const [variableId, setVariableIdState] = useState(start.variableId ?? '')
  const [windowId, setWindowIdState] = useState(start.windowId ?? '')
  const [selection, setSelectionState] = useState<Selection>(start.selection)
  const [domain, setDomainState] = useState(start.domain ?? 'global')
  const [caseId, setCaseIdState] = useState<string | null>(start.caseId)

  const stateRef = useRef<RouteState>({
    page,
    variableId,
    windowId,
    selection,
    domain,
    caseId,
  })
  stateRef.current = { page, variableId, windowId, selection, domain, caseId }

  const apply = useCallback((next: RouteState) => {
    stateRef.current = next
    setPageState(next.page)
    setVariableIdState(next.variableId ?? '')
    setWindowIdState(next.windowId ?? '')
    setSelectionState(next.selection)
    setDomainState(next.domain ?? 'global')
    setCaseIdState(next.caseId)
  }, [])

  const commit = useCallback(
    (patch: Partial<RouteState>, mode: 'push' | 'replace' = 'push') => {
      const next: RouteState = { ...stateRef.current, ...patch }
      apply(next)
      writeLocation(next, mode)
    },
    [apply],
  )

  useEffect(() => {
    loadIndex()
      .then((idx) => {
        const route = normalizeRoute(parseHash(window.location.hash), idx)
        apply(route)
        // Canonicalise the address bar (an empty hash becomes #/home).
        writeLocation(route, 'replace')
        setIndex(idx)
      })
      .catch((e: unknown) => setError(String(e)))
  }, [apply])

  // Browser back/forward: re-read the hash and apply it. Validation waits for the index.
  useEffect(() => {
    if (!index) return
    const onPop = () => {
      apply(normalizeRoute(parseHash(window.location.hash), index))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [apply, index])

  const setPage = useCallback((p: Page) => commit({ page: p }, 'push'), [commit])
  const setVariableId = useCallback((id: string) => commit({ variableId: id }, 'replace'), [commit])
  const setWindowId = useCallback((id: string) => commit({ windowId: id }, 'replace'), [commit])
  const setSelection = useCallback((s: Selection) => commit({ selection: s }, 'push'), [commit])
  const setDomain = useCallback((id: string) => commit({ domain: id }, 'replace'), [commit])
  const setCaseId = useCallback((id: string | null) => commit({ caseId: id }, 'replace'), [commit])

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
      domain,
      setDomain,
      caseId,
      setCaseId,
      navigate: (p, opts) => {
        const patch: Partial<RouteState> = { page: p }
        if (opts?.variableId) patch.variableId = opts.variableId
        if (opts?.windowId) patch.windowId = opts.windowId
        if (opts && 'selection' in opts) patch.selection = opts.selection ?? null
        if (opts?.domain) patch.domain = opts.domain
        if (opts && 'caseId' in opts) patch.caseId = opts.caseId ?? null
        commit(patch, 'push')
      },
    }
  }, [
    index,
    page,
    variableId,
    windowId,
    selection,
    domain,
    caseId,
    setPage,
    setVariableId,
    setWindowId,
    setSelection,
    setDomain,
    setCaseId,
    commit,
  ])

  if (error) return <div className="state-message" role="alert">Could not load data: {error}</div>
  if (!value) return <div className="state-message" role="status">Loading EarthPulse data…</div>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
