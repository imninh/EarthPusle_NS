import { useEffect, useMemo, useState } from 'react'
import { AnomalyTrendChart } from '../../charts/AnomalyTrendChart'
import { ComparisonChart } from '../../charts/ComparisonChart'
import { MonthlyValuesChart } from '../../charts/MonthlyValuesChart'
import { PlaceSearch } from '../../components/PlaceSearch'
import { Disclosure, Exhibit, GlossaryTip, HelpTip, IntervalBar } from '../../components/ui'

import { useApp } from '../../data/AppState'
import { loadCountries, loadRegions } from '../../data/loaders'
import type { Country, Region, Selection } from '../../data/types'
import { useLang, useStrings, variableLabel as variableName, type Lang } from '../../i18n'
import { formatUnit, glossaryEntry, sourceLabel, plainVerdict, type PlainVerdict } from '../../lib/format'
import { CaseHeader } from './CaseHeader'
import { buildCheckYourself, type CheckYourselfModel } from './checkYourself'
import { regionDetection, type RegionDetection } from './detection'
import { CheckYourselfPanel } from './RegionCheckYourself'
import { buildCitation, buildRegionCsv, copyText, downloadTextFile } from './download'
import { loadAnomalies, loadCellSpearman, loadPlace, type PlaceData } from './loadPlace'
import {
  annualMeanSeries,
  correlationPairId,
  formatInterval,
  formatSignedRate,
  senTrendBandSeries,
  senTrendSeries,
  spearmanInWindow,
  spearmanLabel,
  trendClassCode,
  validateBbox,
  zScoresInWindow,
  type EvidenceModel,
} from './model'
import { qualityBannerText, qualityDetailText, type QualitySummary } from './quality'
import { summarySentence } from './summary'
import { VerdictStrip, witnessIsCaution } from './VerdictStrip'
import { witnessAgreementText, type WitnessInfo } from './witness'
import { CASE_STRINGS, PAGE_STRINGS } from './strings'
import {
  categoryLabel,
  localizeCoverageNote,
  localizeDetail,
  localizeMessage,
  localizeMethod,
  localizeNote,
  localizePlaceLabel,
  localizeTitle,
  localizeWindowLabel,
  sourceTypeLabel,
  trendClassLabel,
  unitLabel,
  witnessLabelText,
} from './strings.place'
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
  const { lang } = useLang()
  const p = useStrings(PAGE_STRINGS)
  const vLabel = variableName(variable, lang)
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
  const [loadingMessage, setLoadingMessage] = useState<string>(PAGE_STRINGS.en.loadingSeries)
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
    setLoadingMessage(selection.kind === 'bbox' ? PAGE_STRINGS.en.loadingTiles : PAGE_STRINGS.en.loadingSeries)
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
  const zWitness = useMemo(
    () =>
      place && windowMeta && place.witness
        ? zScoresInWindow(place.months, place.witness.anomalies, windowMeta.start, windowMeta.end)
        : [],
    [place, windowMeta],
  )

  const trendSeries =
    place?.trend && windowMeta ? senTrendSeries(place.months, windowMeta.start, windowMeta.end, place.trend) : null
  const trendBand =
    place?.trend && windowMeta && place.evidence.senSlopeDecadeCI
      ? senTrendBandSeries(place.months, windowMeta.start, windowMeta.end, place.trend, {
          lower: place.evidence.senSlopeDecadeCI.lower / 10,
          upper: place.evidence.senSlopeDecadeCI.upper / 10,
        })
      : null
  const verdict: PlainVerdict | null = place
    ? plainVerdict({
        trendClass: trendClassCode(place.evidence.trendClass),
        flagged: place.quality?.available === true && (place.quality.flaggedShare ?? 0) > 0.2,
        witnessCode: place.witness?.agreement ?? null,
        increaseMeans: place.evidence.increaseMeans,
        slope: place.evidence.senSlopeDecade,
      }, lang)
    : null
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
    ? qualityBannerText(
        place.quality,
        place.evidence.product,
        place.evidence.productVersion,
        knownForcingPeriod,
        lang,
      )
    : null
  const detection =
    place && windowMeta ? regionDetection(place, windowMeta.start, windowMeta.end, lang) : null
  const summary =
    place && windowMeta
      ? summarySentence({
          evidence: { ...place.evidence, variableLabel: vLabel },
          placeLabel: localizePlaceLabel(place.plainLabel, lang),
          windowStart: windowMeta.start,
          windowEnd: windowMeta.end,
          quality: place.quality,
          knownForcingPeriod,
          witness: place.witness
            ? { label: witnessLabelText(place.witness.label, lang), agreement: place.witness.agreement }
            : null,
          interval: place.evidence.senSlopeDecadeCI,
          detection: detection?.sentence ?? null,
          lang,
        })
      : null
  const others = index.variables.filter((item) => item.id !== variableId)
  const categories = [...new Set(others.map((item) => item.category))]
  const checkYourself =
    selection && windowMeta
      ? buildCheckYourself({
          selection,
          variable,
          window: windowMeta,
          regions: regions ?? [],
          countries: countries.length > 0 ? countries : place?.country ? [place.country] : [],
        })
      : null

  return (
    <section className="region-page">
      {selection == null ? (
        <>
          <div className="region-heading">
            <h1>{p.chooseAPlace}</h1>
          </div>
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
              const parsed = validateBbox(draft, lang)
              if (!parsed.ok) {
                setFormError(parsed.message)
                return
              }
              setFormError(null)
              setSelection({ kind: 'bbox', bbox: parsed.bbox })
            }}
          />
        </>
      ) : (
        <Explorer
          place={place}
          placeError={placeError == null ? null : localizeMessage(placeError, lang)}
          loadingPlace={loadingPlace}
          loadingMessage={localizeLoading(loadingMessage, lang)}
          windowStart={windowMeta?.start ?? ''}
          windowEnd={windowMeta?.end ?? ''}
          variableLabel={vLabel}
          others={others}
          categories={categories}
          secondId={resolvedSecond}
          secondLabel={secondVariable ? variableName(secondVariable, lang) : p.secondVariableFallback}
          onSecond={setSecondId}
          onChoose={() => setSelection(null)}
          zPrimary={zPrimary}
          zSecond={zSecond}
          witnessZ={zWitness}
          witnessLabel={place?.witness ? witnessLabelText(place.witness.label, lang) : null}
          witnessUnit={place?.witness?.unit ?? null}
          secondAnomalies={secondAnomalies}
          secondError={secondError}
          loadingSecond={loadingSecond}
          rhoLabel={rhoText(canPrecompute, rhoState, place, secondAnomalies, loadingSecond, windowMeta, lang)}
          trendMonths={trendSeries?.months ?? null}
          trendY={trendSeries?.y ?? null}
          trendBand={trendBand}
          annualMeans={annualMeans}
          summary={summary}
          verdict={verdict}
          qualityBanner={qualityBanner}
          witnessMethod={index.witness?.method ?? null}
          checkYourself={checkYourself}
          detection={detection}
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
  lang: Lang,
): string {
  const p = lang === 'vi' ? PAGE_STRINGS.vi : PAGE_STRINGS.en
  if (!place || !windowMeta) return ''
  if (loadingSecond || !secondAnomalies) return p.loadingSecondSeries
  if (canPrecompute && (rhoState === 'idle' || rhoState === 'loading')) return p.loadingPrecomputedRho
  if (canPrecompute && typeof rhoState === 'object') {
    return spearmanLabel('precomputed', rhoState.rho, rhoState.n, lang)
  }
  const live = spearmanInWindow(place.months, place.anomalies, secondAnomalies, windowMeta.start, windowMeta.end)
  return spearmanLabel('computed', live.rho, live.n, lang)
}

