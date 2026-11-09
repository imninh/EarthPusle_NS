import { useEffect, useState } from 'react'
import { Chip, Disclosure } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadCases } from '../../data/loaders'
import type { CasesFile, DetectiveCase } from '../../data/types'
import { CaseMiniMap } from './MiniMap'
import { QualityCaution } from './QualityCaution'
import {
  caseDetails,
  caseIdForStep,
  caseLead,
  casePlaceLabel,
  evidenceLabel,
  evidenceVariableId,
  formatBbox,
  formatCoverage,
  formatSlope,
  formatStat,
  isCautionCase,
  significanceCopy,
  stepFromCaseId,
  stepTitle,
  trendClassWords,
} from './model'
import './story.css'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function StoryPage() {
  const { index, navigate, caseId } = useApp()
  const [file, setFile] = useState<CasesFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

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
        <p className="story-status" role="status">
          Loading detective cases…
        </p>
      </section>
    )
  }

  return (
    <section className="story">
      <header className="story-head">
        <div>
          <p className="eyebrow">Story mode</p>
          <h1>Follow the evidence</h1>
          <p className="story-promise">
            Walk through published detective cases step by step. Every number and region comes from computed outputs.
          </p>
        </div>
        <p className="story-progress" role="status">
          {total === 0 ? 'No cases published' : step === 0 ? `Intro · ${total} cases` : `Case ${step} of ${total}`}
        </p>
      </header>

      {file.synthetic ? (
        <p className="story-status" role="alert">
          This cases file is synthetic development data, not a NASA result.
        </p>
      ) : null}

      {total === 0 ? (
        <>
          <IntroCard qThreshold={index.q_threshold} hasQuality={Boolean(index.quality)} />
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
              aria-current={step === 0 ? 'step' : undefined}
              onClick={() => navigate('story', { caseId: null })}
            >
              <span className="story-step-number">Intro</span>
              <span>How to read a case</span>
            </button>
            {cases.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={step === index + 1 ? 'story-step active' : 'story-step'}
                aria-current={step === index + 1 ? 'step' : undefined}
                onClick={() => navigate('story', { caseId: item.id })}
              >
                <span className="story-step-number">{index + 1}</span>
                <span className="story-step-text">
                  <span className="story-step-title">{item.title}</span>
                  <span className="story-step-place">{casePlaceLabel(item)}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="story-main">
            {current ? (
              <CaseCard item={current} number={step} total={total} />
            ) : (
              <IntroCard qThreshold={index.q_threshold} hasQuality={Boolean(index.quality)} hasCases />
            )}

            <div className="story-nav">
              {step > 0 ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => navigate('story', { caseId: caseIdForStep(cases, step - 1) })}
                >
                  ← {step === 1 ? 'Intro' : 'Previous case'}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="button primary"
                onClick={() => navigate('story', { caseId: caseIdForStep(cases, step + 1) })}
              >
                {step >= total ? 'Back to intro' : step === 0 ? 'Start with case 1' : 'Next case'} →
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="story-foot">
        <p>
          <strong>Selection method:</strong> {file.selection_method}
        </p>
        <p>Case windows come from cases.json. The map and Region Explorer open the case&apos;s own window.</p>
      </footer>
    </section>
  )
}

function IntroCard({
  qThreshold,
  hasQuality,
  hasCases = false,
}: {
  qThreshold: number
  hasQuality: boolean
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
      {hasCases ? <p className="story-hint">Use Next, the step list, or the browser back button to move through cases.</p> : null}
    </article>
  )
}

function CaseCard({ item, number, total }: { item: DetectiveCase; number: number; total: number }) {
  const { index, navigate } = useApp()
  const variableId = evidenceVariableId(item, index)
  const variable = index.variables.find((entry) => entry.id === variableId)
  const variableLabel = variable?.label ?? variableId
  const increaseMeans = variable?.increase_means ?? 'increase'
  const lead = caseLead(item)
  const details = caseDetails(item)
  const caution = isCautionCase(item)
  const open = (page: 'discovery' | 'region') =>
    navigate(page, {
      variableId,
      windowId: item.window,
      selection: { kind: 'bbox', bbox: item.region.bbox },
    })

  return (
    <article className={caution ? 'story-card caution ui-card' : 'story-card ui-card'}>
      <div className="story-card-top">
        <span className="story-step-number">
          Case {number} of {total}
        </span>
        <Chip tone="accent">{item.window}</Chip>
      </div>
      <h2>{item.title}</h2>
      <p className="story-why">{lead}</p>
      <p className="story-region">
        <strong>{item.region.label}</strong> · approximate box {formatBbox(item.region.bbox)}
      </p>

      {details ? (
        <Disclosure summary="How this case was chosen">
          <p>{details}</p>
        </Disclosure>
      ) : null}

      {caution ? (
        <QualityCaution item={item} variableId={variableId} qualityAvailable={Boolean(index.quality)} />
      ) : null}

      <CaseMiniMap variableId={variableId} windowId={item.window} bbox={item.region.bbox} label={variableLabel} />

      <h3>Key evidence</h3>
      <ul className="story-evidence">
        {item.evidence.map((evidence, evidenceIndex) => (
          <li key={`${evidence.variable}-${evidenceIndex}`}>
            <div className="story-evidence-head">
              <strong>{evidenceLabel(evidence, index)}</strong>
              <span className="story-muted">{evidence.product}</span>
            </div>
            <dl className="story-facts">
              <dt>Sen slope per decade</dt>
              <dd>
                {formatSlope(evidence.sen_slope_decade)} {evidence.slope_unit}
              </dd>
              <dt>p / q</dt>
              <dd>
                {formatStat(evidence.p_value)} / {formatStat(evidence.q_value)}
              </dd>
              <dt>Trend class</dt>
              <dd>{trendClassWords(evidence.trend_class, increaseMeans)}</dd>
              <dt>Valid months</dt>
              <dd>{evidence.valid_observations}</dd>
              <dt>Coverage</dt>
              <dd>{formatCoverage(evidence.coverage_fraction)}</dd>
            </dl>
            <p className="story-method">{evidence.method}</p>
          </li>
        ))}
      </ul>

      <h3>Limitations</h3>
      {item.limitations.length > 0 ? (
        <ul className="story-limitations">
          {item.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      ) : (
        <p className="story-muted">No limitations were listed for this case.</p>
      )}

      <div className="story-actions">
        <button type="button" className="button secondary" onClick={() => open('discovery')}>
          Show on map
        </button>
        <button type="button" className="button" onClick={() => open('region')}>
          Open evidence
        </button>
      </div>
    </article>
  )
}
