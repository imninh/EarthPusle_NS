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
import { pick, useLang, type Lang } from '../../i18n'
import type { EvidenceModel } from './model'
import { qualityDetailText, type QualitySummary } from './quality'
import { STRIP_STRINGS } from './strings'
import { witnessLabelText } from './strings.place'
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

function significanceAnswer(evidence: EvidenceModel, lang: Lang): CrossAnswer {
  const s = pick(STRIP_STRINGS, lang)
  const significant = evidence.trendClass === 'increasing' || evidence.trendClass === 'decreasing'
  const notYet = evidence.trendClass === 'not significant'
  const answer = significant ? s.yes : notYet ? s.notYet : s.notEnoughData
  const pText = evidence.p == null ? s.pUnavailable : `p = ${formatStat(evidence.p)}`
  const qText = evidence.showQ ? ` · q = ${formatStat(evidence.q)}` : ''
  return {
    question: s.q1,
    answer,
    detail: `${pText}${qText}`,
    tone: 'default',
    icon: significant ? 'check' : notYet ? 'clock' : 'question',
    iconLabel: significant ? s.significantIcon : notYet ? s.notYetIcon : s.notEnoughIcon,
  }
}

function qualityAnswer(quality: QualitySummary | null, lang: Lang): CrossAnswer {
  const s = pick(STRIP_STRINGS, lang)
  const question = s.q2
  if (!quality?.available) {
    return {
      question,
      answer: s.notChecked,
      detail: s.noFlagExported,
      tone: 'default',
      icon: 'question',
      iconLabel: s.notCheckedIcon,
    }
  }
  const notEvaluated =
    (quality.scope === 'cell' && (quality.flag == null || quality.flag < 0)) ||
    (quality.scope === 'region' && quality.evaluatedCells === 0)
  if (notEvaluated) {
    return {
      question,
      answer: s.notChecked,
      detail:
        qualityDetailText(quality, lang) ??
        (quality.scope === 'cell' ? s.cellNotEvaluated : s.regionNotEvaluated),
      tone: 'default',
      icon: 'question',
      iconLabel: s.notCheckedIcon,
    }
  }
  const detail = qualityDetailText(quality, lang)
  if (!quality.flagged) {
    return {
      question,
      answer: s.noFlag,
      detail: detail ?? s.noShiftArea,
      tone: 'default',
      icon: 'check',
      iconLabel: s.noFlagIcon,
    }
  }
  if (quality.scope === 'cell') {
    return {
      question,
      answer: s.shiftFlagged,
      detail: detail ?? s.cellFlag,
      tone: 'caution',
      icon: 'warning',
      iconLabel: s.warningIcon,
    }
  }
  const pct =
    quality.flaggedShare != null && Number.isFinite(quality.flaggedShare)
      ? Math.round(quality.flaggedShare * 100)
      : null
  const year = quality.breakYear == null ? null : Math.round(quality.breakYear)
  const detailText = pct == null ? s.shareUnavailable : s.shareLine(year, String(pct))
  return {
    question,
    answer: s.shiftFlagged,
    detail: detailText,
    tone: 'caution',
    icon: 'warning',
    iconLabel: s.warningIcon,
  }
}

function witnessAnswer(witness: WitnessInfo | null, lang: Lang): CrossAnswer {
  const s = pick(STRIP_STRINGS, lang)
  const question = s.q3
  if (!witness) {
    return {
      question,
      answer: s.noSecond,
      detail: s.noSecondDetail,
      tone: 'default',
      icon: 'question',
      iconLabel: s.noSecondIcon,
    }
  }
  const agreement = witness.agreement
  const detail = s.witnessDetail(witnessLabelText(witness.label, lang), witnessAgreementText(agreement, lang))
  if (agreement === WITNESS_CONTRADICTED) {
    return { question, answer: s.disagrees, detail, tone: 'caution', icon: 'cross', iconLabel: s.disagreesIcon }
  }
  if (agreement === WITNESS_OPPOSITE_SIGN) {
    return {
      question,
      answer: s.notSignificantThere,
      detail,
      tone: 'caution',
      icon: 'link',
      iconLabel: s.notSignificantThereIcon,
    }
  }
  if (agreement === WITNESS_SAME_SIGN) {
    return {
      question,
      answer: s.directionOnly,
      detail,
      tone: 'caution',
      icon: 'link',
      iconLabel: s.directionOnlyIcon,
    }
  }
  if (agreement === WITNESS_MAIN_NOT_SIGNIFICANT) {
    return {
      question,
      answer: s.notApplicable,
      detail,
      tone: 'default',
      icon: 'question',
      iconLabel: s.notApplicableIcon,
    }
  }
  if (agreement === WITNESS_CORROBORATED) {
    return { question, answer: s.agrees, detail, tone: 'default', icon: 'check', iconLabel: s.agreesIcon }
  }
  return { question, answer: s.notEvaluated, detail, tone: 'default', icon: 'question', iconLabel: s.notEvaluatedIcon }
}

/** The three answers in order. Pure, so the page and its tests read the same source. */
export function crossExamination(
  evidence: EvidenceModel,
  quality: QualitySummary | null,
  witness: WitnessInfo | null,
  lang: Lang = 'en',
): [CrossAnswer, CrossAnswer, CrossAnswer] {
  return [significanceAnswer(evidence, lang), qualityAnswer(quality, lang), witnessAnswer(witness, lang)]
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
  const { lang } = useLang()
  const s = pick(STRIP_STRINGS, lang)
  const answers = crossExamination(evidence, quality, witness, lang)
  return (
    <section className="verdict-strip-section" aria-labelledby="region-cross-examination">
      <h2 id="region-cross-examination" className="label-caps verdict-strip-title">
        {s.title}
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
