import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useApp } from '../../data/AppState'
import { loadRegions, loadScreener } from '../../data/loaders'
import type { Region, ScreenerFile } from '../../data/types'
import { TrendThumbnail } from './TrendThumbnail'
import {
  MAGNITUDE_TOOLTIP,
  SORT_COLUMNS,
  barHalfPercent,
  buildViewRows,
  contrastLabel,
  contrastMeterPercent,
  coverageIsLow,
  domainHasNoEvaluatedCells,
  formatCellCount,
  formatContrast,
  formatMagnitude,
  formatPercent,
  metricValue,
  sortByMetric,
  sortDescription,
  type ScreenerViewRow,
  type SortDirection,
  type SortKey,
} from './metrics'
import './screener.css'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function ariaSort(active: SortKey, direction: SortDirection, column: SortKey): 'ascending' | 'descending' | 'none' {
  if (active !== column) return 'none'
  return direction === 'asc' ? 'ascending' : 'descending'
}

export default function ScreenerPage() {
  const { index, windowId, navigate } = useApp()
  const [domainId, setDomainId] = useState('global')
  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionsError, setRegionsError] = useState<string | null>(null)
  const [screener, setScreener] = useState<ScreenerFile | null>(null)
  const [screenerError, setScreenerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('significantArea')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')

  useEffect(() => {
    let cancelled = false
    loadRegions()
      .then((list) => {
        if (!cancelled) setRegions(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setRegionsError(messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setScreener(null)
    setScreenerError(null)
    loadScreener(windowId, domainId)
      .then((file) => {
        if (cancelled) return
        setScreener(file)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setScreener(null)
        setScreenerError(messageOf(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [windowId, domainId])

  const windowMeta = index.windows.find((item) => item.id === windowId)
  const domainLabel =
    domainId === 'global' ? 'Global land' : (regions?.find((region) => region.id === domainId)?.label ?? domainId)
  const viewRows = useMemo(
    () => (screener ? buildViewRows(index.variables, screener.rows) : []),
    [index.variables, screener],
  )
  const sortedRows = useMemo(
    () => sortByMetric(viewRows, (row) => metricValue(row, sortKey), sortDir),
    [viewRows, sortKey, sortDir],
  )
  const empty = screener != null && domainHasNoEvaluatedCells(viewRows)

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('desc')
  }

  const openVariable = (variableId: string) => {
    navigate('discovery', { variableId })
  }

  return (
    <section className="screener">
      <header className="screener-intro">
        <p>This page shows which Earth variables are changing, over how much area, how strongly, and whether directions disagree across places.</p>
        <p>
          &quot;Significant&quot; means a trend whose FDR-adjusted q-value is below {index.q_threshold} (Mann–Kendall
          test, corrected for autocorrelation and for testing thousands of grid cells).
        </p>
      </header>

      <label className="screener-control">
        <span>Domain</span>
        <select value={domainId} onChange={(event) => setDomainId(event.target.value)} aria-describedby="screener-domain-note">
          <option value="global">Global land</option>
          {(regions ?? []).map((region) => (
            <option key={region.id} value={region.id}>
              {region.label}
            </option>
          ))}
        </select>
      </label>
      <p id="screener-domain-note" className="screener-note">
        Region boxes are approximate. Period {windowMeta ? `${windowMeta.start} to ${windowMeta.end}` : windowId} comes
        from the header.
      </p>
      {regions == null && regionsError == null ? (
        <p className="screener-note" role="status">
          Loading regions…
        </p>
      ) : null}
      {regionsError ? (
        <p className="screener-status screener-status-error" role="alert">
          Could not load regions. {regionsError}
        </p>
      ) : null}

      {loading ? (
        <p className="screener-status" role="status">
          Loading screener for {domainLabel}…
        </p>
      ) : null}
      {screenerError ? (
        <p className="screener-status screener-status-error" role="alert">
          Could not load this domain. {screenerError}
        </p>
      ) : null}
      {!loading && !screenerError && empty ? (
        <p className="screener-status" role="status">
          No cells were evaluated in {domainLabel} for this period, so there is nothing to rank.
        </p>
      ) : null}

      {!loading && !screenerError && screener && !empty ? (
        <>
          <p className="screener-note">
            Bars run from decrease on the left to increase on the right. The increase colour is labelled with that
            variable&apos;s increase meaning. Typical change: {MAGNITUDE_TOOLTIP}.
          </p>
          <p className="screener-note">
            Thumbnails show the full global trend grid for this period. They are not cropped to the selected domain.
          </p>
          <div className="screener-sortbar" role="group" aria-label="Sort by">
            {SORT_COLUMNS.map((column) => (
              <SortButton key={column.id} column={column} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            ))}
          </div>
          <div className="screener-table-wrap">
            <table className="screener-table">
              <caption>
                {sortDescription(sortKey, sortDir)} Missing values sort last.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Variable</th>
                  {SORT_COLUMNS.map((column) => (
                    <th key={column.id} scope="col" aria-sort={ariaSort(sortKey, sortDir, column.id)}>
                      <SortButton column={column} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    </th>
                  ))}
                  <th scope="col">Map</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <ScreenerTableRow key={row.variableId} row={row} windowId={windowId} onOpen={openVariable} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}

function SortButton({
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  column: (typeof SORT_COLUMNS)[number]
  sortKey: SortKey
  sortDir: SortDirection
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === column.id
  return (
    <button type="button" onClick={() => onSort(column.id)} aria-pressed={active}>
      {column.label}
      {active ? <span aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span> : null}
      {active ? <span className="screener-sr">{sortDir === 'asc' ? ', smallest first' : ', largest first'}</span> : null}
    </button>
  )
}

function ScreenerTableRow({
  row,
  windowId,
  onOpen,
}: {
  row: ScreenerViewRow
  windowId: string
  onOpen: (variableId: string) => void
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen(row.variableId)
  }
  const areaMissing = row.sigIncrease == null || row.sigDecrease == null
  return (
    <tr className="screener-row" tabIndex={0} onClick={() => onOpen(row.variableId)} onKeyDown={onKeyDown}>
      <th scope="row" data-label="Variable">
        <div className="screener-var">
          <strong>{row.label}</strong>
          <span className="screener-meta">{row.category}</span>
          <span className="screener-badge">{row.sourceBadge}</span>
          <span className="screener-meta">{row.unit}</span>
          <span className="screener-meta">
            {row.nCells == null ? 'Cells evaluated: —' : `${formatCellCount(row.nCells)} cells evaluated`}
          </span>
        </div>
      </th>
      <td data-label="Area with significant change (increase + decrease)">
        {areaMissing ? (
          <span>—</span>
        ) : (
          <div className="screener-area">
            <div className="screener-area-labels">
              <span className="screener-down-label">{formatPercent(row.sigDecrease)} decrease</span>
              <span className="screener-up-label">
                {formatPercent(row.sigIncrease)} {row.increaseMeans}
              </span>
            </div>
            <div className="screener-track" aria-hidden="true">
              <span className="screener-bar screener-bar-down" style={{ width: `${barHalfPercent(row.sigDecrease)}%` }} />
              <span className="screener-bar screener-bar-up" style={{ width: `${barHalfPercent(row.sigIncrease)}%` }} />
            </div>
          </div>
        )}
      </td>
      <td data-label="Typical change" title={MAGNITUDE_TOOLTIP}>
        {formatMagnitude(row.magnitude)}
      </td>
      <td data-label="Opposite trends">
        {row.contrast == null ? (
          <span>—</span>
        ) : (
          <div className="screener-contrast">
            <div className="screener-meter" aria-hidden="true">
              <div className="screener-meter-fill" style={{ width: `${contrastMeterPercent(row.contrast)}%` }} />
            </div>
            <div className="screener-meter-scale">
              <span>0</span>
              <span>0.5</span>
            </div>
            <span>{contrastLabel(row.contrast)}</span>
            <span className="screener-meta">{formatContrast(row.contrast)} of 0.5</span>
          </div>
        )}
      </td>
      <td data-label="Coverage">
        <span className="screener-coverage">
          <span>{formatPercent(row.coverage)}</span>
          {coverageIsLow(row.coverage) ? (
            <span className="screener-warn">
              <WarningIcon />
              <span>Below 70%</span>
            </span>
          ) : null}
        </span>
      </td>
      <td data-label="Map">
        <TrendThumbnail
          variableId={row.variableId}
          windowId={windowId}
          label={row.label}
          increaseMeans={row.increaseMeans}
        />
      </td>
    </tr>
  )
}

function WarningIcon() {
  return (
    <svg className="screener-warn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 1.7c.3-.6 1.3-.6 1.6 0l6 11.2c.3.6-.1 1.4-.8 1.4H2c-.7 0-1.1-.8-.8-1.4l6-11.2zM8 6.2c-.4 0-.7.3-.7.7v2.8c0 .4.3.7.7.7s.7-.3.7-.7V6.9c0-.4-.3-.7-.7-.7zm0 6.1a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z"
      />
    </svg>
  )
}
