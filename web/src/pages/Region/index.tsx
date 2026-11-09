import { useEffect, useMemo, useState } from 'react'
import { AnomalyTrendChart } from '../../charts/AnomalyTrendChart'
import { ComparisonChart } from '../../charts/ComparisonChart'
import { MonthlyValuesChart } from '../../charts/MonthlyValuesChart'
import { PlaceSearch } from '../../components/PlaceSearch'
import { useApp } from '../../data/AppState'
import { loadCountries, loadRegions } from '../../data/loaders'
import type { Country, Region, Selection } from '../../data/types'
import { CountryLocator } from './CountryLocator'
import { loadAnomalies, loadCellSpearman, loadPlace, type PlaceData } from './loadPlace'
import {
  annualMeanSeries,
  correlationPairId,
  senTrendSeries,
  spearmanInWindow,
  spearmanLabel,
  validateBbox,
  zScoresInWindow,
  type EvidenceModel,
} from './model'
import { qualityBannerText, qualityDetailText, type QualitySummary } from './quality'
import { summarySentence } from './summary'
import './region.css'

type RhoState = 'idle' | 'loading' | 'missing' | { rho: number; n: number | null }

function selectionKey(selection: Selection): string {
  if (selection == null) return 'none'
  if (selection.kind === 'cell') return `cell:${selection.row}:${selection.col}`
  if (selection.kind === 'region') return `region:${selection.regionId}`
  return `bbox:${selection.bbox.join(',')}`
}

