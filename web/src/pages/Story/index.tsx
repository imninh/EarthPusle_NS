import { useCallback, useEffect, useState } from 'react'
import { Chip, Disclosure, Exhibit, GlossaryTip, VerdictStamp } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadCases } from '../../data/loaders'
import type { CasesFile, DetectiveCase } from '../../data/types'
import { formatUnit, formatUnitIn } from '../../lib/format'
import { useLang, useStrings } from '../../i18n'
import { caseTitle, variableLabel as variableName } from '../../i18n/terms'
import { CaseMiniMap } from './MiniMap'
import { QualityCaution } from './QualityCaution'
import { STORY_STRINGS } from './strings'
import {
  cautionStepText,
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
  const s = useStrings(STORY_STRINGS)
  const { lang } = useLang()
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
  const steps = current ? caseSteps(current, lang) : []
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
          <h1>{s.storyMode}</h1>
          <p>{s.loadError(error)}</p>
          <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            {s.retry}
          </button>
        </div>
      </section>
    )
  }

  if (!file) {
    return (
      <section className="story">
        <h1 className="sr-only">{s.storyMode}</h1>
        <p className="story-status" role="status">
          {s.loading}
        </p>
      </section>
    )
  }

  const progress =
    total === 0
      ? s.progressNone
      : step === 0
        ? s.progressIntro(total)
        : s.progressCase(step, total, sub + 1, steps.length)

  const nextLabel =
    step === 0
      ? s.nextStart
      : sub < lastSub
        ? s.nextStep
        : step >= total
          ? s.nextBackToIntro
          : s.nextCase
  const previousLabel = sub > 0 ? s.prevStep : step === 1 ? s.prevIntro : s.prevCase
  const onLastScreen = step > 0 && sub === lastSub

  return (
    <section className="story">
      <header className="story-head">
        <div>
          <p className="eyebrow">{s.storyMode}</p>
          <h1 className="display">{s.headTitle}</h1>
          <p className="story-promise">
            {s.promise}
          </p>
        </div>
        <p className="story-progress" role="status">
          {progress}
        </p>
      </header>

      {file.synthetic ? (
        <p className="story-status" role="alert">
          {s.synthetic}
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
            <h2>{s.emptyTitle}</h2>
            <p>
              {s.emptyBefore}
              <span className="mono">cases.json</span>
              {s.emptyAfter}
            </p>
            <div className="story-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => navigate('screener', { domain: 'global' })}
              >
                {s.exploreVariables}
              </button>
              <button type="button" className="button" onClick={() => navigate('discovery')}>
                {s.exploreMap}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="story-layout">
          <nav className="story-steps" aria-label={s.stepsNavLabel}>
            <button
              type="button"
              className={step === 0 ? 'story-step active' : 'story-step'}
              aria-current={step === 0 ? 'page' : undefined}
              onClick={() => navigate('story', { caseId: null })}
            >
              <span className="story-step-number">{s.introNumber}</span>
              <span>{s.introName}</span>
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
                  <span className="story-step-title">{caseTitle(item, lang)}</span>
                  <span className="story-step-place">{casePlaceLabel(item, lang)}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="story-case-select">
            <label className="label-caps" htmlFor="story-case-select">
              {s.caseSelectLabel}
            </label>
            <select
              id="story-case-select"
              value={current ? current.id : ''}
              onChange={(event) => navigate('story', { caseId: event.target.value || null })}
            >
              <option value="">{s.introOption}</option>
              {cases.map((item, caseIndex) => (
                <option key={item.id} value={item.id}>
                  {caseIndex + 1}. {caseTitle(item, lang)}
                </option>
              ))}
            </select>
          </div>

          <div className="story-main">
            {current ? (
              <ol className="story-rail" aria-label={s.railLabel}>
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
        <p>{s.footer}</p>
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
  const s = useStrings(STORY_STRINGS)
  const { lang } = useLang()
  return (
    <article className="story-card intro ui-card">
      <p className="eyebrow">{s.readFirst}</p>
      <h2>{stepTitle([], 0, lang)}</h2>
      <p>{significanceCopy(qThreshold, lang)}</p>
      <div className="story-intro-grid">
        <section>
          <h3>{s.sigHeading}</h3>
          <p>{s.sigBody}</p>
        </section>
        <section>
          <h3>{s.shiftHeading}</h3>
          <p>{s.shiftBody(hasQuality)}</p>
        </section>
        <section>
          <h3>{s.caseHeading}</h3>
          <p>{s.caseBody}</p>
        </section>
      </div>
      <Disclosure summary={s.howChosenAll}>
        <p>{formatUnit(selectionMethod)}</p>
      </Disclosure>
      {hasCases ? (
        <p className="story-hint">
          {s.hint}
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
  const s = useStrings(STORY_STRINGS)
  const { lang } = useLang()
  const variableId = evidenceVariableId(item, index)
  const variable = index.variables.find((entry) => entry.id === variableId)
  const variableLabel = variable ? variableName(variable, lang) : variableId
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
      caption={caseMapCaption(item, lang)}
    />
  )

  return (
    <article className={cautionStep ? 'story-stage caution' : 'story-stage'}>
      <div className="story-visual">{visual}</div>
      <div className={cautionStep ? 'story-text story-card caution' : 'story-text story-card'}>
        <p className="label-caps story-step-label">
          {s.stepLabel(sub + 1, stepCount, stepName)}
        </p>
        <h2>{caseTitle(item, lang)}</h2>
        <div className="story-text-meta">
          <span className="story-case-count">
            {s.caseCount(number, total)}
          </span>
          <Chip tone="accent">{item.window}</Chip>
        </div>

        {stepKey === 'question' ? (
          <>
            <p className="story-why">{formatUnit(caseLead(item))}</p>
            <p className="story-region">
              <strong>{item.region.label}</strong> · {caseRegionNote(item, lang)}
            </p>
            {caseDetails(item) ? (
              <Disclosure summary={s.howChosenOne}>
                <p>{formatUnit(caseDetails(item) ?? '')}</p>
              </Disclosure>
            ) : null}
            <Disclosure summary={s.howChosenAll}>
              <p>{formatUnit(selectionMethod)}</p>
            </Disclosure>
          </>
        ) : null}

        {stepKey === 'evidence' ? (
          <ul className="story-evidence">
            {item.evidence.map((evidence, evidenceIndex) => (
              <li key={`${evidence.variable}-${evidenceIndex}`}>
                <Exhibit
                  label={s.exhibitLabel(String.fromCharCode(65 + evidenceIndex), evidenceLabel(evidence, index, lang))}
                  value={formatSlope(evidence.sen_slope_decade)}
                  unit={formatUnitIn(evidence.slope_unit, lang)}
                  tone={evidence.trend_class === 1 ? 'increase' : evidence.trend_class === -1 ? 'decrease' : 'default'}
                >
                  <p className="story-muted">{evidence.product}</p>
                </Exhibit>
                <dl className="story-facts">
                  <dt>
                    {s.factRate}
                    <GlossaryTip term="rate_of_change" />
                  </dt>
                  <dd>
                    {formatSlope(evidence.sen_slope_decade)} {formatUnitIn(evidence.slope_unit, lang)}
                  </dd>
                  <dt>
                    {s.factStrength}
                    <GlossaryTip term="q_value" />
                  </dt>
                  <dd>
                    {formatStat(evidence.p_value)} / {formatStat(evidence.q_value)}
                  </dd>
                  <dt>
                    {s.factDirection}
                    <GlossaryTip term="trend" />
                  </dt>
                  <dd>{trendClassWords(evidence.trend_class, increaseMeans, lang)}</dd>
                  <dt>
                    {s.factMonths}
                    <GlossaryTip term="coverage" />
                  </dt>
                  <dd>{evidence.valid_observations}</dd>
                  <dt>
                    {s.factCoverage}
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
                        {s.secondWitness}
                        <GlossaryTip term="second_witness" />
                        {` (${witnessProductLabel(item, evidence.variable, index) ?? evidence.witness.product}):`}
                      </strong>{' '}
                      {s.witnessLine(
                        evidence.witness.variable,
                        witnessAgreementWords(evidence.witness.agreement, lang),
                        formatSignedSlope(evidence.witness.sen_slope_decade),
                        formatUnitIn(evidence.witness.slope_unit, lang),
                        formatStat(evidence.witness.q_value),
                      )}
                    </p>
                  </li>
                ) : null,
              )}
          </ul>
        ) : null}

        {cautionStep ? (
          <>
            <VerdictStamp label={s.cautionStamp} tone="caution" size="lg" />
            <p className="story-why">{cautionStepText(lang)}</p>
          </>
        ) : null}

        {stepKey === 'limits' ? (
          <>
            <h3>{s.limitations}</h3>
            {item.limitations.length > 0 ? (
              <ul className="story-limitations">
                {item.limitations.map((limitation) => (
                  <li key={limitation}>{formatUnit(limitation)}</li>
                ))}
              </ul>
            ) : (
              <p className="story-muted">{s.noLimitations}</p>
            )}
            <div className="story-actions">
              <button
                type="button"
                className={primaryAction ? 'button primary' : 'button'}
                onClick={openEvidence}
              >
                {caseRegionId(item) === 'global' ? caseEvidenceActionLabel(item, lang) : s.openEvidencePage}
              </button>
              <button type="button" className="button ghost" onClick={() => navigate('investigate')}>
                {s.ownInvestigation}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  )
}
