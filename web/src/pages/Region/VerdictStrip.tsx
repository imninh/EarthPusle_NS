// The three cross-examination answers, built only from fields the Region page already has.
// No statistic is computed here: significance comes from the existing trend class, the
// quality answer from the existing QualitySummary, and the witness answer from §13 codes.
import {
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
} from '../../data/contract'
import type { EvidenceModel } from './model'
import { qualityDetailText, type QualitySummary } from './quality'
import { witnessAgreementText, type WitnessInfo } from './witness'

type StripTone = 'default' | 'caution'

type IconName = 'check' | 'clock' | 'warning' | 'question' | 'link' | 'cross'

export interface CrossAnswer {
  question: string
  answer: string
  detail: string
  tone: StripTone
  icon: IconName
  /** Text alternative for the icon, so colour is never the only signal. */
  iconLabel: string
}

/** Same display rounding as the evidence card (four decimals; exponent below 0.0001). */
export function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs !== 0 && abs < 0.0001) return value.toExponential(2)
  return value.toFixed(4)
}

/** Caution codes for the second dataset. Mirrors plainVerdict's caution inputs. */
export function witnessIsCaution(code: number | null | undefined): boolean {
  return code === WITNESS_SAME_SIGN || code === WITNESS_OPPOSITE_SIGN || code === WITNESS_CONTRADICTED
}

function significanceAnswer(evidence: EvidenceModel): CrossAnswer {
  const significant = evidence.trendClass === 'increasing' || evidence.trendClass === 'decreasing'
  const notYet = evidence.trendClass === 'not significant'
  const answer = significant ? 'Yes' : notYet ? 'Not yet' : 'Not enough data'
  const pText = evidence.p == null ? 'p not available' : `p = ${formatStat(evidence.p)}`
  const qText = evidence.showQ ? ` · q = ${formatStat(evidence.q)}` : ''
  return {
    question: '1 · Is it significant?',
    answer,
    detail: `${pText}${qText}`,
    tone: 'default',
    icon: significant ? 'check' : notYet ? 'clock' : 'question',
    iconLabel: significant ? 'Significant trend' : notYet ? 'Not yet significant' : 'Not enough data',
  }
}

function qualityAnswer(quality: QualitySummary | null): CrossAnswer {
  const question = '2 · Could it be a data glitch?'
  if (!quality?.available) {
    return {
      question,
      answer: 'Not checked',
      detail: 'No data-quality flag was exported for this selection.',
      tone: 'default',
      icon: 'question',
      iconLabel: 'Data quality not checked',
    }
  }
  const notEvaluated =
    (quality.scope === 'cell' && (quality.flag == null || quality.flag < 0)) ||
    (quality.scope === 'region' && quality.evaluatedCells === 0)
  if (notEvaluated) {
    return {
      question,
      answer: 'Not checked',
      detail:
        qualityDetailText(quality) ??
        (quality.scope === 'cell'
          ? 'This cell was not evaluated for sudden shifts.'
          : 'No cells in this region were evaluated for sudden shifts.'),
      tone: 'default',
      icon: 'question',
      iconLabel: 'Data quality not checked',
    }
  }
  const detail = qualityDetailText(quality)
  if (!quality.flagged) {
    return {
      question,
      answer: 'No flag',
      detail: detail ?? 'No sudden shift detected in the evaluated area.',
      tone: 'default',
      icon: 'check',
      iconLabel: 'No data-quality flag',
    }
  }
  if (quality.scope === 'cell') {
    return {
      question,
      answer: 'Sudden shift flagged',
      detail: detail ?? 'This cell carries a sudden-shift flag.',
      tone: 'caution',
      icon: 'warning',
      iconLabel: 'Data-quality warning',
    }
  }
  const pct =
    quality.flaggedShare != null && Number.isFinite(quality.flaggedShare)
      ? Math.round(quality.flaggedShare * 100)
      : null
  const year = quality.breakYear == null ? null : Math.round(quality.breakYear)
  const where = year == null ? '' : `around ${year}, `
  const detailText =
    pct == null
      ? 'Sudden shift flagged; the flagged share of the area is not available.'
      : `Sudden shift ${where}over ${pct}% of the area.`
  return {
    question,
    answer: 'Sudden shift flagged',
    detail: detailText,
    tone: 'caution',
    icon: 'warning',
    iconLabel: 'Data-quality warning',
  }
}

