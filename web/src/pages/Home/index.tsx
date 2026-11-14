import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { useApp } from '../../data/AppState'
import { loadCases, loadQualityFlag, loadScreener, loadTrendClass } from '../../data/loaders'
import type { CasesFile, DataIndex, DetectiveCase, ScreenerFile, WindowMeta } from '../../data/types'
import { Exhibit } from '../../components/ui'
import type { GlobePulse } from '../../components/globe/EarthGlobe'
import { loadNaturalEarth } from '../../maps/basemap'
import { useLang, useStrings, type Lang } from '../../i18n'
import { caseTitle, variableLabel } from '../../i18n/terms'
import { HOME_STRINGS } from './strings'
import {
  buildHomeInsights,
  heroVariableId,
  qualityEvidenceText,
  witnessEvidenceText,
  type HomeInsight,
} from './insights'
import './home.css'

// three.js lives only in this lazy chunk (docs/UI_SPEC.md §3).
const EarthGlobe = lazy(() => import('../../components/globe/EarthGlobe'))

/** The long window is the default story on Home; the header still controls the other views. */
const HOME_WINDOW_ID = '2001-2024'
/** The globe shows near-surface air temperature (UI_SPEC §5); the hero variable is the fallback. */
const GLOBE_VARIABLE_ID = 'air_temperature'
/** The Vietnam caution case is the worked case; region.id is a schema 1.2 additive field. */
const WORKED_CASE_REGION_ID = 'country_704'

