/**
 * P20: "Start an investigation" — three questions lead to a ranked list of
 * published variables for one place and period. Every number on this page is
 * read from `screener/{window}/{domain}.json`; nothing is computed here beyond
 * sums and percent formatting.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { PlaceSearch } from '../../components/PlaceSearch'
import { Card, Disclosure, GlossaryTip, VerdictStamp } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadCases, loadCountries, loadRegions, loadScreener } from '../../data/loaders'
import type { CasesFile, Country, DetectiveCase, Region, ScreenerFile, WindowMeta } from '../../data/types'
import { formatUnitIn } from '../../lib/format'
import { useLang, useStrings } from '../../i18n'
import { caseTitle, variableDescription, variableLabel } from '../../i18n/terms'
import {
  ALL_TOPIC,
  DEFAULT_INVESTIGATE,
  GLOBAL_PLACE,
  cardModel,
  findTopic,
  formatPercent,
  initialInvestigateState,
  landPhrase,
  parseInvestigateHash,
  serializeInvestigateHash,
  suggestedPlaces,
  topicRows,
  topicVariables,
  workedExample,
  type CardModel,
  type InvestigateState,
  type PlaceKind,
} from './model'
import { downloadReportImage } from './image'
import { CalendarIcon, MagnifierIcon, PinIcon, TopicIcon } from './icons'
import { buildReportHeader } from './report'
import { STRINGS } from './strings'
import './investigate.css'

const STORE_KEY = 'earthpulse.investigate.v1'

interface StoredAnswers {
  state: InvestigateState
  navHash: string | null
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function readStored(): StoredAnswers | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { state?: unknown; navHash?: unknown }
    const state = record.state as Partial<InvestigateState> | undefined
    if (
      !state ||
      typeof state.place !== 'string' ||
      typeof state.topic !== 'string' ||
      typeof state.windowId !== 'string'
    ) {
      return null
    }
    return {
      state: { place: state.place, topic: state.topic, windowId: state.windowId },
      navHash: typeof record.navHash === 'string' ? record.navHash : null,
    }
  } catch {
    return null
  }
}

function writeStored(state: InvestigateState, navHash: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ state, navHash }))
  } catch {
    // Private mode or a full quota must not break the questions.
  }
}

/**
 * The fragment of the URL this document was opened with, before the shared
 * router canonicalised it. Chrome and Firefox include the fragment here; when a
 * browser does not, the session copy of the answers is the fallback.
 */
function navigationHash(): string | null {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return null
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (!entry || !entry.name) return null
    const hash = new URL(entry.name).hash
    return hash === '' ? null : hash
  } catch {
    return null
  }
}

function writeFullHash(state: InvestigateState): void {
  if (typeof window === 'undefined') return
  const hash = serializeInvestigateHash(state)
  if (window.location.hash === hash) return
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
}

function windowYears(window: WindowMeta | undefined, fallback: string): string {
  if (!window) return fallback
  return `${window.start.slice(0, 4)}–${window.end.slice(0, 4)}`
}

/** Verdict kind to stamp tone; yellow is used for caution only. */
function stampTone(card: CardModel): 'strong' | 'caution' | 'not-yet' | 'none' {
  if (card.verdict.tone === 'warn') return 'caution'
  if (card.verdict.tone === 'accent') return 'strong'
  return card.verdictKind === 'notYet' ? 'not-yet' : 'none'
}

/** Width of a bar segment, clamped to 0-100. */
function barPercent(fraction: number | null): number {
  if (fraction == null || !Number.isFinite(fraction)) return 0
  return Math.max(0, Math.min(100, fraction * 100))
}

