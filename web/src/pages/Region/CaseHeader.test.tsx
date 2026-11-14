import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Country } from '../../data/types'
import { VERDICT_LABELS } from '../../lib/format'
import { CaseHeader, outlinePath, verdictStampTone } from './CaseHeader'

const vietnam: Country = {
  id: 'country_704',
  label: 'Vietnam',
  iso_numeric: '704',
  index: 100,
  n_cells: 30,
  bbox: [102.1, 8.6, 109.5, 23.4],
}

// Synthetic square, not Natural Earth data: checks the projection only.
const syntheticPolygon = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
}

describe('outlinePath', () => {
  it('projects a synthetic polygon into the 96 × 120 box without NaN', () => {
    const path = outlinePath(syntheticPolygon)
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(path).not.toContain('NaN')
  })

  it('returns an empty path for missing or non-areal geometry', () => {
    expect(outlinePath(null)).toBe('')
    expect(outlinePath({ type: 'Point', coordinates: [0, 0] })).toBe('')
  })
})

describe('verdictStampTone', () => {
  it('maps the existing plainVerdict labels to stamp tones', () => {
    expect(verdictStampTone({ label: VERDICT_LABELS.caution, tone: 'warn' })).toBe('caution')
    expect(verdictStampTone({ label: 'Warmer, strong evidence', tone: 'accent' })).toBe('strong')
    expect(verdictStampTone({ label: VERDICT_LABELS.notYet, tone: 'default' })).toBe('not-yet')
    expect(verdictStampTone({ label: VERDICT_LABELS.noClear, tone: 'default' })).toBe('not-yet')
    expect(verdictStampTone({ label: VERDICT_LABELS.notEnough, tone: 'default' })).toBe('none')
    expect(verdictStampTone(null)).toBe('none')
  })
})

describe('CaseHeader', () => {
  it('renders one h1, the case-file line, the verdict and the country outline caption', () => {
    const html = renderToStaticMarkup(
      <CaseHeader
        title="Vietnam"
        variableLabel="Near-surface air temperature"
        windowStart="2001-01"
        windowEnd="2024-12"
        detail="Country region from Natural Earth. 30 grid cells inside the common mask."
        country={vietnam}
        verdict={{ label: VERDICT_LABELS.caution, tone: 'warn' }}
        onChoose={() => {}}
      />,
    )
    expect(html.match(/<h1/g)?.length).toBe(1)
    for (const text of [
      'Case file · Near-surface air temperature · 2001–2024',
      'Vietnam',
      'Country region from Natural Earth.',
      'Read with caution',
      'country boundary: Natural Earth',
      'Choose a different place',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('ui-stamp--caution')
    expect(html).toContain('region-case-outline')
  })

  it('does not draw an outline column for a box or cell', () => {
    const html = renderToStaticMarkup(
      <CaseHeader
        title="Cell row 12, column 103"
        variableLabel="Near-surface air temperature"
        windowStart="2001-01"
        windowEnd="2024-12"
        country={null}
        verdict={{ label: VERDICT_LABELS.notYet, tone: 'default' }}
        onChoose={() => {}}
      />,
    )
    expect(html).toContain('region-case-head--no-outline')
    expect(html).not.toContain('country boundary: Natural Earth')
    expect(html).toContain('ui-stamp--not-yet')
  })

  it('omits the stamp when there is no verdict', () => {
    const html = renderToStaticMarkup(
      <CaseHeader
        title="Vietnam"
        variableLabel="Near-surface air temperature"
        windowStart="2001-01"
        windowEnd="2024-12"
        country={vietnam}
        verdict={null}
        onChoose={() => {}}
      />,
    )
    expect(html).not.toContain('ui-stamp')
  })
})
