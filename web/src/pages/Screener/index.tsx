import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { PlaceSearch } from '../../components/PlaceSearch'
import { Chip, Disclosure, HelpTip } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadRegionsFile, loadScreener } from '../../data/loaders'
import type { RegionsFile, ScreenerFile } from '../../data/types'
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
  hasDiscontinuityFields,
  metricValue,
  screenerHeadline,
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
  const { index, windowId, domain, setDomain, navigate } = useApp()
  const [regionsFile, setRegionsFile] = useState<RegionsFile | null>(null)
  const [regionsError, setRegionsError] = useState<string | null>(null)
  const [screener, setScreener] = useState<ScreenerFile | null>(null)
  const [screenerError, setScreenerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('significantArea')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')

  useEffect(() => {
    let cancelled = false
    loadRegionsFile()
      .then((file) => {
        if (!cancelled) setRegionsFile(file)
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
    loadScreener(windowId, domain)
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
  }, [windowId, domain])

  const windowMeta = index.windows.find((item) => item.id === windowId)
  const regions = regionsFile?.regions ?? []
  const countries = regionsFile?.countries ?? []
  const domainLabel =
    domain === 'global'
      ? 'global land'
      : (regions.find((region) => region.id === domain)?.label ??
        countries.find((country) => country.id === domain)?.label ??
        domain)
  const viewRows = useMemo(
    () => (screener ? buildViewRows(index.variables, screener.rows) : []),
    [index.variables, screener],
  )
  const sortedRows = useMemo(
    () => sortByMetric(viewRows, (row) => metricValue(row, sortKey), sortDir),
    [viewRows, sortKey, sortDir],
  )
  const empty = screener != null && domainHasNoEvaluatedCells(viewRows)
  const showQuality = hasDiscontinuityFields(viewRows)
  const headline = screenerHeadline(viewRows, domainLabel)

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('desc')
  }

  const openVariable = (variableId: string) => {
    navigate('discovery', { variableId, windowId })
  }

  return (
    <section className="screener">
      <header className="screener-head">
        <div>
          <p className="eyebrow">Evidence ranking</p>
          <h1>Variable Screener</h1>
          <p className="screener-promise">
            Which variables are changing, over how much area, how strongly, and where the directions disagree.
          </p>
        </div>
        <p className="screener-period">
          Period {windowMeta ? `${windowMeta.start} to ${windowMeta.end}` : windowId} · FDR q &lt;{' '}
          {index.q_threshold}
        </p>
      </header>

      <div className="screener-toolbar">
        <div className="screener-domain">
          <span className="field-label">Domain</span>
          <div className="screener-domain-row">
            <button
              type="button"
              className={domain === 'global' ? 'button primary' : 'button'}
              aria-pressed={domain === 'global'}
              onClick={() => setDomain('global')}
            >
              Global land
            </button>
            <PlaceSearch
              onPick={(selection) => setDomain(selection.regionId)}
              placeholder="Search a country or region"
            />
            <Chip tone="accent">{domainLabel}</Chip>
          </div>
        </div>
      </div>

      {regions == null && regionsError == null ? (
        <p className="screener-note" role="status">
          Loading domains…
        </p>
      ) : null}
      {regionsError ? (
        <p className="screener-status screener-status-error" role="alert">
          Could not load domains. {regionsError}
        </p>
      ) : null}

      {loading ? (
        <p className="screener-status" role="status">
          Loading the ranking for {domainLabel}…
        </p>
      ) : null}
      {screenerError ? (
        <p className="screener-status screener-status-error" role="alert">
          Could not load this domain. {screenerError}
        </p>
      ) : null}

      {!loading && !screenerError && screener ? (
        <>
          {!empty ? <p className="screener-headline">{headline}</p> : null}
          {!empty ? (
            <>
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
                      {showQuality ? (
                        <th scope="col">
                          Sudden shift
                          <HelpTip label="About the sudden-shift quality flag">
                            A flag means a step fits slightly better than a straight line. It could be a real jump in
                            the climate or a data artefact. A shift during a documented GLDAS input change
                            (2008–2012) is marked code 2: read the trend with caution.
                          </HelpTip>
                        </th>
                      ) : null}
                      <th scope="col">Map</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <ScreenerTableRow
                        key={row.variableId}
                        row={row}
                        windowId={windowId}
                        showQuality={showQuality}
                        onOpen={openVariable}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="screener-status" role="status">
              No cells were evaluated in {domainLabel} for this period, so there is nothing to rank.
            </p>
          )}
          <Disclosure summary="How to read this table">
            <p>
              &ldquo;Significant&rdquo; means a trend whose FDR-adjusted q-value is below {index.q_threshold}. The test
              is the Hamed–Rao modified Mann–Kendall test, corrected for autocorrelation and for testing thousands of
              grid cells.
            </p>
            <p>
              Area fractions are area-weighted over evaluated cells. Bars run from significant decrease on the left to
              significant increase on the right; the increase colour uses each variable&apos;s own meaning. Typical
              change is {MAGNITUDE_TOOLTIP}.
            </p>
            <p>
              The &ldquo;opposite trends&rdquo; score is near 0 when one direction dominates and near 0.5 when increase
              and decrease cover similar area. Coverage is the valid fraction of months in the window; below 70% is
              called out.
            </p>
            <p>
              Thumbnails show the full global trend grid and are not cropped to the selected domain. A{' '}
              <strong>sudden shift</strong> flag means a step fits slightly better than a straight line: it could be a
              real climate jump or a data artefact. Code 2 marks a shift during a documented GLDAS input change
              (2008–2012), so read the trend with caution.
            </p>
          </Disclosure>
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
  showQuality,
  onOpen,
}: {
  row: ScreenerViewRow
  windowId: string
  showQuality: boolean
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
      {showQuality ? (
        <td data-label="Sudden shift flag">
          {row.stepFlag == null ? (
            <span>—</span>
          ) : row.stepFlag > 0 ? (
            <span className="screener-quality">
              <Chip
                tone="warn"
                title="Sudden shift: a step fits slightly better than a straight line. It could be a real climate jump or a data artefact; read the evidence."
              >
                Sudden shift flagged
              </Chip>
              <span className="screener-meta">{formatPercent(row.stepFlag)} of area flagged</span>
              {row.sigTrendFlagged != null ? (
                <span className="screener-meta">
                  {formatPercent(row.sigTrendFlagged)} of significant area also flagged
                </span>
              ) : null}
            </span>
          ) : (
            <span className="screener-meta">No sudden shift detected</span>
          )}
        </td>
      ) : null}
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
