// P10 T3: accessible country/region combobox shared by every page.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { loadCountries, loadRegions } from '../data/loaders'
import type { Country, Region } from '../data/types'

export interface PlaceSelection {
  kind: 'region'
  regionId: string
}

export interface PlaceOption {
  id: string
  label: string
  kind: 'country' | 'box'
  isoNumeric?: string
  nCells?: number
}

export interface PlaceSearchProps {
  onPick: (selection: PlaceSelection) => void
  placeholder?: string
  compact?: boolean
}

const RECENT_KEY = 'earthpulse.placeSearch.recent.v1'
const MAX_RECENT = 6

/** Diacritic-insensitive, lower-case search key. */
// eslint-disable-next-line react-refresh/only-export-components
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

/**
 * Filter and rank places for the combobox.
 *
 * Empty query: recent picks first, then alphabetical. Non-empty query: exact
 * label, label prefix, word prefix, then substring; recent picks break ties.
 * The helper is exported so the matching/sorting logic is unit-testable
 * without a DOM.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function filterAndSortPlaces(
  options: PlaceOption[],
  query: string,
  recentIds: string[] = [],
): PlaceOption[] {
  const normalizedQuery = normalizeSearch(query)
  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  const recentRank = new Map<string, number>()
  recentIds.forEach((id, index) => {
    if (!recentRank.has(id)) recentRank.set(id, index)
  })

  const scored = options
    .map((option) => {
      const label = normalizeSearch(option.label)
      const haystack = normalizeSearch(
        [option.label, option.isoNumeric ?? '', option.id].join(' '),
      )
      if (!terms.every((term) => haystack.includes(term))) return null

      let score = 3
      if (normalizedQuery) {
        if (label === normalizedQuery) score = 0
        else if (label.startsWith(normalizedQuery)) score = 1
        else if (
          label
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
            .some((word) => word.startsWith(normalizedQuery))
        ) {
          score = 2
        }
      }
      return { option, score }
    })
    .filter((entry): entry is { option: PlaceOption; score: number } => entry !== null)

  scored.sort((a, b) => {
    const recentA = recentRank.get(a.option.id) ?? Number.MAX_SAFE_INTEGER
    const recentB = recentRank.get(b.option.id) ?? Number.MAX_SAFE_INTEGER
    return (
      a.score - b.score ||
      recentA - recentB ||
      a.option.label.localeCompare(b.option.label) ||
      a.option.id.localeCompare(b.option.id)
    )
  })
  return scored.map((entry) => entry.option)
}

function readRecent(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function writeRecent(ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
  } catch {
    // Private mode or a full quota must not break place selection.
  }
}

function countryOption(country: Country): PlaceOption {
  return {
    id: country.id,
    label: country.label,
    kind: 'country',
    isoNumeric: country.iso_numeric,
    nCells: country.n_cells,
  }
}

function boxOption(region: Region): PlaceOption {
  return { id: region.id, label: region.label, kind: 'box' }
}

/**
 * One accessible combobox for countries plus the approximate boxes.
 *
 * Countries come from `loadCountries()` and may be empty before the schema
 * 1.2 export exists; the box regions still work in that case.
 */
export function PlaceSearch({
  onPick,
  placeholder = 'Search countries or regions',
  compact = false,
}: PlaceSearchProps) {
  const [options, setOptions] = useState<PlaceOption[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const labelId = useId()
  const listId = useId()

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCountries(), loadRegions()])
      .then(([countries, regions]) => {
        if (cancelled) return
        setOptions([...countries.map(countryOption), ...regions.map(boxOption)])
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(
    () => filterAndSortPlaces(options, query, recent),
    [options, query, recent],
  )
  const activeIndex = visible.length === 0 ? -1 : Math.min(Math.max(active, 0), visible.length - 1)

  function choose(option: PlaceOption): void {
    onPick({ kind: 'region', regionId: option.id })
    const next = [option.id, ...recent.filter((id) => id !== option.id)].slice(0, MAX_RECENT)
    setRecent(next)
    writeRecent(next)
    setQuery('')
    setOpen(false)
    setActive(0)
    inputRef.current?.blur()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (visible.length === 0) return
      setOpen(true)
      setActive((activeIndex + 1) % visible.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (visible.length === 0) return
      setOpen(true)
      setActive(activeIndex <= 0 ? visible.length - 1 : activeIndex - 1)
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && visible[activeIndex]) {
        event.preventDefault()
        choose(visible[activeIndex])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const containerStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    width: compact ? 190 : 'min(340px, 100%)',
  }
  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    font: 'inherit',
    fontSize: compact ? '0.85rem' : '0.9rem',
    padding: compact ? '4px 6px' : '6px 8px',
    color: 'var(--text)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
  }
  const listStyle: CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 2,
    maxHeight: 280,
    overflowY: 'auto',
    padding: 4,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgb(0 0 0 / 18%)',
    zIndex: 40,
  }

  return (
    <div className="place-search" style={containerStyle}>
      <label
        id={labelId}
        htmlFor={inputId}
        style={{ fontSize: '0.75rem', color: 'var(--muted)' }}
      >
        Place
      </label>
      <input
        id={inputId}
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-labelledby={labelId}
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={placeholder}
        disabled={status === 'error'}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => {
          setOpen(true)
          setActive(0)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        style={inputStyle}
      />

      {status === 'loading' && (
        <span role="status" style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
          Loading places…
        </span>
      )}
      {status === 'error' && (
        <span role="status" style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
          Places are unavailable.
        </span>
      )}

      {open && status === 'ready' && (
        <ul id={listId} role="listbox" aria-labelledby={labelId} style={listStyle}>
          {visible.length === 0 && (
            <li role="status" style={{ padding: '6px 8px', color: 'var(--muted)' }}>
              No matching place.
            </li>
          )}
          {visible.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              title={
                option.kind === 'country' && option.nCells !== undefined
                  ? `${option.nCells} grid cells inside the land mask`
                  : undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                background: index === activeIndex ? 'var(--accent)' : 'transparent',
                color: index === activeIndex ? '#fff' : 'var(--text)',
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