export default function RegionPage() {
  const { index, variable, variableId, windowId, selection, setSelection } = useApp()
  const windowMeta = index.windows.find((item) => item.id === windowId) ?? index.windows[0]
  const key = selectionKey(selection)
  const [regions, setRegions] = useState<Region[] | null>(null)
  const [countries, setCountries] = useState<Country[]>([])
  const [regionsError, setRegionsError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ west: '', south: '', east: '', north: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [place, setPlace] = useState<PlaceData | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)
  const [loadingPlace, setLoadingPlace] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('Loading series…')
  const [secondId, setSecondId] = useState(
    () => index.variables.find((item) => item.id !== variableId)?.id ?? '',
  )
  const [secondAnomalies, setSecondAnomalies] = useState<(number | null)[] | null>(null)
  const [secondError, setSecondError] = useState<string | null>(null)
  const [loadingSecond, setLoadingSecond] = useState(false)
  const [rhoState, setRhoState] = useState<RhoState>('idle')

  const resolvedSecond =
    secondId !== variableId && index.variables.some((item) => item.id === secondId)
      ? secondId
      : (index.variables.find((item) => item.id !== variableId)?.id ?? '')
  const secondVariable = index.variables.find((item) => item.id === resolvedSecond) ?? null
  const pair = resolvedSecond ? correlationPairId(variableId, resolvedSecond) : ''
  const canPrecompute = selection?.kind === 'cell' && pair !== '' && index.correlation_pairs.includes(pair)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadRegions(), loadCountries()])
      .then(([list, countryList]) => {
        if (cancelled) return
        setRegions(list)
        setCountries(countryList)
      })
      .catch((error: unknown) => {
        if (!cancelled) setRegionsError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSecondId((prev) => {
      if (prev && prev !== variableId && index.variables.some((item) => item.id === prev)) return prev
      return index.variables.find((item) => item.id !== variableId)?.id ?? ''
    })
  }, [variableId, index])

  useEffect(() => {
    if (!selection || !windowMeta) {
      setPlace(null)
      setPlaceError(null)
      setLoadingPlace(false)
      return
    }
    let cancelled = false
    setLoadingPlace(true)
    setPlace(null)
    setPlaceError(null)
    setLoadingMessage(selection.kind === 'bbox' ? 'Loading tiles… Each tile is about 115 KB.' : 'Loading series…')
    loadPlace(index, variable, windowMeta, selection, {
      onProgress: (message) => {
        if (!cancelled) setLoadingMessage(message)
      },
    })
      .then((data) => {
        if (cancelled) return
        setPlace(data)
        setLoadingPlace(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPlace(null)
        setPlaceError(error instanceof Error ? error.message : String(error))
        setLoadingPlace(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, windowId, variableId, index, variable, selection, windowMeta])

  useEffect(() => {
    if (!selection || !resolvedSecond) {
      setSecondAnomalies(null)
      setSecondError(null)
      setLoadingSecond(false)
      return
    }
    let cancelled = false
    setLoadingSecond(true)
    setSecondError(null)
    setSecondAnomalies(null)
    loadAnomalies(index, resolvedSecond, selection)
      .then((series) => {
        if (cancelled) return
        setSecondAnomalies(series)
        setLoadingSecond(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSecondAnomalies(null)
        setSecondError(error instanceof Error ? error.message : String(error))
        setLoadingSecond(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, resolvedSecond, index, selection])

  useEffect(() => {
    if (!canPrecompute || selection?.kind !== 'cell') {
      setRhoState('idle')
      return
    }
    let cancelled = false
    setRhoState('loading')
    loadCellSpearman(pair, windowId, selection.row, selection.col)
      .then((result) => {
        if (!cancelled) setRhoState(result ?? 'missing')
      })
      .catch(() => {
        if (!cancelled) setRhoState('missing')
      })
    return () => {
      cancelled = true
    }
  }, [canPrecompute, pair, windowId, key, selection])

  const zPrimary = useMemo(
    () => (place && windowMeta ? zScoresInWindow(place.months, place.anomalies, windowMeta.start, windowMeta.end) : []),
    [place, windowMeta],
  )
  const zSecond = useMemo(
    () =>
      place && windowMeta && secondAnomalies
        ? zScoresInWindow(place.months, secondAnomalies, windowMeta.start, windowMeta.end)
        : [],
    [place, windowMeta, secondAnomalies],
  )

  const trendSeries =
    place?.trend && windowMeta ? senTrendSeries(place.months, windowMeta.start, windowMeta.end, place.trend) : null
  const annualMeans = useMemo(
    () =>
      place && windowMeta
        ? annualMeanSeries(place.months, place.anomalies, windowMeta.start, windowMeta.end)
        : null,
    [place, windowMeta],
  )
  const knownForcingPeriod = place
    ? (index.quality?.known_forcing_changes[place.evidence.product] ?? null)
    : null
  const qualityBanner = place
    ? qualityBannerText(place.quality, place.evidence.product, place.evidence.productVersion, knownForcingPeriod)
    : null
  const summary =
    place && windowMeta
      ? summarySentence({
          evidence: place.evidence,
          placeLabel: place.plainLabel,
          windowStart: windowMeta.start,
          windowEnd: windowMeta.end,
          quality: place.quality,
          knownForcingPeriod,
        })
      : null
  const others = index.variables.filter((item) => item.id !== variableId)
  const categories = [...new Set(others.map((item) => item.category))]

  return (
    <section className="region-page">
      <div className="region-heading">
        <h2>{selection ? (place?.title ?? 'Region Explorer') : 'Choose a place'}</h2>
        {selection && (
          <button type="button" className="region-button secondary" onClick={() => setSelection(null)}>
            Choose a different place
          </button>
        )}
      </div>
      {selection == null ? (
        <Picker
          regions={regions}
          countries={countries}
          regionsError={regionsError}
          draft={draft}
          formError={formError}
          onDraft={(field, value) => {
            setDraft((prev) => ({ ...prev, [field]: value }))
            setFormError(null)
          }}
          onRegion={(regionId) => setSelection({ kind: 'region', regionId })}
          onSubmit={() => {
            const parsed = validateBbox(draft)
            if (!parsed.ok) {
              setFormError(parsed.message)
              return
            }
            setFormError(null)
            setSelection({ kind: 'bbox', bbox: parsed.bbox })
          }}
        />
      ) : (
        <Explorer
          place={place}
          placeError={placeError}
          loadingPlace={loadingPlace}
          loadingMessage={loadingMessage}
          windowStart={windowMeta?.start ?? ''}
          windowEnd={windowMeta?.end ?? ''}
          variableLabel={variable.label}
          others={others}
          categories={categories}
          secondId={resolvedSecond}
          secondLabel={secondVariable?.label ?? 'Second variable'}
          onSecond={setSecondId}
          zPrimary={zPrimary}
          zSecond={zSecond}
          secondAnomalies={secondAnomalies}
          secondError={secondError}
          loadingSecond={loadingSecond}
          rhoLabel={rhoText(canPrecompute, rhoState, place, secondAnomalies, loadingSecond, windowMeta)}
          trendMonths={trendSeries?.months ?? null}
          trendY={trendSeries?.y ?? null}
          annualMeans={annualMeans}
          summary={summary}
          qualityBanner={qualityBanner}
        />
      )}
    </section>
  )
}

function rhoText(
  canPrecompute: boolean,
  rhoState: RhoState,
  place: PlaceData | null,
  secondAnomalies: (number | null)[] | null,
  loadingSecond: boolean,
  windowMeta: { start: string; end: string } | undefined,
): string {
  if (!place || !windowMeta) return ''
  if (loadingSecond || !secondAnomalies) return 'Loading the second series…'
  if (canPrecompute && (rhoState === 'idle' || rhoState === 'loading')) return 'Loading precomputed Spearman ρ…'
  if (canPrecompute && typeof rhoState === 'object') return spearmanLabel('precomputed', rhoState.rho, rhoState.n)
  const live = spearmanInWindow(place.months, place.anomalies, secondAnomalies, windowMeta.start, windowMeta.end)
  return spearmanLabel('computed', live.rho, live.n)
}

function Picker({
  regions,
  countries,
  regionsError,
  draft,
  formError,
  onDraft,
  onRegion,
  onSubmit,
}: {
  regions: Region[] | null
  countries: Country[]
  regionsError: string | null
  draft: { west: string; south: string; east: string; north: string }
  formError: string | null
  onDraft: (field: 'west' | 'south' | 'east' | 'north', value: string) => void
  onRegion: (regionId: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="region-stack">
      <p className="muted">
        Pick a country, a predefined region, or enter an approximate box. You can also click a cell on the Global
        Discovery map.
      </p>
      {PlaceSearch && (
        <article className="region-card">
          <h3>Search places</h3>
          <PlaceSearch
            onPick={(selection) => onRegion(selection.regionId)}
            placeholder="Search a country or region"
            compact
          />
        </article>
      )}
      {countries.length > 0 && (
        <article className="region-card">
          <h3>Countries</h3>
          <p className="muted">
            Natural Earth country regions with at least three cells in the common mask.
          </p>
          <ul className="region-list">
            {countries.map((country) => (
              <li key={country.id}>
                <button type="button" className="region-button secondary" onClick={() => onRegion(country.id)}>
                  {country.label}
                  <small>{country.n_cells} cells inside the common mask</small>
                </button>
              </li>
            ))}
          </ul>
        </article>
      )}
      <article className="region-card">
        <h3>Predefined regions</h3>
        <p className="muted">These boxes are approximate.</p>
        {regionsError && (
          <p className="inline-error" role="alert">
            {regionsError}
          </p>
        )}
        {regions == null && !regionsError && (
          <p className="region-status" role="status">
            Loading regions…
          </p>
        )}
        {regions && regions.length === 0 && <p className="muted">No predefined regions are listed.</p>}
        {regions && regions.length > 0 && (
          <ul className="region-list">
            {regions.map((region) => (
              <li key={region.id}>
                <button type="button" className="region-button secondary" onClick={() => onRegion(region.id)}>
                  {region.label}
                  <small>
                    Approximate box [west, south, east, north]: {region.bbox.join(', ')}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="region-card">
        <h3>Custom box</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <div className="region-grid">
            <Field label="West" value={draft.west} onChange={(value) => onDraft('west', value)} />
            <Field label="South" value={draft.south} onChange={(value) => onDraft('south', value)} />
            <Field label="East" value={draft.east} onChange={(value) => onDraft('east', value)} />
            <Field label="North" value={draft.north} onChange={(value) => onDraft('north', value)} />
          </div>
          {formError && (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          )}
          <div className="region-actions">
            <button type="submit" className="region-button">
              Show this box
            </button>
          </div>
        </form>
      </article>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function Explorer({
  place,
  placeError,
  loadingPlace,
  loadingMessage,
  windowStart,
  windowEnd,
  variableLabel,
  others,
  categories,
  secondId,
  secondLabel,
  onSecond,
  zPrimary,
  zSecond,
  secondAnomalies,
  secondError,
  loadingSecond,
  rhoLabel,
  trendMonths,
  trendY,
  annualMeans,
  summary,
  qualityBanner,
}: {
  place: PlaceData | null
  placeError: string | null
  loadingPlace: boolean
  loadingMessage: string
  windowStart: string
  windowEnd: string
  variableLabel: string
  others: { id: string; label: string; category: string; source_type: 'model' | 'mission_observation' }[]
  categories: string[]
  secondId: string
  secondLabel: string
  onSecond: (id: string) => void
  zPrimary: (number | null)[]
  zSecond: (number | null)[]
  secondAnomalies: (number | null)[] | null
  secondError: string | null
  loadingSecond: boolean
  rhoLabel: string
  trendMonths: string[] | null
  trendY: number[] | null
  annualMeans: { x: string[]; y: number[] } | null
  summary: string | null
  qualityBanner: string | null
}) {
  const caption =
    place?.evidence.source === 'precomputed'
      ? 'Shaded band is the current window. The Sen line uses the precomputed per-year slope. Dots are annual means of the monthly anomalies.'
      : 'Shaded band is the current window. The Sen line is the fit used in the evidence card. Dots are annual means of the monthly anomalies.'
  return (
    <div className="region-stack">
      {place && <p className="muted">{place.detail}</p>}
      {loadingPlace && (
        <p className="region-status" role="status">
          {loadingMessage}
        </p>
      )}
      {placeError && (
        <p className="inline-error" role="alert">
          {placeError}
        </p>
      )}
      {place && (
        <>
          {place.note && <p className="region-warn">{place.note}</p>}
          {summary && <p className="plain-summary">{summary}</p>}
          {place.country && (
            <article className="region-card">
              <CountryLocator key={place.country.id} country={place.country} />
            </article>
          )}
          <EvidenceCard evidence={place.evidence} quality={place.quality} qualityBanner={qualityBanner} />
          <article className="region-card">
            <MonthlyValuesChart months={place.months} values={place.values} unit={place.unit} label={variableLabel} />
          </article>
          <article className="region-card">
            <AnomalyTrendChart
              months={place.months}
              anomalies={place.anomalies}
              unit={place.unit}
              label={variableLabel}
              windowStart={windowStart}
              windowEnd={windowEnd}
              trendMonths={trendMonths}
              trendY={trendY}
              annualMeans={annualMeans}
              breakYear={place.quality?.breakYear ?? null}
              caption={trendY ? caption : `${caption} Not enough valid months to draw a Sen line.`}
            />
          </article>
          <article className="region-card">
            <fieldset className="compare-box">
              <legend>Second variable</legend>
              {others.length === 0 ? (
                <p className="muted">No second variable is available.</p>
              ) : (
                <label className="control">
                  <span>Compare anomalies with</span>
                  <select value={secondId} onChange={(event) => onSecond(event.target.value)}>
                    {categories.map((category) => (
                      <optgroup key={category} label={category}>
                        {others
                          .filter((item) => item.category === category)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({item.source_type === 'model' ? 'model' : 'satellite'})
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>
            {secondError && (
              <p className="inline-error" role="alert">
                {secondError}
              </p>
            )}
            {loadingSecond && (
              <p className="region-status" role="status">
                Loading the second variable…
              </p>
            )}
            {secondAnomalies && others.length > 0 && (
              <ComparisonChart
                months={place.months}
                seriesA={zPrimary}
                seriesB={zSecond}
                labelA={variableLabel}
                labelB={secondLabel}
                rhoLabel={rhoLabel}
              />
            )}
          </article>
        </>
      )}
    </div>
  )
}

function EvidenceCard({
  evidence,
  quality,
  qualityBanner,
}: {
  evidence: EvidenceModel
  quality: QualitySummary | null
  qualityBanner: string | null
}) {
  const qualityDetail = qualityDetailText(quality)
  return (
    <article className="region-card">
      <h3>Evidence</h3>
      {evidence.shortWindow && (
        <p className="region-warn" role="status">
          This window is shorter than 10 years. The trend test on a short window is not reliable.
        </p>
      )}
      {qualityBanner && (
        <p className="quality-banner" role="status">
          {qualityBanner}
        </p>
      )}
      <p className="method-banner">{evidence.method}</p>
      <dl className="evidence-grid">
        <dt>Variable</dt>
        <dd>{evidence.variableLabel}</dd>
        <dt>Product</dt>
        <dd>
          {evidence.product} version {evidence.productVersion}
        </dd>
        <dt>DOI</dt>
        <dd>
          {evidence.doi ? (
            <a href={`https://doi.org/${evidence.doi}`} target="_blank" rel="noreferrer">
              {evidence.doi}
            </a>
          ) : (
            'Not listed'
          )}
        </dd>
        <dt>Source variable</dt>
        <dd>{evidence.sourceVariable}</dd>
        <dt>Window</dt>
        <dd>{evidence.windowLabel}</dd>
        <dt>Sen slope per decade</dt>
        <dd>{evidence.senSlopeDecade == null ? '—' : `${formatSlope(evidence.senSlopeDecade)} ${evidence.slopeUnit}`}</dd>
        <dt>Mann–Kendall p</dt>
        <dd>{formatStat(evidence.p)}</dd>
        {evidence.showQ && (
          <>
            <dt>Mann–Kendall q</dt>
            <dd>{formatStat(evidence.q)}</dd>
          </>
        )}
        <dt>Kendall τ</dt>
        <dd>{formatStat(evidence.tau)}</dd>
        <dt>Valid months</dt>
        <dd>
          {evidence.validMonths == null ? '—' : Math.round(evidence.validMonths)} / {evidence.monthsInWindow}
        </dd>
        <dt>Coverage</dt>
        <dd>
          <div>{formatCoverage(evidence.coverage)}</div>
          {evidence.coverageNote && <div className="muted">{evidence.coverageNote}</div>}
        </dd>
        <dt>Trend class</dt>
        <dd>{evidence.trendClass}</dd>
        {qualityDetail && (
          <>
            <dt>Data-quality check</dt>
            <dd>{qualityDetail}</dd>
          </>
        )}
        {evidence.cellsUsed != null && (
          <>
            <dt>Cells used</dt>
            <dd>
              {evidence.cellsUsed} of {evidence.maskCells ?? '—'} mask cells
              {evidence.cellsInBox != null ? ` (${evidence.cellsInBox} cells inside the box)` : ''}
            </dd>
          </>
        )}
        {evidence.missingTiles && (
          <>
            <dt>Missing tiles</dt>
            <dd className="missing-tiles">{evidence.missingTiles.length === 0 ? 'none' : evidence.missingTiles.join(', ')}</dd>
          </>
        )}
      </dl>
      <h3 className="spaced">Caveats</h3>
      {evidence.caveats.length === 0 ? (
        <p className="muted">No caveats listed.</p>
      ) : (
        <ul className="region-caveats">
          {evidence.caveats.map((caveat, i) => (
            <li key={`${i}-${caveat}`}>{caveat}</li>
          ))}
        </ul>
      )}
    </article>
  )
}

function formatSlope(value: number): string {
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.001 || abs >= 10000)) return value.toExponential(3)
  return value.toFixed(4)
}

function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs !== 0 && abs < 0.0001) return value.toExponential(2)
  return value.toFixed(4)
}

function formatCoverage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}
