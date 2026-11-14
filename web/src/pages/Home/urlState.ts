// Hash routing for shareable app state. Kept pure so it can be unit-tested without a DOM.
import type { Page, Selection } from '../../data/types'

const PAGES: readonly Page[] = ['home', 'investigate', 'screener', 'discovery', 'region', 'story', 'method']
const PAGES_WITH_VARIABLE: readonly Page[] = ['screener', 'discovery', 'region']

export interface RouteState {
  page: Page
  variableId: string | null
  windowId: string | null
  selection: Selection
  /** Screener domain: "global", a box region id, or a schema-1.2 country id. */
  domain: string | null
  /** Story step: null is the intro, otherwise a case id. */
  caseId: string | null
  /** Discovery layer requested by a link, e.g. "witness". */
  layer: string | null
}

export const HOME_ROUTE: RouteState = {
  page: 'home',
  variableId: null,
  windowId: null,
  selection: null,
  domain: null,
  caseId: null,
  layer: null,
}

function clean(value: string | null): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function parseCell(value: string | null): Selection {
  if (!value) return null
  const parts = value.split(',')
  if (parts.length !== 2) return null
  const row = Number(parts[0])
  const col = Number(parts[1])
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null
  if (row < 0 || row > 179 || col < 0 || col > 359) return null
  return { kind: 'cell', row, col }
}

function parseBbox(value: string | null): Selection {
  if (!value) return null
  const parts = value.split(',')
  if (parts.length !== 4) return null
  const numbers = parts.map(Number)
  if (!numbers.every((n) => Number.isFinite(n))) return null
  const [west, south, east, north] = numbers as [number, number, number, number]
  return { kind: 'bbox', bbox: [west, south, east, north] }
}

function parseSelection(params: URLSearchParams): Selection {
  const cell = parseCell(params.get('cell'))
  if (cell) return cell
  const regionId = clean(params.get('region'))
  if (regionId) return { kind: 'region', regionId }
  return parseBbox(params.get('bbox'))
}

/**
 * Parse a location hash. Unknown or malformed parts fall back to Home / no selection,
 * so a hand-edited link never throws.
 */
export function parseHash(hash: string): RouteState {
  const raw = hash.replace(/^#/, '')
  const queryAt = raw.indexOf('?')
  const pathPart = (queryAt === -1 ? raw : raw.slice(0, queryAt)).replace(/^\/+/, '').toLowerCase()
  const queryPart = queryAt === -1 ? '' : raw.slice(queryAt + 1)
  if (!(PAGES as readonly string[]).includes(pathPart)) return HOME_ROUTE
  const params = new URLSearchParams(queryPart)
  const page = pathPart as Page
  return {
    page,
    variableId: clean(params.get('v')),
    windowId: clean(params.get('w')),
    selection: parseSelection(params),
    domain: clean(params.get('domain')),
    caseId: clean(params.get('case')),
    layer: clean(params.get('layer')),
  }
}

function appendSelection(params: URLSearchParams, selection: Selection) {
  if (selection == null) return
  if (selection.kind === 'cell') {
    params.set('cell', `${selection.row},${selection.col}`)
    return
  }
  if (selection.kind === 'region') {
    params.set('region', selection.regionId)
    return
  }
  params.set('bbox', selection.bbox.map((value) => String(value)).join(','))
}

/**
 * Canonical hash for a route. Parameters are ordered so equal state always yields the
 * same string (useful for history de-duplication and tests).
 */
export function serializeHash(route: RouteState): string {
  const params = new URLSearchParams()
  if (route.page === 'investigate') {
    // The Investigate page owns place/topic; only the shared period is routed here.
    if (route.windowId) params.set('w', route.windowId)
  }
  if (PAGES_WITH_VARIABLE.includes(route.page)) {
    if (route.variableId) params.set('v', route.variableId)
    if (route.windowId) params.set('w', route.windowId)
  }
  if (route.page === 'screener' && route.domain && route.domain !== 'global') {
    params.set('domain', route.domain)
  }
  if (route.page === 'story' && route.caseId) params.set('case', route.caseId)
  if (route.page === 'discovery' && route.layer) params.set('layer', route.layer)
  if (route.page === 'discovery' || route.page === 'region') appendSelection(params, route.selection)
  const query = params.toString().replace(/%2C/gi, ',')
  return `#/${route.page}${query ? `?${query}` : ''}`
}