export default function InvestigatePage() {
  const s = useStrings(STRINGS)
  const { lang } = useLang()
  const { index, windowId: appWindowId, setWindowId, navigate } = useApp()

  // Read the first answer once: the shared router rewrites the hash to `w` only,
  // so `place` and `topic` come from the URL this document was opened with (or
  // from the copy in this tab when a browser hides the fragment).
  const [boot] = useState(() => {
    if (typeof window === 'undefined') {
      return { initial: DEFAULT_INVESTIGATE, navHash: null as string | null }
    }
    const navHash = navigationHash()
    const stored = readStored()
    const initial = initialInvestigateState({
      hash: window.location.hash,
      navHash,
      stored: stored?.state ?? null,
      storedNavHash: stored?.navHash ?? null,
      defaultWindowId: appWindowId,
    })
    return { initial, navHash }
  })
  const navHashRef = useRef<string | null>(boot.navHash)
  const [state, setState] = useState<InvestigateState>(boot.initial)
  const stateRef = useRef(state)
  stateRef.current = state

  const [countries, setCountries] = useState<Country[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [cases, setCases] = useState<CasesFile | null>(null)

  const [screener, setScreener] = useState<ScreenerFile | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)

  /** Keep answers in the address bar and in this tab. */
  const commit = useCallback(
    (patch: Partial<InvestigateState>) => {
      const next: InvestigateState = { ...stateRef.current, ...patch }
      stateRef.current = next
      setState(next)
      writeStored(next, navHashRef.current)
      if (next.windowId !== appWindowId) setWindowId(next.windowId)
      writeFullHash(next)
    },
    [appWindowId, setWindowId],
  )

  // First render: put `place` and `topic` back into the address bar, because the
  // shared router keeps only `w` for this page.
  useEffect(() => {
    writeStored(stateRef.current, navHashRef.current)
    writeFullHash(stateRef.current)
  }, [])

  // Same-page back/forward (a hash edit or a restored link) re-reads the answers.
  useEffect(() => {
    const onPop = () => {
      const parsed = parseInvestigateHash(window.location.hash)
      if (parsed.place == null && parsed.topic == null && parsed.windowId == null) return
      const previous = stateRef.current
      commit({
        place: parsed.place ?? previous.place,
        topic: parsed.topic ?? previous.topic,
        windowId: parsed.windowId ?? previous.windowId,
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [commit])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCountries(), loadRegions()])
      .then(([countryList, regionList]) => {
        if (cancelled) return
        setCountries(countryList)
        setRegions(regionList)
      })
      .catch(() => {
        // Labels fall back to the id; PlaceSearch reports its own error.
      })
    loadCases()
      .then((file) => {
        if (!cancelled) setCases(file)
      })
      .catch(() => {
        // The worked example is optional; the answer still renders without cases.json.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setScreener(null)
    setError(null)
    setNotFound(false)
    loadScreener(state.windowId, state.place)
      .then((file) => {
        if (cancelled) return
        setScreener(file)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = messageOf(err)
        // A missing file is a 404 in production; the dev server answers with the
        // HTML shell instead, which fails JSON parsing. Both mean "not published".
        if (/HTTP 404/.test(message) || /JSON|Unexpected token/i.test(message)) {
          setNotFound(true)
          setStatus('ready')
        } else {
          setError(message)
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [state.windowId, state.place, attempt])

  const topics = useMemo(() => topicVariables(index.variables, lang), [index.variables, lang])
  const topic = findTopic(topics, state.topic)

  // An unknown `topic=` in a hand-edited link falls back to the complete list.
  useEffect(() => {
    if (state.topic !== topic.id) commit({ topic: topic.id })
  }, [state.topic, topic.id, commit])

  const place = useMemo((): { kind: PlaceKind; label: string } => {
    if (state.place === GLOBAL_PLACE) return { kind: 'global', label: s.worldLabel }
    const country = countries.find((item) => item.id === state.place)
    if (country) return { kind: 'country', label: country.label }
    const region = regions.find((item) => item.id === state.place)
    if (region) return { kind: 'region', label: region.label }
    return { kind: 'region', label: state.place }
  }, [state.place, countries, regions, s.worldLabel])

  const windowMeta = index.windows.find((window) => window.id === state.windowId)
  const years = windowYears(windowMeta, state.windowId)
  const land = landPhrase(place.kind, place.label, lang)

  const cards = useMemo((): CardModel[] => {
    if (!screener) return []
    const byId = new Map(index.variables.map((variable) => [variable.id, variable]))
    return topicRows(screener.rows, topic).flatMap((row) => {
      const variable = byId.get(row.variable)
      return variable ? [cardModel({ variable, row, land }, lang)] : []
    })
  }, [screener, index.variables, topic, land, lang])

  const suggestions = useMemo(
    () => (cases ? suggestedPlaces(countries, cases.cases) : []),
    [countries, cases],
  )

  const example: DetectiveCase | null = useMemo(() => {
    if (!cases) return null
    return workedExample(cases.cases, {
      placeId: state.place,
      placeLabel: place.kind === 'global' ? 'Global land' : place.label,
      placeKind: place.kind,
      variableIds: topic.variableIds,
      windowId: state.windowId,
    })
  }, [cases, state.place, state.windowId, place, topic])

  const openEvidence = (card: CardModel): void => {
    if (state.place === GLOBAL_PLACE) {
      navigate('screener', { windowId: state.windowId, domain: GLOBAL_PLACE })
      return
    }
    navigate('region', {
      variableId: card.variableId,
      windowId: state.windowId,
      selection: { kind: 'region', regionId: state.place },
    })
  }

  const isCountry = place.kind === 'country'
  const header = useMemo(
    () =>
      isCountry
        ? buildReportHeader({
            placeId: state.place,
            placeLabel: place.label,
            period: years,
            generatedAt: index.generated_at,
            cards,
            variables: index.variables,
          }, lang)
        : null,
    [isCountry, state.place, place.label, years, index.generated_at, cards, index.variables, lang],
  )
  const [shareNote, setShareNote] = useState<string | null>(null)

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareNote(s.linkCopied)
    } catch {
      setShareNote(s.linkFailed)
    }
  }

  const saveImage = async (): Promise<void> => {
    if (!header) return
    try {
      await downloadReportImage(
        { header, topic: topic.label, cards, url: window.location.href, lang },
        `earthpulse-${state.place}-${topic.id}-${state.windowId}.png`,
      )
      setShareNote(s.imageDone)
    } catch (err) {
      setShareNote(s.imageFailed(messageOf(err)))
    }
  }

  /** Arrow keys move between the tiles of one group. */
  const moveInGroup = (event: KeyboardEvent<HTMLElement>): void => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
    if (!keys.includes(event.key)) return
    const group = event.currentTarget
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button'))
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    event.preventDefault()
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    buttons[(at + step + buttons.length) % buttons.length].focus()
  }

  const labelOf = (variableId: string): string => {
    const found = index.variables.find((variable) => variable.id === variableId)
    return found ? variableLabel(found, lang) : variableId
  }

  return (
    <div className="investigate">
      <header className="investigate-head">
        <p className="eyebrow">{s.eyebrow}</p>
        <h1 className="display">{s.title}</h1>
        <p className="investigate-promise">{s.promise}</p>
      </header>

      <div className="investigate-questions">
      <section className="investigate-question" aria-labelledby="investigate-where">
        <div className="investigate-question-top">
          <PinIcon />
          <p className="label-caps">{s.q1Label}</p>
        </div>
        <h2 id="investigate-where">{s.q1Title}</h2>
        <p className="investigate-question-help">{s.q1Help}</p>
        <div className="investigate-place-row">
          <PlaceSearch
            onPick={(selection) => commit({ place: selection.regionId })}
            placeholder={s.searchPlaceholder}
          />
          <button
            type="button"
            className={state.place === GLOBAL_PLACE ? 'button primary' : 'button'}
            aria-pressed={state.place === GLOBAL_PLACE}
            onClick={() => commit({ place: GLOBAL_PLACE })}
          >
            {s.worldButton}
          </button>
        </div>
        <p className="investigate-selected" aria-live="polite">
          {s.lookingAtBefore}<strong>{place.label}</strong>{s.lookingAtAfter}
        </p>
        {suggestions.length > 0 ? (
          <div className="investigate-suggest">
            <p className="investigate-suggest-label">{s.suggestLabel}</p>
            <div className="investigate-suggest-buttons">
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="button secondary"
                  aria-pressed={state.place === item.id}
                  onClick={() => commit({ place: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="investigate-question" aria-labelledby="investigate-topic">
        <div className="investigate-question-top">
          <MagnifierIcon />
          <p className="label-caps">{s.q2Label}</p>
        </div>
        <h2 id="investigate-topic">{s.q2Title}</h2>
        <p className="investigate-question-help">{s.q2Help}</p>
        <div
          className="investigate-topics"
          role="group"
          aria-labelledby="investigate-topic"
          onKeyDown={moveInGroup}
        >
          {topics.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.id === topic.id ? 'investigate-topic investigate-topic-active' : 'investigate-topic'
              }
              aria-pressed={item.id === topic.id}
              onClick={() => commit({ topic: item.id })}
            >
              <TopicIcon id={item.id.startsWith('category-') ? 'other' : item.id} />
              <span className="investigate-topic-title">{item.label}</span>
              <span className="investigate-topic-blurb">{item.blurb}</span>
              <span className="investigate-topic-count">{s.topicCount(item.variableIds.length)}</span>
            </button>
          ))}
        </div>
        <Disclosure summary={s.whySummary} className="investigate-why">
          <p>{s.whyIntro}</p>
          <ul>
            {topics
              .filter((item) => item.id !== ALL_TOPIC)
              .map((item) => (
                <li key={item.id}>
                  <strong>{item.label}:</strong> {item.variableIds.map(labelOf).join(', ')}.
                </li>
              ))}
            <li>
              <strong>{s.whyAllTitle}:</strong> {s.whyAllBody}
            </li>
          </ul>
        </Disclosure>
      </section>

      <section className="investigate-question" aria-labelledby="investigate-when">
        <div className="investigate-question-top">
          <CalendarIcon />
          <p className="label-caps">{s.q3Label}</p>
        </div>
        <h2 id="investigate-when">{s.q3Title}</h2>
        <p className="investigate-question-help">{s.q3Help}</p>
        <div
          className="investigate-windows"
          role="group"
          aria-labelledby="investigate-when"
          onKeyDown={moveInGroup}
        >
          {index.windows.map((window) => (
            <button
              key={window.id}
              type="button"
              className={
                window.id === state.windowId ? 'investigate-window investigate-window-active' : 'investigate-window'
              }
              aria-pressed={window.id === state.windowId}
              onClick={() => commit({ windowId: window.id })}
            >
              <span className="investigate-window-years">{windowYears(window, window.id)}</span>
              <span className="investigate-window-note">
                {s.windowNotes[window.id] ?? s.windowNoteFallback(window.id)}
              </span>
            </button>
          ))}
        </div>
      </section>
      </div>

      <section className="investigate-answer" aria-labelledby="investigate-answer-title">
        <div className="investigate-answer-head">
          <div>
            <p className="label-caps">{s.answerKicker}</p>
            <h2 id="investigate-answer-title">{s.answerTitle}</h2>
          </div>
          <p className="investigate-answer-where">
            {place.label} · {topic.label} · {years}
          </p>
        </div>

        {header ? (
          <div className="investigate-report-head">
            <p className="label-caps investigate-report-kicker">{s.reportKicker}</p>
            <h3 className="investigate-report-title">{header.title}</h3>
            <p className="investigate-report-credit">
              {header.credit}. {header.exportLine}.
            </p>
            {header.localLine ? (
              <p className="investigate-report-local" lang="vi">
                {header.localLine}
              </p>
            ) : null}
            {cards.length > 0 ? <p className="investigate-report-summary">{header.summary}</p> : null}
            {header.products.length > 0 ? (
              <ul className="investigate-report-products" aria-label={s.productsAria}>
                {header.products.map((product) => (
                  <li key={product.text}>
                    <span className="investigate-report-product-vars">{product.variables.join(', ')}:</span>{' '}
                    {product.product}
                    {product.version ? ` ${product.version}` : ''} ·{' '}
                    {product.doi && product.doiUrl ? (
                      <>
                        {s.doi}{' '}
                        <a className="num-mono" href={product.doiUrl} target="_blank" rel="noreferrer">
                          {product.doi}
                        </a>
                      </>
                    ) : (
                      <span>{s.doiNotListed}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="investigate-report-limit">{header.limitation}</p>
            {cards.length > 0 ? (
              <div className="investigate-report-actions">
                <button type="button" className="button" onClick={() => window.print()}>
                  {s.print}
                </button>
                <button type="button" className="button" onClick={() => void copyLink()}>
                  {s.copyLink}
                </button>
                <button type="button" className="button" onClick={() => void saveImage()}>
                  {s.downloadImage}
                </button>
                <span className="investigate-share-note" role="status">
                  {shareNote}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {status === 'loading' ? (
          <div role="status" aria-label={s.loadingAria(place.label, years)}>
            <ol className="investigate-cards investigate-skeletons" aria-hidden="true">
              {[0, 1, 2].map((n) => (
                <li key={n} className="investigate-skeleton" />
              ))}
            </ol>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="investigate-status" role="alert">
            <p>{s.loadError(place.label, years, error ?? '')}</p>
            <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
              {s.tryAgain}
            </button>
          </div>
        ) : null}

        {status === 'ready' && notFound ? (
          <div className="investigate-status" role="status">
            <div>
              <p className="label-caps">{s.noDataLabel}</p>
              <p>{s.notPublished(place.label, years)}</p>
            </div>
            <button type="button" className="button secondary" onClick={() => commit({ place: GLOBAL_PLACE })}>
              {s.tryWorld}
            </button>
          </div>
        ) : null}

        {status === 'ready' && !notFound && cards.length === 0 ? (
          <div className="investigate-status" role="status">
            <div>
              <p className="label-caps">{s.noDataLabel}</p>
              <p>{s.noRows(place.label)}</p>
            </div>
            <button type="button" className="button secondary" onClick={() => commit({ place: GLOBAL_PLACE })}>
              {s.tryWorld}
            </button>
          </div>
        ) : null}

        {example && status === 'ready' && !notFound ? (
          <aside className="investigate-example" aria-label={s.exampleAria}>
            <div>
              <p className="investigate-example-kicker">
                {example.kind === 'caution' ? s.exampleCaution : s.exampleFinding}
              </p>
              <p className="investigate-example-title">{caseTitle(example, lang)}</p>
              <p className="investigate-example-note">{s.exampleNote}</p>
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={() => navigate('story', { caseId: example.id })}
            >
              {s.exampleButton}
            </button>
          </aside>
        ) : null}

        {cards.length > 0 ? (
          <ol className="investigate-cards">
            {cards.map((card) => (
              <li key={card.variableId}>
                <Card className="investigate-card">
                  <div className="investigate-card-head">
                    <div>
                      <h3>{card.label}</h3>
                      <p className="investigate-card-description">{variableDescription({ id: card.variableId, description: card.description }, lang)}</p>
                    </div>
                    <div className="investigate-card-chips">
                      <VerdictStamp label={card.verdict.label} tone={stampTone(card)} />
                    </div>
                  </div>

                  <p className="investigate-card-headline">{card.headline}</p>
                  <div className="investigate-bar-row">
                    <div
                      className="investigate-bar"
                      role="img"
                      aria-label={s.barAria(formatPercent(card.sigIncrease, 1), formatPercent(card.sigDecrease, 1))}
                    >
                      <span
                        className="investigate-bar-inc"
                        style={{ width: `${barPercent(card.sigIncrease)}%` }}
                      />
                      <span
                        className="investigate-bar-dec"
                        style={{ width: `${barPercent(card.sigDecrease)}%` }}
                      />
                    </div>
                    <p className="investigate-card-numbers num-mono">
                      <span className="investigate-num-inc">{s.numIncrease(formatPercent(card.sigIncrease, 1))}</span>
                      <span className="investigate-num-dec">{s.numDecrease(formatPercent(card.sigDecrease, 1))}</span>
                      <span className="investigate-num-unit">{formatUnitIn(card.unit, lang)}</span>
                    </p>
                  </div>

                  {card.notYetNote ? <p className="investigate-card-notyet">{card.notYetNote}</p> : null}
                  {card.cautions.map((caution) => (
                    <p className="investigate-card-caution" key={caution}>
                      {caution}
                    </p>
                  ))}
                  {card.witnessNote ? <p className="investigate-card-witness">{card.witnessNote}.</p> : null}

                  <Disclosure summary={s.howSummary} className="investigate-how">
                    <ul className="investigate-glossary">
                      <li>
                        <GlossaryTip term="significant" />
                      </li>
                      <li>
                        <GlossaryTip term="sudden_shift" />
                      </li>
                      <li>
                        <GlossaryTip term="second_witness" />
                      </li>
                    </ul>
                  </Disclosure>

                  <div className="investigate-card-actions">
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => openEvidence(card)}
                      aria-label={s.openEvidenceAria(card.label)}
                    >
                      {s.openEvidence}
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        navigate('discovery', { variableId: card.variableId, windowId: state.windowId })
                      }
                      aria-label={s.seeOnMapAria(card.label)}
                    >
                      {s.seeOnMap}
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        ) : null}

        {cards.length > 0 ? (
          <p className="investigate-rule">{s.rule(place.label, years)}</p>
        ) : null}
      </section>
    </div>
  )
}