function homeWindow(index: DataIndex): WindowMeta {
  return (
    index.windows.find((w) => w.id === HOME_WINDOW_ID) ??
    index.windows[0] ?? { id: '', start: '', end: '' }
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function regionIdOf(entry: DetectiveCase): string | undefined {
  return (entry.region as { id?: string }).id
}

function pickWorkedCase(file: CasesFile | null): DetectiveCase | null {
  const list = file?.cases ?? []
  return list.find((entry) => regionIdOf(entry) === WORKED_CASE_REGION_ID) ?? list[0] ?? null
}

/** One pulse per published case, at the centre of its region bounding box. */
function casePulses(file: CasesFile | null, lang: Lang): GlobePulse[] {
  return (file?.cases ?? []).map((entry) => {
    const [west, south, east, north] = entry.region.bbox
    return { id: entry.id, lat: (south + north) / 2, lon: (west + east) / 2, label: caseTitle(entry, lang) }
  })
}

/** Stable empty list, so the memos below do not recompute on every render while the screener loads. */
const NO_ROWS: ScreenerFile['rows'] = []

export default function HomePage() {
  const { index, navigate } = useApp()
  const s = useStrings(HOME_STRINGS)
  const { lang } = useLang()
  const windowMeta = homeWindow(index)
  const [screener, setScreener] = useState<ScreenerFile | null>(null)
  const [cases, setCases] = useState<CasesFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setScreener(null)
    setError(null)
    loadScreener(windowMeta.id, 'global')
      .then((file) => {
        if (!cancelled) setScreener(file)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [windowMeta.id, attempt])

  useEffect(() => {
    let cancelled = false
    loadCases()
      .then((file) => {
        if (!cancelled) setCases(file)
      })
      .catch(() => {
        // Cases are optional; Home still works without cases.json.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = screener?.rows ?? NO_ROWS
  const insights = useMemo(
    () => buildHomeInsights(index.variables, rows, windowMeta.start, windowMeta.end, cases?.cases, lang),
    [index.variables, rows, windowMeta.start, windowMeta.end, cases, lang],
  )
  const heroId = useMemo(() => heroVariableId(index.variables, rows), [index.variables, rows])
  const hero = index.variables.find((variable) => variable.id === heroId) ?? index.variables[0]
  const globeVariable = index.variables.find((variable) => variable.id === GLOBE_VARIABLE_ID) ?? hero
  const pulses = useMemo(() => casePulses(cases, lang), [cases, lang])
  const workedCase = useMemo(() => pickWorkedCase(cases), [cases])

  const openVariable = (variableId: string | null) => {
    if (variableId) navigate('discovery', { variableId, windowId: windowMeta.id })
    else navigate('screener', { windowId: windowMeta.id, domain: 'global' })
  }
  const openInsight = (insight: HomeInsight) => {
    if (insight.caseId) navigate('story', { caseId: insight.caseId })
    else openVariable(insight.variableId)
  }
  const shown = insights.slice(0, 3)

  return (
    <div className="home">
      <section className="home-hero surface-night" aria-labelledby="home-promise">
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <p className="home-eyebrow label-caps">{s.eyebrow}</p>
            <h1 id="home-promise" className="display">
              {s.headlinePre}
              <span className="home-mark">{s.headlineMark}</span>
            </h1>
            <p className="home-sub">
              {s.sub}
            </p>
            <p className="home-audience">
              {s.audience}
            </p>
            <div className="home-actions">
              <button
                type="button"
                className="button primary large"
                onClick={() => navigate('investigate', { windowId: windowMeta.id })}
              >
                {s.start}
              </button>
              <button
                type="button"
                className="button large home-secondary"
                onClick={() => navigate('story', { caseId: workedCase?.id ?? null })}
              >
                {s.watch}
              </button>
            </div>
            <p className="home-links">
              <a
                href="#/screener"
                onClick={(event) => {
                  event.preventDefault()
                  navigate('screener', { windowId: windowMeta.id, domain: 'global' })
                }}
              >
                {s.exploreVariables}
              </a>
              <a
                href="#/discovery"
                onClick={(event) => {
                  event.preventDefault()
                  navigate('discovery', { variableId: hero?.id, windowId: windowMeta.id })
                }}
              >
                {s.exploreMap}
              </a>
            </p>
            <p className="home-fineprint">
              {s.fineprint(index.variables.length, index.windows.length, index.q_threshold)}
            </p>
          </div>
          <div className="home-hero-visual">
            {globeVariable ? (
              <HomeGlobe
                variableId={globeVariable.id}
                label={variableLabel(globeVariable, lang)}
                windowMeta={windowMeta}
                pulses={pulses}
                onSelect={(id) => navigate('story', { caseId: id })}
              />
            ) : null}
          </div>
        </div>
      </section>

      <div className="home-body">
        <ol className="home-steps" aria-label={s.stepsLabel}>
          <li className="home-step">
            <span className="home-step-num num-mono" aria-hidden="true">
              1
            </span>
            <div>
              <h2 className="home-step-title">{s.step1Title}</h2>
              <p>{s.step1Body}</p>
            </div>
          </li>
          <li className="home-step">
            <span className="home-step-num num-mono" aria-hidden="true">
              2
            </span>
            <div>
              <h2 className="home-step-title">{s.step2Title}</h2>
              <p>{s.step2Body}</p>
            </div>
          </li>
          <li className="home-step">
            <span className="home-step-num num-mono" aria-hidden="true">
              3
            </span>
            <div>
              <h2 className="home-step-title">{s.step3Title}</h2>
              <p>{s.step3Body}</p>
            </div>
          </li>
        </ol>

        <section className="home-section" aria-labelledby="home-insights-title">
          <div className="home-section-head">
            <div>
              <p className="home-kicker label-caps">{s.insightsKicker}</p>
              <h2 id="home-insights-title">{s.insightsTitle}</h2>
            </div>
            <p className="home-source">
              {s.sourceLead(windowMeta.start, windowMeta.end)}{' '}
              <span className="mono">screener/{windowMeta.id}/global.json</span>
            </p>
          </div>

          {error ? (
            <div className="home-status" role="alert">
              <p>{s.loadError(error)}</p>
              <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
                {s.retry}
              </button>
            </div>
          ) : null}
          {!error && !screener ? (
            <div className="home-status" role="status">
              {s.computing}
            </div>
          ) : null}
          {screener && insights.length === 0 ? (
            <div className="home-status" role="status">
              {s.noCells}
            </div>
          ) : null}
          {shown.length > 0 ? (
            <div className="home-insights">
              {shown.map((insight, position) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  letter={String.fromCharCode(65 + position)}
                  onOpen={() => openInsight(insight)}
                />
              ))}
            </div>
          ) : null}
          {screener ? (
            <p className="home-fineprint">
              {s.insightsFootnote}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}

/** Warm = increase, cool = decrease, yellow only for the second-dataset caution. */
const INSIGHT_TONE: Record<string, 'increase' | 'decrease' | 'caution' | 'default'> = {
  warming: 'increase',
  breadth: 'increase',
  decrease: 'decrease',
  witness: 'caution',
}

function InsightCard({ insight, letter, onOpen }: { insight: HomeInsight; letter: string; onOpen: () => void }) {
  const s = useStrings(HOME_STRINGS)
  const { lang } = useLang()
  const qualityText = qualityEvidenceText(insight, lang)
  const witnessText = insight.id === 'witness' ? null : witnessEvidenceText(insight, lang)
  return (
    <Exhibit
      label={s.exhibitLabel(letter, insight.kicker)}
      value={insight.value}
      unit={insight.unit}
      tone={INSIGHT_TONE[insight.id] ?? 'default'}
      footer={
        <button type="button" className="home-insight-open" onClick={onOpen}>
          {s.inspect} <span aria-hidden="true">→</span>
        </button>
      }
    >
      <p className="home-insight-title">{insight.title}</p>
      <p>{insight.detail}</p>
      {qualityText != null ? <p className="home-insight-quality">{qualityText}</p> : null}
      {witnessText != null ? <p className="home-insight-witness">{witnessText}</p> : null}
    </Exhibit>
  )
}

interface GlobeData {
  trendClass: Int8Array
  qualityFlag: Int8Array | null
  land: FeatureCollection
}

function GlobePlaceholder({ note }: { note?: string }) {
  const s = useStrings(HOME_STRINGS)
  return (
    <div className="home-globe-stage">
      <div className="home-globe-placeholder" role="status">
        <span className="home-globe-shimmer" aria-hidden="true" />
        <span className="sr-only">{note ?? s.globeLoading}</span>
      </div>
    </div>
  )
}

function HomeGlobe({
  variableId,
  label,
  windowMeta,
  pulses,
  onSelect,
}: {
  variableId: string
  label: string
  windowMeta: WindowMeta
  pulses: GlobePulse[]
  onSelect: (id: string) => void
}) {
  const s = useStrings(HOME_STRINGS)
  const [data, setData] = useState<GlobeData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setFailed(false)
    Promise.all([
      loadTrendClass(variableId, windowMeta.id),
      loadQualityFlag(variableId, windowMeta.id),
      loadNaturalEarth(),
    ])
      .then(([trendClass, qualityFlag, basemap]) => {
        if (!cancelled) setData({ trendClass, qualityFlag, land: basemap.land })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [variableId, windowMeta.id])

  return (
    <div className="home-globe">
      {failed ? (
        <GlobePlaceholder note={s.globeFailed} />
      ) : data ? (
        <Suspense fallback={<GlobePlaceholder />}>
          <EarthGlobe
            trendClass={data.trendClass}
            qualityFlag={data.qualityFlag}
            land={data.land}
            pulses={pulses}
            onPulseSelect={onSelect}
            pulseHref={(id) => `#/story?case=${encodeURIComponent(id)}`}
            ariaLabel={s.globeAria(label, windowMeta.start, windowMeta.end)}
          />
        </Suspense>
      ) : (
        <GlobePlaceholder />
      )}
      <p className="home-caption">
        {s.globeCaption(label, windowMeta.start, windowMeta.end)}
      </p>
    </div>
  )
}
