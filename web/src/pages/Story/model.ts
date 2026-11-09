// Pure Story-mode helpers. The page renders only values that exist in cases.json.
import { INSUFFICIENT_DATA, OUTSIDE_DOMAIN, TREND_DECREASE, TREND_INCREASE, TREND_NOT_SIGNIFICANT } from '../../data/contract'
import type { CasesFile, DataIndex, DetectiveCase, EvidenceItem } from '../../data/types'

/** 0 is the intro; case n is step n + 1. */
export function stepFromCaseId(cases: readonly DetectiveCase[], caseId: string | null): number {
  if (caseId == null) return 0
  const index = cases.findIndex((item) => item.id === caseId)
  return index === -1 ? 0 : index + 1
}

export function caseIdForStep(cases: readonly DetectiveCase[], step: number): string | null {
  if (step <= 0) return null
  return cases[step - 1]?.id ?? null
}

export function stepTitle(cases: readonly DetectiveCase[], step: number): string {
  if (step <= 0) return 'How to read a case'
  return cases[step - 1]?.title ?? 'Case'
}

/** Prefer the case's first evidence variable; fall back to the index's first variable. */
export function evidenceVariableId(item: DetectiveCase, index: DataIndex): string {
  const first = item.evidence.find((evidence) => index.variables.some((variable) => variable.id === evidence.variable))
  return first?.variable ?? index.variables.find((variable) => variable.core)?.id ?? index.variables[0]?.id ?? ''
}

export function evidenceLabel(evidence: EvidenceItem, index: DataIndex): string {
  return index.variables.find((variable) => variable.id === evidence.variable)?.label ?? evidence.variable
}

export function trendClassWords(code: number, increaseMeans: string): string {
  if (code === TREND_INCREASE) return `significant increase (${increaseMeans})`
  if (code === TREND_DECREASE) return 'significant decrease'
  if (code === TREND_NOT_SIGNIFICANT) return 'not significant'
  if (code === INSUFFICIENT_DATA) return 'insufficient data'
  if (code === OUTSIDE_DOMAIN) return 'outside the domain'
  return `unknown class (${code})`
}

/** Format slope with the evidence unit, keeping small values readable. */
export function formatSlope(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute !== 0 && absolute < 0.001) return value.toExponential(2)
  return value.toFixed(absolute >= 100 ? 0 : 3)
}

export function formatStat(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute !== 0 && absolute < 0.0001) return value.toExponential(2)
  return value.toFixed(4)
}

export function formatCoverage(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

export function formatBbox(bbox: [number, number, number, number]): string {
  return `[${bbox.map((value) => Number(value.toFixed(1))).join(', ')}]`
}

export function hasCases(file: CasesFile | null): boolean {
  return file != null && file.cases.length > 0
}

/** Lead sentence: the plain-language summary, falling back to the legacy why_selected. */
export function caseLead(item: DetectiveCase): string {
  const summary = item.summary?.trim()
  return summary && summary.length > 0 ? summary : item.why_selected.trim()
}

/**
 * Technical selection text for the collapsed disclosure. Prefer `details`; if it is
 * absent, show why_selected only when it adds something beyond the lead sentence.
 */
export function caseDetails(item: DetectiveCase): string | null {
  const details = item.details?.trim()
  if (details && details.length > 0) return details
  const why = item.why_selected.trim()
  if (why.length === 0 || why === caseLead(item)) return null
  return why
}

/** Place name for the case list; never render an empty label. */
export function casePlaceLabel(item: DetectiveCase): string {
  const label = item.region.label.trim()
  return label.length > 0 ? label : 'Unnamed place'
}

export function isCautionCase(item: DetectiveCase): boolean {
  return item.kind === 'caution'
}

function finiteShare(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

/** Case-level flagged share, falling back to the area-weighted layer result. */
export function cautionShare(item: DetectiveCase, fallback?: number | null): number | null {
  return finiteShare(item.quality_flag_share) ?? finiteShare(fallback)
}

/** Parse "2001-2024" or "2013-2024" into integer years. */
export function caseWindowYears(windowId: string): { start: number; end: number } | null {
  const match = /^(\d{4})-(\d{4})$/.exec(windowId.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end }
}

/** Position of a year on a 0–100 % axis, clamped to the window. */
export function yearPosition(year: number, windowId: string): number | null {
  const years = caseWindowYears(windowId)
  if (!years || !Number.isFinite(year)) return null
  if (years.start === years.end) return 50
  const fraction = (year - years.start) / (years.end - years.start)
  return Math.min(100, Math.max(0, fraction * 100))
}


/** Two sentences for the intro, using the export's own threshold when available. */
export function significanceCopy(qThreshold: number): string {
  return `Significant means a trend whose FDR-adjusted q-value is below ${qThreshold}. The test is a Hamed–Rao modified Mann–Kendall test over monthly anomalies, with Benjamini–Hochberg correction across thousands of cells. A significant trend is evidence to read, not proof of cause, and "not significant" does not mean "no change".`
}
