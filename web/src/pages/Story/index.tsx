import { useCallback, useEffect, useState } from 'react'
import { Chip, Disclosure, Exhibit, GlossaryTip, VerdictStamp } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadCases } from '../../data/loaders'
import type { CasesFile, DetectiveCase } from '../../data/types'
import { formatUnit } from '../../lib/format'
import { CaseMiniMap } from './MiniMap'
import { QualityCaution } from './QualityCaution'
import {
  CAUTION_STEP_TEXT,
  caseDetails,
  caseDestination,
  caseEvidenceActionLabel,
  caseIdForStep,
  caseLead,
  caseMapCaption,
  casePlaceLabel,
  caseRegionId,
  caseRegionNote,
  caseSteps,
  clampStep,
  evidenceLabel,
  evidenceVariableId,
  formatCoverage,
  formatSignedSlope,
  formatSlope,
  formatStat,
  significanceCopy,
  stepFromCaseId,
  stepTitle,
  trendClassWords,
  witnessAgreementWords,
  witnessProductLabel,
} from './model'
import './story.css'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Where the reader is inside the current case. Reset by comparing the case id. */
interface Position {
  caseId: string | null
  sub: number
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

export default function StoryPage() {
  const { index, navigate, caseId } = useApp()
  const [file, setFile] = useState<CasesFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [position, setPosition] = useState<Position>({ caseId: null, sub: 0 })

  useEffect(() => {
    let cancelled = false
    setFile(null)
    setError(null)
    loadCases()
      .then((data) => {
        if (!cancelled) setFile(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const cases = file?.cases ?? []
  const step = stepFromCaseId(cases, caseId)
  const total = cases.length
  const current = step > 0 ? cases[step - 1] : null
  const steps = current ? caseSteps(current) : []
  const sub = clampStep(position.caseId === caseId ? position.sub : 0, steps.length)
  const lastSub = steps.length - 1

  const goNext = useCallback(() => {
    if (current && sub < lastSub) {
      setPosition({ caseId: current.id, sub: sub + 1 })
      return
    }
    const target = caseIdForStep(cases, step + 1)
    setPosition({ caseId: target, sub: 0 })
    navigate('story', { caseId: target })
  }, [cases, current, lastSub, navigate, step, sub])

  const goPrevious = useCallback(() => {
    if (current && sub > 0) {
      setPosition({ caseId: current.id, sub: sub - 1 })
      return
    }
    if (step <= 0) return
    const target = caseIdForStep(cases, step - 1)
    // Going back into a case lands on its last screen.
    setPosition({ caseId: target, sub: Number.MAX_SAFE_INTEGER })
    navigate('story', { caseId: target })
  }, [cases, current, navigate, step, sub])

  // Arrow keys move one screen; they never fire while a control that uses them has focus.
  useEffect(() => {
    if (!file || total === 0) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isTypingTarget(event.target)) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrevious()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, total, goNext, goPrevious])

  if (error) {
    return (
      <section className="story">
        <div className="story-status" role="alert">
          <h1>Story mode</h1>
          <p>Could not load cases.json. {error}</p>
          <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  if (!file) {
    return (
      <section className="story">
        <h1 className="sr-only">Story mode</h1>
        <p className="story-status" role="status">
          Loading detective cases…
        </p>
      </section>
    )
  }

  const progress =
    total === 0
      ? 'No cases published'
      : step === 0
        ? `Intro · ${total} cases`
        : `Case ${step} of ${total} · Step ${sub + 1} of ${steps.length}`

  const nextLabel =
    step === 0
      ? 'Start with case 1'
      : sub < lastSub
        ? 'Next step'
        : step >= total
          ? 'Back to intro'
          : 'Next case'
  const previousLabel = sub > 0 ? 'Previous step' : step === 1 ? 'Intro' : 'Previous case'
  const onLastScreen = step > 0 && sub === lastSub

  return (
    <section className="story">
      <header className="story-head">
        <div>
          <p className="eyebrow">Story mode</p>
          <h1 className="display">Follow the evidence</h1>
          <p className="story-promise">
            Walk through published detective cases step by step. Every number and region comes from computed outputs.
          </p>
        </div>
        <p className="story-progress" role="status">
          {progress}
        </p>
      </header>

      {file.synthetic ? (
        <p className="story-status" role="alert">
          This cases file is synthetic development data, not a NASA result.
        </p>
      ) : null}

      {total === 0 ? (
        <>
          <IntroCard
            qThreshold={index.q_threshold}
            hasQuality={Boolean(index.quality)}
            selectionMethod={file.selection_method}
          />
          <div className="story-empty ui-card">
            <Chip tone="accent">cases.json</Chip>
            <h2>No detective cases are published in this build yet</h2>
            <p>
              Story mode reads <span className="mono">cases.json</span> and never invents a case. When the case builder
              publishes entries, this page becomes the guided tour. In the meantime, the Screener and the map already
              contain the same computed evidence.
            </p>
            <div className="story-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => navigate('screener', { domain: 'global' })}
              >
                Explore variables
              </button>
              <button type="button" className="button" onClick={() => navigate('discovery')}>
                Explore the map
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="story-layout">
          <nav className="story-steps" aria-label="Case steps">
            <button
              type="button"
              className={step === 0 ? 'story-step active' : 'story-step'}
              aria-current={step === 0 ? 'page' : undefined}
              onClick={() => navigate('story', { caseId: null })}
            >
              <span className="story-step-number">Intro</span>
              <span>How to read a case</span>
            </button>
            {cases.map((item, caseIndex) => (
              <button
                key={item.id}
                type="button"
                className={step === caseIndex + 1 ? 'story-step active' : 'story-step'}
                aria-current={step === caseIndex + 1 ? 'page' : undefined}
                onClick={() => navigate('story', { caseId: item.id })}
              >
                <span className="story-step-number">{caseIndex + 1}</span>
                <span className="story-step-text">
                  <span className="story-step-title">{item.title}</span>
                  <span className="story-step-place">{casePlaceLabel(item)}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="story-case-select">
            <label className="label-caps" htmlFor="story-case-select">
              Case
            </label>
            <select
              id="story-case-select"
              value={current ? current.id : ''}
              onChange={(event) => navigate('story', { caseId: event.target.value || null })}
            >
              <option value="">Intro · How to read a case</option>
              {cases.map((item, caseIndex) => (
                <option key={item.id} value={item.id}>
                  {caseIndex + 1}. {item.title}
                </option>
              ))}
            </select>
          </div>

          <div className="story-main">
            {current ? (
              <ol className="story-rail" aria-label="Steps in this case">
                {steps.map((entry, stepIndex) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className={
                        stepIndex === sub
                          ? 'story-rail-item active'
                          : stepIndex < sub
                            ? 'story-rail-item done'
                            : 'story-rail-item'
                      }
                      aria-current={stepIndex === sub ? 'step' : undefined}
                      onClick={() => setPosition({ caseId: current.id, sub: stepIndex })}
                    >
                      <span className="story-rail-dot" aria-hidden="true" />
                      <span className="story-rail-name">{entry.name}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}

            {current ? (
              <CaseStage
                key={`${current.id}-${steps[sub]?.key}`}
                item={current}
                number={step}
                total={total}
                sub={sub}
                stepCount={steps.length}
                stepKey={steps[sub]?.key ?? 'question'}
                stepName={steps[sub]?.name ?? ''}
                selectionMethod={file.selection_method}
                primaryAction={onLastScreen}
              />
            ) : (
              <IntroCard
                qThreshold={index.q_threshold}
                hasQuality={Boolean(index.quality)}
                selectionMethod={file.selection_method}
                hasCases
              />
            )}

            <div className="story-nav">
              {step > 0 ? (
                <button type="button" className="button" onClick={goPrevious}>
                  ← {previousLabel}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className={onLastScreen ? 'button' : 'button primary'}
                onClick={goNext}
              >
                {nextLabel} →
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="story-foot">
        <p>Case windows come from cases.json. The map and Region Explorer open the case&apos;s own window.</p>
      </footer>
    </section>
  )
}

function IntroCard({
  qThreshold,
  hasQuality,
  selectionMethod,
  hasCases = false,
}: {
  qThreshold: number
  hasQuality: boolean
  selectionMethod: string
  hasCases?: boolean
}) {
  return (
    <article className="story-card intro ui-card">
      <p className="eyebrow">Read this first</p>
      <h2>{stepTitle([], 0)}</h2>
      <p>{significanceCopy(qThreshold)}</p>
      <div className="story-intro-grid">
        <section>
          <h3>What &ldquo;significant&rdquo; means</h3>
          <p>
            The test asks whether a monotonic trend is unlikely under no change. The q-value is corrected across all
            evaluated cells, so &ldquo;significant&rdquo; is stronger evidence than a raw p-value alone.
          </p>
        </section>
        <section>
          <h3>Sudden shifts and quality flags</h3>
          <p>
            {hasQuality
              ? 'This export includes data-quality layers. '
              : 'When the export includes data-quality layers, '}
            Code 1 means a sudden shift around a break year: this could be a real jump in the climate or a data
            artefact. The trend is still significant; a step fits slightly better than a straight line. Code 2 means
            the shift falls during a documented GLDAS input change (2008–2012): possible data discontinuity, so read
            the trend with caution.
          </p>
        </section>
        <section>
          <h3>What a case is</h3>
          <p>
            A case is a computed region and window where the evidence is interesting enough to explain. The title and
            why-selected text are editorial; the evidence numbers are not.
          </p>
        </section>
      </div>
      <Disclosure summary="How these cases were chosen">
        <p>{formatUnit(selectionMethod)}</p>
      </Disclosure>
      {hasCases ? (
        <p className="story-hint">
          Use Next, the arrow keys, the case list, or the browser back button to move through cases.
        </p>
      ) : null}
    </article>
  )
}

/** One screen of one case: visual left (60%), text right (40%). */
function CaseStage({
  item,
  number,
  total,
  sub,
  stepCount,
  stepKey,
  stepName,
  selectionMethod,
  primaryAction,
}: {
  item: DetectiveCase
  number: number
  total: number
  sub: number
  stepCount: number
  stepKey: 'question' | 'evidence' | 'witness' | 'caution' | 'limits'
  stepName: string
  selectionMethod: string
  primaryAction: boolean
}) {
  const { index, navigate } = useApp()
  const variableId = evidenceVariableId(item, index)
  const variable = index.variables.find((entry) => entry.id === variableId)
  const variableLabel = variable?.label ?? variableId
  const increaseMeans = variable?.increase_means ?? 'increase'
  const cautionStep = stepKey === 'caution'
  const openEvidence = () => {
    const destination = caseDestination(item, 'evidence')
    navigate(destination.page, {
      variableId,
      windowId: item.window,
      selection: destination.selection,
      mapLayer: destination.mapLayer,
    })
  }

  const visual = cautionStep ? (
    <QualityCaution item={item} variableId={variableId} qualityAvailable={Boolean(index.quality)} />
  ) : (
    <CaseMiniMap
      variableId={variableId}
      windowId={item.window}
      bbox={item.region.bbox}
      label={variableLabel}
      caption={caseMapCaption(item)}
    />
  )

  return (
    <article className={cautionStep ? 'story-stage caution' : 'story-stage'}>
      <div className="story-visual">{visual}</div>
      <div className={cautionStep ? 'story-text story-card caution' : 'story-text story-card'}>
        <p className="label-caps story-step-label">
          Step {sub + 1} of {stepCount} · {stepName}
        </p>
        <h2>{item.title}</h2>
        <div className="story-text-meta">
          <span className="story-case-count">
            Case {number} of {total}
          </span>
          <Chip tone="accent">{item.window}</Chip>
        </div>

        {stepKey === 'question' ? (
          <>
            <p className="story-why">{formatUnit(caseLead(item))}</p>
            <p className="story-region">
              <strong>{item.region.label}</strong> · {caseRegionNote(item)}
            </p>
            {caseDetails(item) ? (
              <Disclosure summary="How this case was chosen">
                <p>{formatUnit(caseDetails(item) ?? '')}</p>
              </Disclosure>
            ) : null}
            <Disclosure summary="How these cases were chosen">
              <p>{formatUnit(selectionMethod)}</p>
            </Disclosure>
          </>
        ) : null}

        {stepKey === 'evidence' ? (
          <ul className="story-evidence">
            {item.evidence.map((evidence, evidenceIndex) => (
              <li key={`${evidence.variable}-${evidenceIndex}`}>
                <Exhibit
                  label={`Exhibit ${String.fromCharCode(65 + evidenceIndex)} · ${evidenceLabel(evidence, index)}`}
                  value={formatSlope(evidence.sen_slope_decade)}
                  unit={formatUnit(evidence.slope_unit)}
                  tone={evidence.trend_class === 1 ? 'increase' : evidence.trend_class === -1 ? 'decrease' : 'default'}
                >
                  <p className="story-muted">{evidence.product}</p>
                </Exhibit>
                <dl className="story-facts">
                  <dt>
                    Rate of change (Sen slope) per decade
                    <GlossaryTip term="rate_of_change" />
                  </dt>
                  <dd>
                    {formatSlope(evidence.sen_slope_decade)} {formatUnit(evidence.slope_unit)}
                  </dd>
                  <dt>
                    Evidence strength (p / q)
                    <GlossaryTip term="q_value" />
                  </dt>
                  <dd>
                    {formatStat(evidence.p_value)} / {formatStat(evidence.q_value)}
                  </dd>
                  <dt>
                    Direction (trend class)
                    <GlossaryTip term="trend" />
                  </dt>
                  <dd>{trendClassWords(evidence.trend_class, increaseMeans)}</dd>
                  <dt>
                    Months with data
                    <GlossaryTip term="coverage" />
                  </dt>
                  <dd>{evidence.valid_observations}</dd>
                  <dt>
                    Coverage
                    <GlossaryTip term="coverage" />
                  </dt>
                  <dd>{formatCoverage(evidence.coverage_fraction)}</dd>
                </dl>
                <p className="story-method">{formatUnit(evidence.method)}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {stepKey === 'witness' ? (
          <ul className="story-evidence">
            {item.evidence
              .filter((evidence) => evidence.witness)
              .map((evidence, evidenceIndex) =>
                evidence.witness ? (
                  <li key={`${evidence.variable}-${evidenceIndex}`}>
                    <p className="story-witness">
                      <strong>
                        Second witness
                        <GlossaryTip term="second_witness" /> (
                        {witnessProductLabel(item, evidence.variable, index) ?? evidence.witness.product}):
                      </strong>{' '}
                      {evidence.witness.variable} {witnessAgreementWords(evidence.witness.agreement)}; slope{' '}
                      {formatSignedSlope(evidence.witness.sen_slope_decade)} {formatUnit(evidence.witness.slope_unit)}; q{' '}
                      {formatStat(evidence.witness.q_value)}.
                    </p>
                  </li>
                ) : null,
              )}
          </ul>
        ) : null}

        {cautionStep ? (
          <>
            <VerdictStamp label="Read with caution" tone="caution" size="lg" />
            <p className="story-why">{CAUTION_STEP_TEXT}</p>
          </>
        ) : null}

        {stepKey === 'limits' ? (
          <>
            <h3>Limitations</h3>
            {item.limitations.length > 0 ? (
              <ul className="story-limitations">
                {item.limitations.map((limitation) => (
                  <li key={limitation}>{formatUnit(limitation)}</li>
                ))}
              </ul>
            ) : (
              <p className="story-muted">No limitations were listed for this case.</p>
            )}
            <div className="story-actions">
              <button
                type="button"
                className={primaryAction ? 'button primary' : 'button'}
                onClick={openEvidence}
              >
                {caseRegionId(item) === 'global' ? caseEvidenceActionLabel(item) : 'Open this case in the evidence page'}
              </button>
              <button type="button" className="button ghost" onClick={() => navigate('investigate')}>
                Start your own investigation
              </button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  )
}
