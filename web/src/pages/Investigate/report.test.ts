import { describe, expect, it } from 'vitest'
import type { VariableMeta } from '../../data/types'
import {
  REPORT_CREDIT,
  REPORT_LIMITATION,
  VIETNAM_LINE,
  buildReportHeader,
  formatExportDate,
  wrapLines,
} from './report'

function variable(id: string, product: string, doi: string | null): VariableMeta {
  return {
    id,
    label: id.replace(/_/g, ' '),
    category: 'heat',
    product,
    product_version: '5',
    doi,
    source_type: 'model',
    source_variable: id,
    display_unit: 'K',
    slope_unit: 'K/decade',
    description: '',
    caveats: [],
    core: true,
    increase_means: 'warmer',
  }
}

const VARIABLES = [
  variable('a', 'PRODUCT_ONE', '10.5067/AAA'),
  variable('b', 'PRODUCT_ONE', '10.5067/AAA'),
  variable('c', 'PRODUCT_TWO', '10.5067/CCC'),
]

const strong = { label: 'Warmer, strong evidence', tone: 'accent' as const }
const caution = { label: 'Read with caution', tone: 'warn' as const }
const notYet = { label: 'A direction, not yet significant', tone: 'default' as const }

describe('buildReportHeader', () => {
  it('builds a header for a country with three cards and groups variables by product', () => {
    const header = buildReportHeader({
      placeId: 'country_704',
      placeLabel: 'Vietnam',
      period: '2001–2024',
      generatedAt: '2026-11-09T21:51:32Z',
      cards: [
        { variableId: 'a', verdict: caution },
        { variableId: 'b', verdict: strong },
        { variableId: 'c', verdict: notYet },
      ],
      variables: VARIABLES,
    })
    expect(header.title).toBe('Vietnam · 2001–2024')
    expect(header.credit).toBe(REPORT_CREDIT)
    expect(header.exportDate).toBe('9 Nov 2026')
    expect(header.products).toHaveLength(2)
    expect(header.products[0].variables).toEqual(['a', 'b'])
    expect(header.products[0].doiUrl).toBe('https://doi.org/10.5067/AAA')
    expect(header.products[0].text).toContain('DOI 10.5067/AAA')
    expect(header.significantCount).toBe(2)
    expect(header.summary).toBe(
      '2 of 3 variables shown have a significant change over a broad area of Vietnam.',
    )
    expect(header.limitation).toBe(REPORT_LIMITATION)
    expect(header.localLine).toBe(VIETNAM_LINE)
  })

  it('says plainly when no variable is significant, and has no Vietnamese line elsewhere', () => {
    const header = buildReportHeader({
      placeId: 'country_116',
      placeLabel: 'Cambodia',
      period: '2013–2024',
      generatedAt: '2026-11-09T21:51:32Z',
      cards: [
        { variableId: 'a', verdict: notYet },
        { variableId: 'c', verdict: notYet },
      ],
      variables: VARIABLES,
    })
    expect(header.significantCount).toBe(0)
    expect(header.summary).toContain('None of the 2 variables shown')
    expect(header.localLine).toBeNull()
  })

  it('marks a missing DOI instead of inventing one, and survives a bad date', () => {
    const header = buildReportHeader({
      placeId: 'country_116',
      placeLabel: 'Cambodia',
      period: '2001–2024',
      generatedAt: 'not a date',
      cards: [{ variableId: 'x', verdict: strong }],
      variables: [variable('x', 'PRODUCT_X', null)],
    })
    expect(header.products[0].doi).toBeNull()
    expect(header.products[0].doiUrl).toBeNull()
    expect(header.products[0].text).toContain('DOI not listed')
    expect(header.exportDate).toBeNull()
    expect(header.exportLine).toBe('Data export date not available')
  })

  it('ignores cards whose variable is not in the index', () => {
    const header = buildReportHeader({
      placeId: 'country_704',
      placeLabel: 'Vietnam',
      period: '2001–2024',
      generatedAt: '2026-11-09T21:51:32Z',
      cards: [{ variableId: 'zzz', verdict: strong }],
      variables: VARIABLES,
    })
    expect(header.products).toEqual([])
  })
})

describe('formatExportDate and wrapLines', () => {
  it('formats the UTC date', () => {
    expect(formatExportDate('2026-01-05T23:59:59Z')).toBe('5 Jan 2026')
    expect(formatExportDate('')).toBeNull()
  })

  it('wraps and truncates', () => {
    const measure = (s: string) => s.length
    expect(wrapLines('aa bb cc dd', 5, measure)).toEqual(['aa bb', 'cc dd'])
    expect(wrapLines('aa bb cc dd', 2, measure, 2)).toEqual(['aa', 'bb…'])
  })
})