/** Progress text from loadPlace.ts (English) shown in the page language. */
function localizeLoading(message: string, lang: Lang): string {
  if (lang === 'en') return message
  if (message === PAGE_STRINGS.en.loadingSeries) return PAGE_STRINGS.vi.loadingSeries
  if (message === PAGE_STRINGS.en.loadingTiles) return PAGE_STRINGS.vi.loadingTiles
  return localizeMessage(message, lang)
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
  const p = useStrings(PAGE_STRINGS)
  return (
    <div className="region-stack">
      <p className="muted">{p.pickerIntro}</p>
      {PlaceSearch && (
        <article className="region-card">
          <h2>{p.searchPlaces}</h2>
          <PlaceSearch
            onPick={(selection) => onRegion(selection.regionId)}
            placeholder={p.searchPlaceholder}
            compact
          />
        </article>
      )}
      {countries.length > 0 && (
        <article className="region-card">
          <h2>{p.countries}</h2>
          <p className="muted">{p.countriesNote}</p>
          <ul className="region-list">
            {countries.map((country) => (
              <li key={country.id}>
                <button type="button" className="region-button secondary" onClick={() => onRegion(country.id)}>
                  {country.label}
                  <small>{p.cellsInMask(String(country.n_cells))}</small>
                </button>
              </li>
            ))}
          </ul>
        </article>
      )}
      <article className="region-card">
        <h2>{p.predefinedRegions}</h2>
        <p className="muted">{p.boxesApproximate}</p>
        {regionsError && (
          <p className="inline-error" role="alert">
            {regionsError}
          </p>
        )}
        {regions == null && !regionsError && (
          <p className="region-status" role="status">
            {p.loadingRegions}
          </p>
        )}
        {regions && regions.length === 0 && <p className="muted">{p.noRegions}</p>}
        {regions && regions.length > 0 && (
          <ul className="region-list">
            {regions.map((region) => (
              <li key={region.id}>
                <button type="button" className="region-button secondary" onClick={() => onRegion(region.id)}>
                  {region.label}
                  <small>{p.approximateBoxLabel(region.bbox.join(', '))}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="region-card">
        <h2>{p.customBox}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <div className="region-grid">
            <Field label={p.west} value={draft.west} onChange={(value) => onDraft('west', value)} />
            <Field label={p.south} value={draft.south} onChange={(value) => onDraft('south', value)} />
            <Field label={p.east} value={draft.east} onChange={(value) => onDraft('east', value)} />
            <Field label={p.north} value={draft.north} onChange={(value) => onDraft('north', value)} />
          </div>
          {formError && (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          )}
          <div className="region-actions">
            <button type="submit" className="region-button">
              {p.showThisBox}
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
  onChoose,
  zPrimary,
  zSecond,
  witnessZ,
  witnessLabel,
  witnessUnit,
  secondAnomalies,
  secondError,
  loadingSecond,
  rhoLabel,
  trendMonths,
  trendY,
  trendBand,
  annualMeans,
  summary,
  verdict,
  qualityBanner,
  witnessMethod,
  checkYourself,
  detection,
}: {
  place: PlaceData | null
  placeError: string | null
  loadingPlace: boolean
  loadingMessage: string
  windowStart: string
  windowEnd: string
  variableLabel: string
  others: { id: string; label: string; category: string; source_type: 'model' | 'mission_observation' | 'reanalysis' }[]
  categories: string[]
  secondId: string
  secondLabel: string
  onSecond: (id: string) => void
  onChoose: () => void
  zPrimary: (number | null)[]
  zSecond: (number | null)[]
  witnessZ: (number | null)[]
  witnessLabel: string | null
  witnessUnit: string | null
  secondAnomalies: (number | null)[] | null
  secondError: string | null
  loadingSecond: boolean
  rhoLabel: string
  trendMonths: string[] | null
  trendY: number[] | null
  trendBand: { months: string[]; lower: number[]; upper: number[] } | null
  annualMeans: { x: string[]; y: number[] } | null
  summary: string | null
  verdict: PlainVerdict | null
  qualityBanner: string | null
  witnessMethod: string | null
  checkYourself: CheckYourselfModel | null
  detection: RegionDetection | null
}) {
  const { lang } = useLang()
  const p = useStrings(PAGE_STRINGS)
  const c = useStrings(CASE_STRINGS)
  const caption = place?.evidence.source === 'precomputed' ? c.captionPrecomputed : c.captionBrowser
  const bandCaption = trendBand ? c.bandCaption : ''
  return (
    <div className="region-stack">
      {loadingPlace && !place && <RegionSkeleton message={loadingMessage} />}
      {!loadingPlace && placeError && (
        <article className="region-card region-empty">
          <h1 className="label-caps region-empty-title">{p.noDataTitle}</h1>
          <p className="inline-error" role="alert">
            {placeError}
          </p>
          <button type="button" className="region-button secondary" onClick={onChoose}>
            {p.chooseDifferent}
          </button>
        </article>
      )}
      {place && (
        <>
          {place.note && <p className="region-warn">{localizeNote(place.note, lang)}</p>}
          <CaseHeader
            title={localizeTitle(place.title, lang)}
            variableLabel={variableLabel}
            windowStart={windowStart}
            windowEnd={windowEnd}
            detail={localizeDetail(place.detail, lang)}
            country={place.country}
            verdict={verdict}
            onChoose={onChoose}
          />
          <VerdictStrip evidence={place.evidence} quality={place.quality} witness={place.witness} />
          <article className="region-card region-chart-card">
            <AnomalyTrendChart
              months={place.months}
              anomalies={place.anomalies}
              unit={place.unit}
              label={variableLabel}
              windowStart={windowStart}
              windowEnd={windowEnd}
              trendMonths={trendMonths}
              trendY={trendY}
              trendBand={trendBand}
              annualMeans={annualMeans}
              breakYear={place.quality?.breakYear ?? null}
              witnessZ={witnessZ}
              witnessLabel={witnessLabel}
              witnessUnit={witnessUnit}
              mainZ={zPrimary}
              caption={trendY ? `${caption}${bandCaption}` : `${caption}${c.noSenLine}`}
            />
          </article>
          <div className={`region-exhibits${place.witness ? '' : ' region-exhibits--two'}`}>
            <RateExhibit evidence={place.evidence} />
            <SignificanceExhibit evidence={place.evidence} />
            {place.witness && <SecondDatasetExhibit witness={place.witness} />}
          </div>
          <p className="region-computed muted">{localizeMethod(place.evidence.method, lang)}</p>
          {place.evidence.source === 'browser' ? (
            <p className="region-computed muted">{c.wholePlaceAverage}</p>
          ) : null}
          {summary && <p className="plain-summary">{summary}</p>}
          <DownloadActions
            place={place}
            variableLabel={variableLabel}
            windowStart={windowStart}
            windowEnd={windowEnd}
            witnessMethod={witnessMethod}
          />
          <div className="region-disclosure-stack">
            <Disclosure summary={c.fullEvidence} className="region-full-evidence">
              <EvidenceBody
                variableText={variableLabel}
                evidence={place.evidence}
                quality={place.quality}
                qualityBanner={qualityBanner}
                witness={place.witness}
                country={place.country}
                detection={detection}
              />
            </Disclosure>
            {checkYourself && (
              <Disclosure summary={c.checkYourself} className="region-check-yourself">
                <CheckYourselfPanel check={checkYourself} />
              </Disclosure>
            )}
            <Disclosure summary={c.toolsSummary} className="region-tools">
              <div className="region-tool-chart">
                <MonthlyValuesChart
                  months={place.months}
                  values={place.values}
                  unit={place.unit}
                  label={variableLabel}
                />
              </div>
              <div className="region-tool-chart">
                <fieldset className="compare-box">
                  <legend>{c.secondVariable}</legend>
                  {others.length === 0 ? (
                    <p className="muted">{c.noSecondVariable}</p>
                  ) : (
                    <label className="control">
                      <span>{c.compareWith}</span>
                      <select value={secondId} onChange={(event) => onSecond(event.target.value)}>
                        {categories.map((category) => (
                          <optgroup key={category} label={categoryLabel(category, lang)}>
                            {others
                              .filter((item) => item.category === category)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {variableName(item, lang)} ({sourceTypeLabel(sourceLabel(item.source_type), lang)})
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
                    {c.loadingSecondVariable}
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
              </div>
            </Disclosure>
          </div>
        </>
      )}
    </div>
  )
}

function RegionSkeleton({ message }: { message: string }) {
  const p = useStrings(PAGE_STRINGS)
  return (
    <div className="region-skeleton" role="status">
      <h1 className="sr-only">{p.loadingCase}</h1>
      <span className="sr-only">{message}</span>
      <div className="region-skeleton-head" aria-hidden="true">
        <span className="region-skeleton-block region-skeleton-outline" />
        <span className="region-skeleton-lines">
          <span className="region-skeleton-block region-skeleton-line region-skeleton-line--eyebrow" />
          <span className="region-skeleton-block region-skeleton-line region-skeleton-line--title" />
          <span className="region-skeleton-block region-skeleton-line" />
        </span>
        <span className="region-skeleton-block region-skeleton-stamp" />
      </div>
      <div className="region-skeleton-strip" aria-hidden="true">
        <span className="region-skeleton-block region-skeleton-cell" />
        <span className="region-skeleton-block region-skeleton-cell" />
        <span className="region-skeleton-block region-skeleton-cell" />
      </div>
      <span className="region-skeleton-block region-skeleton-chart" aria-hidden="true" />
    </div>
  )
}

function RateExhibit({ evidence }: { evidence: EvidenceModel }) {
  const { lang } = useLang()
  const c = useStrings(CASE_STRINGS)
  const slope = evidence.senSlopeDecade
  const interval = evidence.senSlopeDecadeCI
  const direction: 'increase' | 'decrease' | 'none' =
    slope == null || slope === 0 ? 'none' : slope > 0 ? 'increase' : 'decrease'
  const crosses = interval != null && interval.lower <= 0 && interval.upper >= 0
  const unit = unitLabel(formatUnit(evidence.slopeUnit), lang)
  return (
    <Exhibit
      label={c.exhibitA}
      value={slope == null ? '—' : formatSignedRate(slope)}
      unit={slope == null ? undefined : unit}
      tone={direction === 'none' ? 'default' : direction}
    >
      {interval != null && slope != null ? (
        <>
          <IntervalBar
            value={slope}
            lower={interval.lower}
            upper={interval.upper}
            valueLabel={formatSignedRate(slope)}
            lowerLabel={formatSignedRate(interval.lower)}
            upperLabel={formatSignedRate(interval.upper)}
            direction={direction}
            summary={c.intervalCrosses(crosses)}
          />
          <p>{c.intervalLine(formatInterval(interval, lang) ?? '—', unit)}</p>
        </>
      ) : (
        <p>{c.noInterval}</p>
      )}
    </Exhibit>
  )
}

function SignificanceExhibit({ evidence }: { evidence: EvidenceModel }) {
  const c = useStrings(CASE_STRINGS)
  const significant = evidence.trendClass === 'increasing' || evidence.trendClass === 'decreasing'
  const notYet = evidence.trendClass === 'not significant'
  const sentence = significant ? c.sigYes : notYet ? c.sigNotYet : c.sigNoData
  return (
    <Exhibit
      label={c.exhibitB}
      value={evidence.p == null ? '—' : `p = ${formatStat(evidence.p)}`}
    >
      {evidence.showQ && <p>{c.falseDiscoveryQ(formatStat(evidence.q))}</p>}
      <p>{sentence}</p>
    </Exhibit>
  )
}

function SecondDatasetExhibit({ witness }: { witness: WitnessInfo }) {
  const { lang } = useLang()
  const c = useStrings(CASE_STRINGS)
  const slope = witness.trend?.slopeDecade ?? null
  const unit = witness.unit ? unitLabel(`${formatUnit(witness.unit)} per decade`, lang) : undefined
  const p = witness.trend?.p ?? null
  return (
    <Exhibit
      label={c.exhibitC}
      value={slope == null ? undefined : formatSignedRate(slope)}
      unit={slope == null ? undefined : unit}
      tone={witnessIsCaution(witness.agreement) ? 'caution' : 'default'}
    >
      <p>
        {c.witnessLine(
          witnessLabelText(witness.label, lang),
          witnessAgreementText(witness.agreement, lang),
          p == null ? null : formatStat(p),
        )}
      </p>
    </Exhibit>
  )
}

function EvidenceBody({
  variableText,
  evidence,
  quality,
  qualityBanner,
  witness,
  country,
  detection,
}: {
  variableText: string
  evidence: EvidenceModel
  quality: QualitySummary | null
  qualityBanner: string | null
  witness: WitnessInfo | null
  country: Country | null
  detection: RegionDetection | null
}) {
  const { lang } = useLang()
  const c = useStrings(CASE_STRINGS)
  const qualityDetail = qualityDetailText(quality, lang)
  const significantTerm = glossaryEntry('significant', lang)
  return (
    <div className="region-evidence-body">
      {evidence.shortWindow && (
        <p className="region-warn" role="status">
          {c.shortWindow}
        </p>
      )}
      {qualityBanner && (
        <p className="quality-banner" role="status">
          {qualityBanner}
        </p>
      )}
      {country && (
        <p className="muted">{c.approximateBbox(country.bbox.join(', '))}</p>
      )}
      <dl className="evidence-grid">
        <dt>{c.dtVariable}</dt>
        <dd>{variableText}</dd>
        <dt>{c.dtProduct}</dt>
        <dd>{c.productVersion(evidence.product, evidence.productVersion)}</dd>
        <dt>{c.dtDoi}</dt>
        <dd>
          {evidence.doi ? (
            <a href={`https://doi.org/${evidence.doi}`} target="_blank" rel="noreferrer">
              {evidence.doi}
            </a>
          ) : (
            c.notListed
          )}
        </dd>
        <dt>{c.dtSourceVariable}</dt>
        <dd>{evidence.sourceVariable}</dd>
        <dt>{c.dtWindow}</dt>
        <dd>{localizeWindowLabel(evidence.windowLabel, lang)}</dd>
        <dt>
          {c.dtRate} <GlossaryTip term="rate_of_change" />
        </dt>
        <dd>
          {evidence.senSlopeDecade == null ? (
            '—'
          ) : (
            <>
              {formatSignedRate(evidence.senSlopeDecade)} {unitLabel(formatUnit(evidence.slopeUnit), lang)}
              {evidence.senSlopeDecadeCI && (
                <>{c.withInterval(formatInterval(evidence.senSlopeDecadeCI, lang) ?? '')}</>
              )}
              {evidence.senSlopeDecadeCI && evidence.source === 'browser' && (
                <div className="muted">{c.varianceNote(Boolean(evidence.varianceFallback))}</div>
              )}
            </>
          )}
        </dd>
        {detection && (
          <>
            <dt>
              {c.yearsToDetect}{' '}
              <HelpTip label={c.yearsToDetect} description={c.yearsToDetectTip}>
                {c.yearsToDetectTipBody}
              </HelpTip>
            </dt>
            <dd>{detection.sentence}</dd>
          </>
        )}
        <dt>
          {c.dtHowSure}{' '}
          {evidence.source === 'browser' ? (
            <HelpTip
              label={significantTerm.term}
              description={`${significantTerm.plain} (${c.regionTestTechnical})`}
            >
              {significantTerm.plain}{' '}
              <span className="ui-help-technical">({c.regionTestTechnical})</span>
            </HelpTip>
          ) : (
            <GlossaryTip term="significant" />
          )}{' '}
          <span className="muted">{c.mannKendallP}</span>
        </dt>
        <dd>{formatStat(evidence.p)}</dd>
        {evidence.showQ && (
          <>
            <dt>
              {c.dtFalseDiscovery} <GlossaryTip term="q_value" />
            </dt>
            <dd>{formatStat(evidence.q)}</dd>
          </>
        )}
        <dt>
          {c.dtTau} <GlossaryTip term="trend" />
        </dt>
        <dd>{formatStat(evidence.tau)}</dd>
        <dt>{c.dtValidMonths}</dt>
        <dd>
          {evidence.validMonths == null ? '—' : Math.round(evidence.validMonths)} / {evidence.monthsInWindow}
        </dd>
        <dt>
          {c.dtCoverage} <GlossaryTip term="coverage" />
        </dt>
        <dd>
          <div>{formatCoverage(evidence.coverage)}</div>
          {evidence.coverageNote && (
            <div className="muted">{localizeCoverageNote(evidence.coverageNote, lang)}</div>
          )}
        </dd>
        <dt>{c.dtTrendClass}</dt>
        <dd>{trendClassLabel(evidence.trendClass, lang)}</dd>
        {qualityDetail && (
          <>
            <dt>
              {c.dtQualityCheck} <GlossaryTip term="sudden_shift" />
            </dt>
            <dd>{qualityDetail}</dd>
          </>
        )}
        {witness && (
          <>
            <dt>
              {c.dtSecondWitness} <GlossaryTip term="second_witness" />
            </dt>
            <dd>
              {witnessLabelText(witness.label, lang)} · {witness.product} {witness.version}
            </dd>
            <dt>{c.dtWitnessTrend}</dt>
            <dd>
              {witness.trend == null ? (
                c.unavailable
              ) : (
                <>
                  {witness.trend.slopeDecade == null ? (
                    '—'
                  ) : (
                    <>
                      {formatSignedRate(witness.trend.slopeDecade)}
                      {witness.unit ? ` ${formatUnit(witness.unit)}` : ''}{' '}
                      {unitLabel('per decade', lang)}
                    </>
                  )}
                  {witness.trend.slopeDecadeCI && (
                    <>{c.withInterval(formatInterval(witness.trend.slopeDecadeCI, lang) ?? '')}</>
                  )}
                  {c.witnessTrendTail(formatStat(witness.trend.p), trendClassLabel(witness.trend.trendClass, lang))}
                </>
              )}
            </dd>
            <dt>{c.dtAgreement}</dt>
            <dd>{witnessAgreementText(witness.agreement, lang)}</dd>
          </>
        )}
        {evidence.cellsUsed != null && (
          <>
            <dt>{c.dtCellsUsed}</dt>
            <dd>
              {c.cellsUsedLine(String(evidence.cellsUsed), String(evidence.maskCells ?? '—'))}
              {evidence.cellsInBox != null ? c.cellsInsideBox(String(evidence.cellsInBox)) : ''}
            </dd>
          </>
        )}
        {evidence.missingTiles && (
          <>
            <dt>{c.dtMissingTiles}</dt>
            <dd className="missing-tiles">{evidence.missingTiles.length === 0 ? c.none : evidence.missingTiles.join(', ')}</dd>
          </>
        )}
      </dl>
      <h3 className="spaced">{c.caveats}</h3>
      {evidence.caveats.length === 0 ? (
        <p className="muted">{c.noCaveats}</p>
      ) : (
        <ul className="region-caveats">
          {evidence.caveats.map((caveat, i) => (
            <li key={`${i}-${caveat}`}>{caveat}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DownloadActions({
  place,
  variableLabel,
  windowStart,
  windowEnd,
  witnessMethod,
}: {
  place: PlaceData
  variableLabel: string
  windowStart: string
  windowEnd: string
  witnessMethod: string | null
}) {
  const c = useStrings(CASE_STRINGS)
  const [status, setStatus] = useState<'downloaded' | 'copied' | 'copyFailed' | null>(null)
  const safeTitle = place.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  const filename = `${safeTitle || 'earthpulse-region'}-${place.evidence.product}-${windowStart}-${windowEnd}.csv`

  const onDownload = () => {
    const csv = buildRegionCsv({
      months: place.months,
      values: place.values,
      anomalies: place.anomalies,
      witnessAnomalies: place.witness?.anomalies ?? null,
      validFraction: place.validFraction,
    })
    downloadTextFile(filename, csv)
    setStatus('downloaded')
  }

  const onCopy = async () => {
    const citation = buildCitation({
      url: typeof window === 'undefined' ? 'https://earthpulse.example' : window.location.href,
      place: place.title,
      variableLabel,
      windowLabel: place.evidence.windowLabel,
      product: place.evidence.product,
      productVersion: place.evidence.productVersion,
      doi: place.evidence.doi,
      witness: place.witness
        ? {
            label: place.witness.label,
            product: place.witness.product,
            version: place.witness.version,
            doi: place.witness.doi,
          }
        : null,
      method: place.evidence.method,
      witnessMethod,
    })
    const ok = await copyText(citation)
    setStatus(ok ? 'copied' : 'copyFailed')
    if (!ok && typeof console !== 'undefined') console.info(citation)
  }

  return (
    <div className="region-download">
      <div className="region-actions">
        <button type="button" className="region-button secondary" onClick={onDownload}>
          {c.downloadCsv}
        </button>
        <button type="button" className="region-button secondary" onClick={onCopy}>
          {c.copyCitation}
        </button>
      </div>
      <p className="region-status" role="status">
        {status === 'downloaded'
          ? c.csvDownloaded
          : status === 'copied'
            ? c.citationCopied
            : status === 'copyFailed'
              ? c.copyFailed
              : c.csvHint}
      </p>
    </div>
  )
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