function witnessAnswer(witness: WitnessInfo | null): CrossAnswer {
  const question = '3 · Does a second NASA dataset agree?'
  if (!witness) {
    return {
      question,
      answer: 'No second dataset',
      detail: 'No second NASA dataset is exported for this selection.',
      tone: 'default',
      icon: 'question',
      iconLabel: 'No second dataset',
    }
  }
  const agreement = witness.agreement
  const detail = `${witness.label}: ${witnessAgreementText(agreement)}.`
  if (agreement === WITNESS_CONTRADICTED) {
    return {
      question,
      answer: 'Disagrees',
      detail,
      tone: 'caution',
      icon: 'cross',
      iconLabel: 'Second dataset disagrees',
    }
  }
  if (agreement === WITNESS_OPPOSITE_SIGN) {
    return {
      question,
      answer: 'Not significant there',
      detail,
      tone: 'caution',
      icon: 'link',
      iconLabel: 'Second dataset trend not significant',
    }
  }
  if (agreement === WITNESS_SAME_SIGN) {
    return {
      question,
      answer: 'Agrees on direction only',
      detail,
      tone: 'caution',
      icon: 'link',
      iconLabel: 'Second dataset agrees on direction only',
    }
  }
  if (agreement === WITNESS_MAIN_NOT_SIGNIFICANT) {
    return {
      question,
      answer: 'Not applicable',
      detail,
      tone: 'default',
      icon: 'question',
      iconLabel: 'Second dataset not applicable',
    }
  }
  if (agreement === WITNESS_CORROBORATED) {
    return {
      question,
      answer: 'Agrees',
      detail,
      tone: 'default',
      icon: 'check',
      iconLabel: 'Second dataset agrees',
    }
  }
  return {
    question,
    answer: 'Not evaluated',
    detail,
    tone: 'default',
    icon: 'question',
    iconLabel: 'Second dataset not evaluated',
  }
}

/** The three answers in order. Pure, so the page and its tests read the same source. */
export function crossExamination(
  evidence: EvidenceModel,
  quality: QualitySummary | null,
  witness: WitnessInfo | null,
): [CrossAnswer, CrossAnswer, CrossAnswer] {
  return [significanceAnswer(evidence), qualityAnswer(quality), witnessAnswer(witness)]
}

function AnswerIcon({ name, label }: { name: IconName; label: string }) {
  return (
    <svg
      className="verdict-strip-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      {name === 'check' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5L16.5 9.5" />
        </>
      )}
      {name === 'clock' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === 'warning' && (
        <>
          <path d="M12 3l9 17H3z" />
          <path d="M12 9v5" />
          <path d="M12 17.5h.01" />
        </>
      )}
      {name === 'question' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7" />
          <path d="M12 17h.01" />
        </>
      )}
      {name === 'link' && (
        <>
          <path d="M9.5 14.5l5-5" />
          <path d="M8 16l-1.2 1.2a3.5 3.5 0 0 0 5 5L13 21" />
          <path d="M16 8l1.2-1.2a3.5 3.5 0 0 0-5-5L11 3" />
        </>
      )}
      {name === 'cross' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </>
      )}
    </svg>
  )
}

/** The cross-examination strip: one question per answer, then the verdict lives in the header. */
export function VerdictStrip({
  evidence,
  quality,
  witness,
}: {
  evidence: EvidenceModel
  quality: QualitySummary | null
  witness: WitnessInfo | null
}) {
  const answers = crossExamination(evidence, quality, witness)
  return (
    <section className="verdict-strip-section" aria-labelledby="region-cross-examination">
      <h2 id="region-cross-examination" className="label-caps verdict-strip-title">
        Cross-examination
      </h2>
      <ol className="verdict-strip">
        {answers.map((item) => (
          <li
            key={item.question}
            className={`verdict-strip-cell${item.tone === 'caution' ? ' verdict-strip-cell--caution' : ''}`}
          >
            <AnswerIcon name={item.icon} label={item.iconLabel} />
            <div className="verdict-strip-copy">
              <p className="label-caps verdict-strip-question">{item.question}</p>
              <p className="verdict-strip-answer">{item.answer}</p>
              <p className="verdict-strip-detail">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
