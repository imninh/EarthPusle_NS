import { useEffect, useMemo, useState } from 'react'
import { PlaceSearch } from '../../components/PlaceSearch'
import { Chip, Disclosure, GlossaryTip } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadRegionsFile, loadScreener } from '../../data/loaders'
import type { RegionsFile, ScreenerFile } from '../../data/types'
import { pick, useLang, useStrings, variableLabel, type Lang } from '../../i18n'
import { formatUnitIn, type TermId } from '../../lib/format'
import { variableDescription } from '../../i18n/terms'
import { TrendThumbnail } from './TrendThumbnail'
import {
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
  magnitudeTooltip,
  metricValue,
  screenerHeadline,
  sortByMetric,
  sortColumnLabel,
  sortDescription,
  witnessConfirmedText,
  witnessContradictionWarning,
  type ScreenerSortColumn,
  type ScreenerViewRow,
  type SortDirection,
  type SortKey,
} from './metrics'
import { INCREASE_MEANS_VI, SCREENER_STRINGS, categoryName } from './strings'
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
  const { lang } = useLang()
  const s = useStrings(SCREENER_STRINGS)
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
      ? s.globalLandLower
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
  const headline = screenerHeadline(viewRows, domainLabel, undefined, lang)

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
          <p className="eyebrow">{s.eyebrow}</p>
          <h1>{s.title}</h1>
          <p className="screener-promise">{s.promise}</p>
        </div>
        <p className="screener-period">
          {windowMeta
            ? s.period(windowMeta.start, windowMeta.end, index.q_threshold)
            : s.period(windowId, null, index.q_threshold)}
        </p>
      </header>

      <div className="screener-toolbar">
        <div className="screener-domain">
          <span className="field-label">{s.domain}</span>
          <div className="screener-domain-row">
            <button
              type="button"
              className={domain === 'global' ? 'button primary' : 'button'}
              aria-pressed={domain === 'global'}
              onClick={() => setDomain('global')}
            >
              {s.globalLand}
            </button>
            <PlaceSearch
              onPick={(selection) => setDomain(selection.regionId)}
              placeholder={s.searchPlaceholder}
            />
            <Chip tone="accent">{domainLabel}</Chip>
          </div>
        </div>
        {!loading && !screenerError && screener && !empty ? (
          <div className="screener-sortrow">
            <label className="screener-sortfield">
              <span className="field-label">{s.sortBy}</span>
              <select value={sortKey} onChange={(event) => onSortKey(event.target.value as SortKey)}>
                {sortColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {sortColumnLabel(column.id, lang)}
                  </option>
                ))}
              </select>
            </label>
            <GlossaryTip term={COLUMN_TERM[sortKey]} />
            <button
              type="button"
              className="button screener-dir"
              onClick={toggleDir}
              aria-label={sortDir === 'asc' ? s.dirAscAria : s.dirDescAria}
            >
              <span aria-hidden="true">{sortDir === 'asc' ? s.dirAscText : s.dirDescText}</span>
            </button>
          </div>
        ) : null}
      </div>

      {regions == null && regionsError == null ? (
        <p className="screener-note" role="status">
          {s.loadingDomains}
        </p>
      ) : null}
      {regionsError ? (
        <p className="screener-status screener-status-error" role="alert">
          {s.domainsError(regionsError)}
        </p>
      ) : null}

      {loading ? (
        <p className="screener-status" role="status">
          {s.loadingRanking(domainLabel)}
        </p>
      ) : null}
      {screenerError ? (
        <p className="screener-status screener-status-error" role="alert">
          {s.domainError(screenerError)}
        </p>
      ) : null}

      {!loading && !screenerError && screener ? (
        <>
          {!empty ? <p className="screener-headline">{headline}</p> : null}
          {!empty ? (
            <>
              <p className="screener-note" role="status">
                {sortDescription(sortKey, sortDir, lang)} {s.missingLast}
              </p>
              {groups.map((group) => (
                <section
                  key={group.category}
                  className="screener-group"
                  aria-labelledby={`screener-cat-${group.category}`}
                >
                  <h2 className="label-caps screener-cat" id={`screener-cat-${group.category}`}>
                    {categoryName(group.category, s)}
                  </h2>
                  <ul className="screener-list" aria-label={s.categoryVariables(categoryName(group.category, s))}>
                    {group.rows.map((row) => (
                      <ScreenerRowCard
                        key={row.variableId}
                        row={row}
                        lang={lang}
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
              {s.emptyDomain(domainLabel)}
            </p>
          )}
          <Disclosure summary={s.howToRead}>
            <p>{s.readSignificant(index.q_threshold)}</p>
            <p>{s.readAreas(magnitudeTooltip(lang))}</p>
            <p>{s.readOpposite}</p>
            <p>
              {s.readShiftBefore}
              <strong>{s.readShiftStrong}</strong>
              {s.readShiftAfter}
            </p>
            {showWitness ? (
              <p>
                {s.readWitnessBefore}
                <strong>{s.readWitnessStrong}</strong>
                {s.readWitnessAfter}
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
function rowSentence(row: ScreenerViewRow, name: string, means: string, lang: Lang): string {
  const s = pick(SCREENER_STRINGS, lang)
  const parts = [`${name}.`]
  if (row.sigDecrease != null && row.sigIncrease != null) {
    parts.push(s.rowDecreaseIncrease(formatPercent(row.sigDecrease), formatPercent(row.sigIncrease), means))
  } else {
    parts.push(s.rowAreaUnavailable)
  }
  if (row.stepFlag != null && row.stepFlag > 0) {
    parts.push(s.rowShiftFlagged(formatPercent(row.stepFlag)))
  }
  const confirmed = witnessConfirmedText(row, lang)
  if (confirmed) parts.push(s.rowSecondDataset(confirmed))
  return parts.join(' ')
}

function ScreenerRowCard({
  row,
  lang,
  windowId,
  domain,
  domainLabel,
  showQuality,
  showWitness,
  onOpen,
  onEvidence,
}: {
  row: ScreenerViewRow
  lang: Lang
  windowId: string
  domain: string
  domainLabel: string
  showQuality: boolean
  showWitness: boolean
  onOpen: (variableId: string) => void
  onEvidence: (variableId: string) => void
}) {
  const s = useStrings(SCREENER_STRINGS)
  const areaMissing = row.sigIncrease == null || row.sigDecrease == null
  const flagged = row.stepFlag != null && row.stepFlag > 0
  const name = variableLabel({ id: row.variableId, label: row.label }, lang)
  const means = lang === 'vi' ? (INCREASE_MEANS_VI[row.increaseMeans] ?? row.increaseMeans) : row.increaseMeans
  const description = variableDescription({ id: row.variableId, description: row.description }, lang)
  const tooltip = magnitudeTooltip(lang)
  return (
    <li className="screener-row" aria-label={rowSentence(row, name, means, lang)}>
      <div className="screener-main">
        <h3 className="screener-name">
          <button type="button" className="screener-name-btn" onClick={() => onOpen(row.variableId)}>
            {name}
          </button>
        </h3>
        {description ? <p className="screener-description">{description}</p> : null}
        {areaMissing ? (
          <p className="screener-meta">{s.significantAreaMissing}</p>
        ) : (
          <div className="screener-area">
            <span className="screener-end screener-end-down">
              <span className="num-mono">{formatPercent(row.sigDecrease)}</span>
              <span className="screener-end-word">{s.decrease}</span>
            </span>
            <div className="screener-track" aria-hidden="true">
              <span className="screener-bar screener-bar-down" style={{ width: `${trackPercent(row.sigDecrease)}%` }} />
              <span className="screener-bar screener-bar-up" style={{ width: `${trackPercent(row.sigIncrease)}%` }} />
            </div>
            <span className="screener-end screener-end-up">
              <span className="num-mono">{formatPercent(row.sigIncrease)}</span>
              <span className="screener-end-word">{means}</span>
            </span>
          </div>
        )}
        <div className="screener-chips">
          {showQuality && flagged ? (
            <Chip tone="warn" title={s.suddenShiftTitle}>
              {s.suddenShiftFlagged} <span className="num-mono">{formatPercent(row.stepFlag)}</span>
            </Chip>
          ) : null}
          {showWitness && row.witnessCorroborated != null ? (
            <Chip tone="good">
              {s.witnessChipBefore} <span className="num-mono">{formatPercent(row.witnessCorroborated)}</span>{' '}
              {s.witnessChipAfter}
            </Chip>
          ) : null}
          {showWitness && witnessContradictionWarning(row) ? (
            <Chip tone="warn" title={s.highDisagreementTitle}>
              {s.highDisagreement}
            </Chip>
          ) : null}
          {coverageIsLow(row.coverage) ? (
            <span className="screener-warn">
              <WarningIcon />
              <span>{s.coverageLow}</span>
            </span>
          ) : null}
        </div>
        <details className="screener-more">
          <summary>{s.moreMetrics}</summary>
          <dl className="screener-dl">
            <div>
              <dt>
                {s.typicalChange}
                <GlossaryTip term="rate_of_change" />
              </dt>
              <dd title={tooltip}>
                <span className="num-mono">{formatMagnitude(row.magnitude)}</span>
              </dd>
            </div>
            <div>
              <dt>
                {s.oppositeTrends}
                <GlossaryTip term="contrast" />
              </dt>
              <dd>
                {row.contrast == null ? (
                  <span className="num-mono">—</span>
                ) : (
                  <>
                    {contrastLabel(row.contrast, lang)} {s.contrastOfBefore}
                    <span className="num-mono">{formatContrast(row.contrast)}</span>
                    {s.contrastOfAfter}
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
                {s.coverage}
                <GlossaryTip term="coverage" />
              </dt>
              <dd>
                <span className="num-mono">{formatPercent(row.coverage)}</span>
              </dd>
            </div>
            {showQuality ? (
              <div>
                <dt>
                  {s.suddenShift}
                  <GlossaryTip term="sudden_shift" />
                </dt>
                <dd>
                  {row.stepFlag == null ? (
                    <span className="num-mono">—</span>
                  ) : flagged ? (
                    <>
                      <span className="num-mono">{formatPercent(row.stepFlag)}</span>
                      {s.flaggedAreaAfter}
                      {row.sigTrendFlagged != null ? (
                        <>
                          {s.alsoFlaggedBefore}
                          <span className="num-mono">{formatPercent(row.sigTrendFlagged)}</span>
                          {s.alsoFlaggedAfter}
                        </>
                      ) : null}
                    </>
                  ) : (
                    s.noSuddenShift
                  )}
                </dd>
              </div>
            ) : null}
            {showWitness ? (
              <div>
                <dt>
                  {s.secondWitness}
                  <GlossaryTip term="second_witness" />
                </dt>
                <dd>
                  {row.witnessCorroborated == null ? (
                    s.noWitnessValue
                  ) : (
                    <>
                      {witnessConfirmedText(row, lang)}
                      {row.witnessContradicted != null ? (
                        <>
                          {s.alsoFlaggedBefore}
                          <span className="num-mono">{formatPercent(row.witnessContradicted)}</span>
                          {s.contradictedAfter}
                        </>
                      ) : null}
                    </>
                  )}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{s.cellsEvaluated}</dt>
              <dd>
                <span className="num-mono">{formatCellCount(row.nCells)}</span>
              </dd>
            </div>
            <div>
              <dt>{s.unitAndSource}</dt>
              <dd>
                {formatUnitIn(row.unit, lang)} · {s.sourceBadge[row.sourceBadge] ?? row.sourceBadge}
              </dd>
            </div>
          </dl>
          <div className="screener-actions">
            <button type="button" className="button" onClick={() => onOpen(row.variableId)}>
              {s.openMap}
            </button>
            <button type="button" className="button" onClick={() => onEvidence(row.variableId)}>
              {s.openEvidence(domain === 'global' ? s.wholeDomain : domainLabel)}
            </button>
          </div>
        </details>
      </div>
      <button
        type="button"
        className="screener-thumbbtn"
        onClick={() => onOpen(row.variableId)}
        aria-label={s.openMapFor(name)}
      >
        <TrendThumbnail variableId={row.variableId} windowId={windowId} label={name} increaseMeans={means} />
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
