import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../data/AppState'
import { loadCases, loadCountries, loadScreener, loadTrendClass } from '../../data/loaders'
import type { CasesFile, Country, DataIndex, ScreenerFile, WindowMeta } from '../../data/types'
import { paintTrendClass, trendColoursFrom } from '../Screener/thumbnail'
import {
  buildCautionEntry,
  buildHomeInsights,
  heroVariableId,
  qualityEvidenceText,
  witnessEvidenceText,
  type HomeInsight,
} from './insights'
import './home.css'

/** The long window is the default story on Home; the header still controls the other views. */
const HOME_WINDOW_ID = '2001-2024'

function homeWindow(index: DataIndex): WindowMeta {
  return (
    index.windows.find((w) => w.id === HOME_WINDOW_ID) ??
    index.windows[0] ?? { id: '', start: '', end: '' }
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function HomePage() {
  const { index, navigate } = useApp()
  const windowMeta = homeWindow(index)
  const [screener, setScreener] = useState<ScreenerFile | null>(null)
  const [cases, setCases] = useState<CasesFile | null>(null)
  const [countries, setCountries] = useState<Country[]>([])
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
    Promise.all([loadCases(), loadCountries().catch(() => [] as Country[])])
      .then(([file, countryList]) => {
        if (cancelled) return
        setCases(file)
        setCountries(countryList)
      })
      .catch(() => {
        // The caution entry is optional; Home still works without cases.json.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = screener?.rows ?? []
  const insights = useMemo(
    () => buildHomeInsights(index.variables, rows, windowMeta.start, windowMeta.end, cases?.cases),
    [index.variables, rows, windowMeta.start, windowMeta.end, cases],
  )
  const caution = useMemo(() => buildCautionEntry(cases?.cases, countries), [cases, countries])
  const heroId = useMemo(() => heroVariableId(index.variables, rows), [index.variables, rows])
  const hero = index.variables.find((variable) => variable.id === heroId) ?? index.variables[0]

  const openVariable = (variableId: string | null) => {
    if (variableId) navigate('discovery', { variableId, windowId: windowMeta.id })
    else navigate('screener', { windowId: windowMeta.id, domain: 'global' })
  }
  const openInsight = (insight: HomeInsight) => {
    if (insight.caseId) navigate('story', { caseId: insight.caseId })
    else openVariable(insight.variableId)
  }

  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-promise">
        <div className="home-hero-copy">
          <p className="eyebrow">NASA Space Apps 2026 · Earth system trend detective</p>
          <h1 id="home-promise">
            Which parts of Earth&apos;s system are changing, where, how much, and is it significant?
          </h1>
          <p className="home-lede">
            EarthPulse ranks NASA Earth variables by the area with a statistically significant trend, then lets you
            inspect the same evidence on a map, in a region, and in a guided case.
          </p>
          <div className="home-actions">
            <button
              type="button"
              className="button primary large"
              onClick={() => navigate('screener', { windowId: windowMeta.id, domain: 'global' })}
            >
              Explore variables
            </button>
            <button
              type="button"
              className="button large"
              onClick={() => navigate('discovery', { variableId: hero?.id, windowId: windowMeta.id })}
            >
              Explore the map
            </button>
            <button type="button" className="button secondary large" onClick={() => navigate('story', { caseId: null })}>
              Follow a case
            </button>
          </div>
          <p className="home-fineprint">
            {index.variables.length} verified variables · {index.windows.length} analysis periods · FDR q &lt;{' '}
            {index.q_threshold} for &ldquo;significant&rdquo;.
          </p>
        </div>
        <div className="home-hero-visual">
          {hero ? (
            <HeroMap
              variableId={hero.id}
              windowId={windowMeta.id}
              label={hero.label}
              increaseMeans={hero.increase_means}
            />
          ) : null}
          <p className="home-caption">
            Global trend classes · {windowMeta.start} to {windowMeta.end}
          </p>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-insights-title">
        <div className="home-section-head">
          <div>
            <p className="eyebrow">From the real screener file</p>
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
        {insights.length > 0 ? (
          <div className="home-insights">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} onOpen={() => openInsight(insight)} />
            ))}
          </div>
        ) : null}
        {screener ? (
          <p className="home-fineprint">
            Every number above is computed from the published screener rows, area-weighted over evaluated land cells.
            A significant trend is evidence to read, not proof of cause.
          </p>
        ) : null}
      </section>

      <section className="home-section" aria-labelledby="home-entry-title">
        <div className="home-section-head">
          <div>
            <p className="eyebrow">{caution ? 'Four ways in' : 'Three ways in'}</p>
            <h2 id="home-entry-title">Choose how you want to explore</h2>
          </div>
        </div>
        <div className="home-entries">
          <EntryCard
            kicker="Rank"
            title="Explore variables"
            body="Sort every variable by the area with significant change, coverage, typical magnitude and opposing regional trends."
            foot={`${index.variables.length} variables compared`}
            action="Open the Screener"
            onClick={() => navigate('screener', { windowId: windowMeta.id, domain: 'global' })}
          />
          <EntryCard
            kicker="Locate"
            title="Explore the map"
            body="See where the trend is significant, how strong it is, and how the core temperature–moisture pattern is split across land."
            foot={`${index.layers.float.length + index.layers.class.length} grid layers available`}
            action="Open Global Discovery"
            onClick={() => navigate('discovery', { variableId: hero?.id, windowId: windowMeta.id })}
          />
          <EntryCard
            kicker="Interpret"
            title="Follow a case"
            body="Walk through published detective cases step by step: why each place was selected, the evidence numbers, and the limitations."
            foot="Built from computed cases.json"
            action="Open Story mode"
            onClick={() => navigate('story', { caseId: null })}
          />
          {caution ? (
            <EntryCard
              kicker="Look closer"
              title={caution.title}
              body={caution.summary}
              foot="Caution case · read the evidence"
              action="Open this case"
              onClick={() => navigate('story', { caseId: caution.caseId })}
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}

function InsightCard({ insight, onOpen }: { insight: HomeInsight; onOpen: () => void }) {
  const qualityText = qualityEvidenceText(insight)
  const witnessText = insight.id === 'witness' ? null : witnessEvidenceText(insight)
  return (
    <button type="button" className="home-insight" onClick={onOpen}>
      <span className="home-insight-kicker">{insight.kicker}</span>
      <span className="home-insight-value">{insight.value}</span>
      <span className="home-insight-unit">{insight.unit}</span>
      <span className="home-insight-title">{insight.title}</span>
      <span className="home-insight-detail">{insight.detail}</span>
      {qualityText != null ? (
        <span className="home-insight-quality">
          {qualityText}
          <span aria-hidden="true"> →</span>
        </span>
      ) : null}
      {witnessText != null ? (
        <span className="home-insight-witness">
          {witnessText}
          <span aria-hidden="true"> →</span>
        </span>
      ) : null}
      <span className="home-insight-link" aria-hidden="true">
        Inspect evidence →
      </span>
    </button>
  )
}

function EntryCard({
  kicker,
  title,
  body,
  foot,
  action,
  onClick,
}: {
  kicker: string
  title: string
  body: string
  foot: string
  action: string
  onClick: () => void
}) {
  return (
    <button type="button" className="home-entry" onClick={onClick}>
      <span className="home-insight-kicker">{kicker}</span>
      <span className="home-entry-title">{title}</span>
      <span className="home-entry-body">{body}</span>
      <span className="home-entry-foot">{foot}</span>
      <span className="home-entry-action">
        {action} <span aria-hidden="true">→</span>
      </span>
    </button>
  )
}

function HeroMap({
  variableId,
  windowId,
  label,
  increaseMeans,
}: {
  variableId: string
  windowId: string
  label: string
  increaseMeans: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    loadTrendClass(variableId, windowId)
      .then((grid) => {
        if (cancelled) return
        const node = canvasRef.current
        if (!node) return
        paintTrendClass(node, grid, trendColoursFrom(node))
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('error')
        setError(messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [variableId, windowId])

  return (
    <div className="home-hero-map">
      <canvas
        ref={canvasRef}
        width={360}
        height={180}
        role="img"
        aria-label={`Global trend map for ${label}. Significant increase means ${increaseMeans}; other cells are decrease, not significant, insufficient data, or outside the domain.`}
      />
      {status === 'loading' ? <span className="home-map-status">Loading hero map…</span> : null}
      {status === 'error' ? (
        <span className="home-map-status" role="alert">
          {error ?? 'Could not draw the hero map.'}
        </span>
      ) : null}
      <div className="home-map-key" aria-hidden="true">
        <span>
          <i className="key-swatch key-increase" /> significant increase
        </span>
        <span>
          <i className="key-swatch key-decrease" /> significant decrease
        </span>
        <span>
          <i className="key-swatch key-neutral" /> not significant
        </span>
      </div>
    </div>
  )
}
