import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { useApp } from '../../data/AppState'
import { loadCases, loadQualityFlag, loadScreener, loadTrendClass } from '../../data/loaders'
import type { CasesFile, DataIndex, DetectiveCase, ScreenerFile, WindowMeta } from '../../data/types'
import { Exhibit } from '../../components/ui'
import type { GlobePulse } from '../../components/globe/EarthGlobe'
import { loadNaturalEarth } from '../../maps/basemap'
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
function casePulses(file: CasesFile | null): GlobePulse[] {
  return (file?.cases ?? []).map((entry) => {
    const [west, south, east, north] = entry.region.bbox
    return { id: entry.id, lat: (south + north) / 2, lon: (west + east) / 2, label: entry.title }
  })
}

/** Stable empty list, so the memos below do not recompute on every render while the screener loads. */
const NO_ROWS: ScreenerFile['rows'] = []

export default function HomePage() {
  const { index, navigate } = useApp()
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
    () => buildHomeInsights(index.variables, rows, windowMeta.start, windowMeta.end, cases?.cases),
    [index.variables, rows, windowMeta.start, windowMeta.end, cases],
  )
  const heroId = useMemo(() => heroVariableId(index.variables, rows), [index.variables, rows])
  const hero = index.variables.find((variable) => variable.id === heroId) ?? index.variables[0]
  const globeVariable = index.variables.find((variable) => variable.id === GLOBE_VARIABLE_ID) ?? hero
  const pulses = useMemo(() => casePulses(cases), [cases])
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
            <p className="home-eyebrow label-caps">NASA Space Apps 2026 · Earth system trend detective</p>
            <h1 id="home-promise" className="display">
              Is that trend real, or <span className="home-mark">a glitch in the data?</span>
            </h1>
            <p className="home-sub">
              EarthPulse cross-examines 24 years of NASA data: what is changing, where, how much, whether it is
              significant, and whether a second NASA dataset agrees.
            </p>
            <p className="home-audience">
              For high-school and college students, and anyone curious about our planet: answer a few questions and
              read the evidence in about a minute.
            </p>
            <div className="home-actions">
              <button
                type="button"
                className="button primary large"
                onClick={() => navigate('investigate', { windowId: windowMeta.id })}
              >
                Start an investigation
              </button>
              <button
                type="button"
                className="button large home-secondary"
                onClick={() => navigate('story', { caseId: workedCase?.id ?? null })}
              >
                Watch a worked case
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
                Explore variables
              </a>
              <a
                href="#/discovery"
                onClick={(event) => {
                  event.preventDefault()
                  navigate('discovery', { variableId: hero?.id, windowId: windowMeta.id })
                }}
              >
                Explore the map
              </a>
            </p>
            <p className="home-fineprint">
              {index.variables.length} verified variables · {index.windows.length} analysis periods · FDR q &lt;{' '}
              {index.q_threshold} for &ldquo;significant&rdquo;.
            </p>
          </div>
          <div className="home-hero-visual">
            {globeVariable ? (
              <HomeGlobe
                variableId={globeVariable.id}
                label={globeVariable.label}
                windowMeta={windowMeta}
                pulses={pulses}
                onSelect={(id) => navigate('story', { caseId: id })}
              />
            ) : null}
          </div>
        </div>
      </section>

      <div className="home-body">
        <ol className="home-steps" aria-label="How EarthPulse works">
          <li className="home-step">
            <span className="home-step-num num-mono" aria-hidden="true">
              1
            </span>
            <div>
              <h2 className="home-step-title">Ask</h2>
              <p>Pick a place and a question.</p>
            </div>
          </li>
          <li className="home-step">
            <span className="home-step-num num-mono" aria-hidden="true">
              2
            </span>
            <div>
              <h2 className="home-step-title">Read the evidence</h2>
              <p>Rate, 95% interval, significance.</p>
            </div>
          </li>
          <li className="home-step">
            <span className="home-step-num num-mono" aria-hidden="true">
              3
            </span>
            <div>
              <h2 className="home-step-title">Cross-examine</h2>
              <p>Data-quality flag, second dataset.</p>
            </div>
          </li>
        </ol>

        <section className="home-section" aria-labelledby="home-insights-title">
          <div className="home-section-head">
            <div>
              <p className="home-kicker label-caps">From the real screener file</p>
              <h2 id="home-insights-title">What the data says now</h2>
            </div>
            <p className="home-source">
              {windowMeta.start} to {windowMeta.end} · global land ·{' '}
              <span className="mono">screener/{windowMeta.id}/global.json</span>
            </p>
          </div>

          {error ? (
            <div className="home-status" role="alert">
              <p>Could not load the screener file for Home. {error}</p>
              <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </button>
            </div>
          ) : null}
          {!error && !screener ? (
            <div className="home-status" role="status">
              Computing headlines from the screener…
            </div>
          ) : null}
          {screener && insights.length === 0 ? (
            <div className="home-status" role="status">
              This screener file has no evaluated cells yet, so there is no headline to show.
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
              Every number above is computed from the published screener rows, area-weighted over evaluated land
              cells. A significant trend is evidence to read, not proof of cause.
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
  const qualityText = qualityEvidenceText(insight)
  const witnessText = insight.id === 'witness' ? null : witnessEvidenceText(insight)
  return (
    <Exhibit
      label={`Exhibit ${letter} · ${insight.kicker}`}
      value={insight.value}
      unit={insight.unit}
      tone={INSIGHT_TONE[insight.id] ?? 'default'}
      footer={
        <button type="button" className="home-insight-open" onClick={onOpen}>
          Inspect evidence <span aria-hidden="true">→</span>
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
  return (
    <div className="home-globe-stage">
      <div className="home-globe-placeholder" role="status">
        <span className="home-globe-shimmer" aria-hidden="true" />
        <span className="sr-only">{note ?? 'Loading the globe…'}</span>
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
        <GlobePlaceholder note="The globe could not be loaded. The rest of the page still works." />
      ) : data ? (
        <Suspense fallback={<GlobePlaceholder />}>
          <EarthGlobe
            trendClass={data.trendClass}
            qualityFlag={data.qualityFlag}
            land={data.land}
            pulses={pulses}
            onPulseSelect={onSelect}
            pulseHref={(id) => `#/story?case=${encodeURIComponent(id)}`}
            ariaLabel={`Globe of the ${label.toLowerCase()} trend, ${windowMeta.start} to ${windowMeta.end}. Warm colours mean significant increase, cool colours significant decrease, yellow marks cells flagged for a sudden shift. One pulse marks each published case.`}
          />
        </Suspense>
      ) : (
        <GlobePlaceholder />
      )}
      <p className="home-caption">
        {label} trend · {windowMeta.start} to {windowMeta.end}
      </p>
    </div>
  )
}
