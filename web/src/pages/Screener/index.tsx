import { useEffect, useMemo, useState } from 'react'
import { PlaceSearch } from '../../components/PlaceSearch'
import { Chip, Disclosure, GlossaryTip } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadRegionsFile, loadScreener } from '../../data/loaders'
import type { RegionsFile, ScreenerFile } from '../../data/types'
import { formatUnit, type TermId } from '../../lib/format'
import { TrendThumbnail } from './TrendThumbnail'
import {
  MAGNITUDE_TOOLTIP,
  SORT_COLUMNS,
  WITNESS_SORT_COLUMN,
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
  hasWitnessFields,
  metricValue,
  screenerHeadline,
  sortByMetric,
  sortDescription,
  witnessConfirmedText,
  witnessContradictionWarning,
  type ScreenerSortColumn,
  type ScreenerViewRow,
  type SortDirection,
  type SortKey,
} from './metrics'
import './screener.css'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Each sort key explains itself with one glossary entry. */
const COLUMN_TERM: Record<SortKey, TermId> = {
  significantArea: 'significant',
  magnitude: 'rate_of_change',
  contrast: 'contrast',
  coverage: 'coverage',
  witness: 'second_witness',
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
  // Group by category. Groups are ordered by the best-ranked row they contain.
  const groups = useMemo(() => {
    const order: string[] = []
    const byCategory = new Map<string, ScreenerViewRow[]>()
    for (const row of sortedRows) {
      const list = byCategory.get(row.category)
      if (list) list.push(row)
      else {
        byCategory.set(row.category, [row])
        order.push(row.category)
      }
    }
    return order.map((category) => ({ category, rows: byCategory.get(category) ?? [] }))
  }, [sortedRows])
  const empty = screener != null && domainHasNoEvaluatedCells(viewRows)
  const showQuality = hasDiscontinuityFields(viewRows)
  const showWitness = hasWitnessFields(viewRows)
  const sortColumns: readonly ScreenerSortColumn[] = showWitness
    ? [...SORT_COLUMNS, WITNESS_SORT_COLUMN]
    : SORT_COLUMNS
  const headline = screenerHeadline(viewRows, domainLabel)

  const onSortKey = (key: SortKey) => {
    if (key === sortKey) return
    setSortKey(key)
    setSortDir('desc')
  }
  const toggleDir = () => setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))

  const openVariable = (variableId: string) => {
    navigate('discovery', { variableId, windowId })
  }

  const openEvidence = (variableId: string) => {
    if (domain === 'global') {
      navigate('investigate', { variableId, windowId })
      return
    }
    navigate('region', { variableId, windowId, selection: { kind: 'region', regionId: domain } })
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
        {!loading && !screenerError && screener && !empty ? (
          <div className="screener-sortrow">
            <label className="screener-sortfield">
              <span className="field-label">Sort by</span>
              <select value={sortKey} onChange={(event) => onSortKey(event.target.value as SortKey)}>
                {sortColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <GlossaryTip term={COLUMN_TERM[sortKey]} />
            <button
              type="button"
              className="button screener-dir"
              onClick={toggleDir}
              aria-label={
                sortDir === 'asc'
                  ? 'Order: smallest first. Switch to largest first'
                  : 'Order: largest first. Switch to smallest first'
              }
            >
              <span aria-hidden="true">{sortDir === 'asc' ? '↑ Smallest first' : '↓ Largest first'}</span>
            </button>
          </div>
        ) : null}
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
              <p className="screener-note" role="status">
                {sortDescription(sortKey, sortDir)} Missing values sort last.
              </p>
              {groups.map((group) => (
                <section
                  key={group.category}
                  className="screener-group"
                  aria-labelledby={`screener-cat-${group.category}`}
                >
                  <h2 className="label-caps screener-cat" id={`screener-cat-${group.category}`}>
                    {group.category}
                  </h2>
                  <ul className="screener-list" aria-label={`${group.category} variables`}>
                    {group.rows.map((row) => (
                      <ScreenerRowCard
                        key={row.variableId}
                        row={row}
                        windowId={windowId}
                        domain={domain}
                        domainLabel={domainLabel}
                        showQuality={showQuality}
                        showWitness={showWitness}
                        onOpen={openVariable}
                        onEvidence={openEvidence}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          ) : (
            <p className="screener-status" role="status">
              No cells were evaluated in {domainLabel} for this period, so there is nothing to rank.
            </p>
          )}
          <Disclosure summary="How to read this list">
            <p>
              &ldquo;Significant&rdquo; means a trend whose FDR-adjusted q-value is below {index.q_threshold}. The test
              is the Hamed–Rao modified Mann–Kendall test, corrected for autocorrelation and for testing thousands of
              grid cells.
            </p>
            <p>
              Area fractions are area-weighted over evaluated cells. The bar is the evaluated land: the cool part from
              the left is significant decrease, the warm part from the right is significant increase, and the grey
              between is everything else. The increase colour uses each variable&apos;s own meaning. Typical change is{' '}
              {MAGNITUDE_TOOLTIP}.
            </p>
            <p>
              The &ldquo;opposite trends&rdquo; score is near 0 when one direction dominates and near 0.5 when increase
              and decrease cover similar area. Coverage is the valid fraction of months in the window; below 70% is
              called out.
            </p>
            <p>
              Small maps show the full global trend grid and are not cropped to the selected domain. A{' '}
              <strong>sudden shift</strong> flag means a step fits slightly better than a straight line: it could be a
              real climate jump or a data artefact. Code 2 marks a shift during a documented GLDAS input change
              (2008–2012), so read the trend with caution.
            </p>
            {showWitness ? (
              <p>
                The <strong>second dataset</strong> chip reports the share of the significant area where an independent
                NASA dataset is also significant in the same direction. A high contradicted share is a warning to read
                the trend with caution, not a verdict.
              </p>
            ) : null}
          </Disclosure>
        </>
      ) : null}
    </section>
  )
}

/** Share of the full track, 0 to 100. Display only. */
function trackPercent(fraction: number | null): number {
  return barHalfPercent(fraction) * 2
}

/** The same facts as the card, in one sentence for assistive technology. */
function rowSentence(row: ScreenerViewRow): string {
  const parts = [`${row.label}.`]
  if (row.sigDecrease != null && row.sigIncrease != null) {
    parts.push(
      `${formatPercent(row.sigDecrease)} significant decrease, ${formatPercent(row.sigIncrease)} significant increase (${row.increaseMeans}).`,
    )
  } else {
    parts.push('Significant area not available.')
  }
  if (row.stepFlag != null && row.stepFlag > 0) {
    parts.push(`Sudden shift flagged over ${formatPercent(row.stepFlag)} of area.`)
  }
  const confirmed = witnessConfirmedText(row)
  if (confirmed) parts.push(`Second dataset: ${confirmed}.`)
  return parts.join(' ')
}

function ScreenerRowCard({
  row,
  windowId,
  domain,
  domainLabel,
  showQuality,
  showWitness,
  onOpen,
  onEvidence,
}: {
  row: ScreenerViewRow
  windowId: string
  domain: string
  domainLabel: string
  showQuality: boolean
  showWitness: boolean
  onOpen: (variableId: string) => void
  onEvidence: (variableId: string) => void
}) {
  const areaMissing = row.sigIncrease == null || row.sigDecrease == null
  const flagged = row.stepFlag != null && row.stepFlag > 0
  return (
    <li className="screener-row" aria-label={rowSentence(row)}>
      <div className="screener-main">
        <h3 className="screener-name">
          <button type="button" className="screener-name-btn" onClick={() => onOpen(row.variableId)}>
            {row.label}
          </button>
        </h3>
        {row.description ? <p className="screener-description">{row.description}</p> : null}
        {areaMissing ? (
          <p className="screener-meta">Significant area: —</p>
        ) : (
          <div className="screener-area">
            <span className="screener-end screener-end-down">
              <span className="num-mono">{formatPercent(row.sigDecrease)}</span>
              <span className="screener-end-word">decrease</span>
            </span>
            <div className="screener-track" aria-hidden="true">
              <span className="screener-bar screener-bar-down" style={{ width: `${trackPercent(row.sigDecrease)}%` }} />
              <span className="screener-bar screener-bar-up" style={{ width: `${trackPercent(row.sigIncrease)}%` }} />
            </div>
            <span className="screener-end screener-end-up">
              <span className="num-mono">{formatPercent(row.sigIncrease)}</span>
              <span className="screener-end-word">{row.increaseMeans}</span>
            </span>
          </div>
        )}
        <div className="screener-chips">
          {showQuality && flagged ? (
            <Chip
              tone="warn"
              title="Sudden shift: a step fits slightly better than a straight line. It could be a real climate jump or a data artefact; read the evidence."
            >
              Sudden shift flagged <span className="num-mono">{formatPercent(row.stepFlag)}</span>
            </Chip>
          ) : null}
          {showWitness && row.witnessCorroborated != null ? (
            <Chip tone="good">
              Second dataset: <span className="num-mono">{formatPercent(row.witnessCorroborated)}</span> confirmed
            </Chip>
          ) : null}
          {showWitness && witnessContradictionWarning(row) ? (
            <Chip
              tone="warn"
              title="A second dataset contradicts a substantial share of the significant area. Read the trend with caution; this is not a verdict."
            >
              High disagreement
            </Chip>
          ) : null}
          {coverageIsLow(row.coverage) ? (
            <span className="screener-warn">
              <WarningIcon />
              <span>Coverage below 70%</span>
            </span>
          ) : null}
        </div>
        <details className="screener-more">
          <summary>More metrics</summary>
          <dl className="screener-dl">
            <div>
              <dt>
                Typical change
                <GlossaryTip term="rate_of_change" />
              </dt>
              <dd title={MAGNITUDE_TOOLTIP}>
                <span className="num-mono">{formatMagnitude(row.magnitude)}</span>
              </dd>
            </div>
            <div>
              <dt>
                Opposite trends
                <GlossaryTip term="contrast" />
              </dt>
              <dd>
                {row.contrast == null ? (
                  <span className="num-mono">—</span>
                ) : (
                  <>
                    {contrastLabel(row.contrast)} (<span className="num-mono">{formatContrast(row.contrast)}</span> of
                    0.5)
                    <span className="screener-meter" aria-hidden="true">
                      <span
                        className="screener-meter-fill"
                        style={{ width: `${contrastMeterPercent(row.contrast)}%` }}
                      />
                    </span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>
                Coverage
                <GlossaryTip term="coverage" />
              </dt>
              <dd>
                <span className="num-mono">{formatPercent(row.coverage)}</span>
              </dd>
            </div>
            {showQuality ? (
              <div>
                <dt>
                  Sudden shift
                  <GlossaryTip term="sudden_shift" />
                </dt>
                <dd>
                  {row.stepFlag == null ? (
                    <span className="num-mono">—</span>
                  ) : flagged ? (
                    <>
                      <span className="num-mono">{formatPercent(row.stepFlag)}</span> of area flagged
                      {row.sigTrendFlagged != null ? (
                        <>
                          ; <span className="num-mono">{formatPercent(row.sigTrendFlagged)}</span> of significant area
                          also flagged
                        </>
                      ) : null}
                    </>
                  ) : (
                    'No sudden shift detected'
                  )}
                </dd>
              </div>
            ) : null}
            {showWitness ? (
              <div>
                <dt>
                  Second witness
                  <GlossaryTip term="second_witness" />
                </dt>
                <dd>
                  {row.witnessCorroborated == null ? (
                    'No witness value'
                  ) : (
                    <>
                      {witnessConfirmedText(row)}
                      {row.witnessContradicted != null ? (
                        <>
                          ; <span className="num-mono">{formatPercent(row.witnessContradicted)}</span> contradicted
                        </>
                      ) : null}
                    </>
                  )}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Cells evaluated</dt>
              <dd>
                <span className="num-mono">{formatCellCount(row.nCells)}</span>
              </dd>
            </div>
            <div>
              <dt>Unit and source</dt>
              <dd>
                {formatUnit(row.unit)} · {row.sourceBadge}
              </dd>
            </div>
          </dl>
          <div className="screener-actions">
            <button type="button" className="button" onClick={() => onOpen(row.variableId)}>
              Open the map
            </button>
            <button type="button" className="button" onClick={() => onEvidence(row.variableId)}>
              Open the evidence for {domain === 'global' ? 'the whole domain' : domainLabel}
            </button>
          </div>
        </details>
      </div>
      <button
        type="button"
        className="screener-thumbbtn"
        onClick={() => onOpen(row.variableId)}
        aria-label={`Open the map for ${row.label}`}
      >
        <TrendThumbnail
          variableId={row.variableId}
          windowId={windowId}
          label={row.label}
          increaseMeans={row.increaseMeans}
        />
      </button>
    </li>
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
