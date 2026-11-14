// Pure builder for the country report header (task I1). It words and orders
// values that already exist in index.json and in the card models; it computes no
// statistic and invents no DOI.
import type { VariableMeta } from '../../data/types'
import type { CardModel } from './model'

export const REPORT_CREDIT = 'Report generated from NASA data by EarthPulse'
export const REPORT_LIMITATION = 'A country figure is an area-weighted summary of 1° grid cells.'
/** The only Vietnamese line; the page stays English otherwise. */
export const VIETNAM_PLACE_ID = 'country_704'
export const VIETNAM_LINE =
  'Báo cáo cho Việt Nam: xem bằng chứng, cảnh báo dữ liệu và bộ dữ liệu NASA thứ hai.'

export interface ReportProduct {
  /** Variables of this product that appear in the report. */
  variables: string[]
  product: string
  version: string
  /** Bare DOI such as `10.5067/…`, or null when the registry lists none. */
  doi: string | null
  /** `https://doi.org/…` for the link, or null. */
  doiUrl: string | null
  /** One line for print and the PNG: "MERRA-2 … · DOI 10.5067/…" or "… · DOI not listed". */
  text: string
}

export interface ReportHeader {
  title: string
  /** "2001–2024". */
  period: string
  credit: string
  /** "9 Nov 2026" (UTC date of index.generated_at), or null if it cannot be read. */
  exportDate: string | null
  exportLine: string
  products: ReportProduct[]
  /** How many shown variables carry a significant (not "not yet") verdict. */
  significantCount: number
  /** One sentence; says plainly when nothing is significant. */
  summary: string
  limitation: string
  /** Vietnamese line, for Vietnam only. */
  localLine: string | null
}

export interface ReportHeaderInput {
  placeId: string
  placeLabel: string
  /** "2001–2024". */
  period: string
  /** index.generated_at. */
  generatedAt: string
  cards: readonly Pick<CardModel, 'variableId' | 'verdict'>[]
  variables: readonly VariableMeta[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-09T21:51:32Z" → "9 Nov 2026" (the UTC calendar date); null if unreadable. */
export function formatExportDate(generatedAt: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(generatedAt ?? '')
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${day} ${MONTHS[month - 1]} ${match[1]}`
}

function cleanDoi(doi: string | null | undefined): string | null {
  if (typeof doi !== 'string') return null
  const trimmed = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  return trimmed === '' ? null : trimmed
}

/** Significant means a strong-evidence or caution verdict (the stamp is not "not yet"). */
function isSignificantVerdict(tone: string): boolean {
  return tone === 'accent' || tone === 'warn'
}

export function buildReportHeader(input: ReportHeaderInput): ReportHeader {
  const byId = new Map(input.variables.map((variable) => [variable.id, variable]))
  const groups = new Map<string, ReportProduct>()
  for (const card of input.cards) {
    const variable = byId.get(card.variableId)
    if (!variable) continue
    const doi = cleanDoi(variable.doi)
    const key = `${variable.product}\u0000${variable.product_version}\u0000${doi ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.variables.push(variable.label)
      continue
    }
    const version = variable.product_version
    groups.set(key, {
      variables: [variable.label],
      product: variable.product,
      version,
      doi,
      doiUrl: doi ? `https://doi.org/${doi}` : null,
      text: `${variable.product}${version ? ` ${version}` : ''} · ${doi ? `DOI ${doi}` : 'DOI not listed'}`,
    })
  }

  const significantCount = input.cards.filter((card) => isSignificantVerdict(card.verdict.tone)).length
  const total = input.cards.length
  let summary: string
  if (total === 0) summary = 'No variable is shown for this selection.'
  else if (significantCount === 0) {
    summary = `None of the ${total} variables shown has a significant change over a broad area of ${input.placeLabel}.`
  } else {
    summary = `${significantCount} of ${total} variables shown ${significantCount === 1 ? 'has' : 'have'} a significant change over a broad area of ${input.placeLabel}.`
  }

  const exportDate = formatExportDate(input.generatedAt)
  return {
    title: `${input.placeLabel} · ${input.period}`,
    period: input.period,
    credit: REPORT_CREDIT,
    exportDate,
    exportLine: exportDate ? `Data export of ${exportDate}` : 'Data export date not available',
    products: [...groups.values()],
    significantCount,
    summary,
    limitation: REPORT_LIMITATION,
    localLine: input.placeId === VIETNAM_PLACE_ID ? VIETNAM_LINE : null,
  }
}

/** Wrap text to a pixel width for canvas drawing; `measure` returns the width of a string. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (measure(candidate) <= maxWidth || current === '') current = candidate
    else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`
    return kept
  }
  return lines
}
