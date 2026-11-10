import { describe, expect, it } from 'vitest'
import type { EvidenceModel } from './model'
import type { QualitySummary } from './quality'
import { summarySentence } from './summary'

const base: EvidenceModel = {
  method: 'test',
  source: 'precomputed',
  variableLabel: 'Near-surface air temperature',
  category: 'temperature',
  product: 'GLDAS_NOAH10_M',
  productVersion: '2.1',
  doi: '10.5067/LWTYSMP3VM5Z',
  sourceVariable: 'Tair_f_inst',
  windowLabel: '2001-01 to 2024-12 (2001-2024)',
  senSlopeDecade: 0.8,
  slopeUnit: 'degC per decade',
  p: 0.0001,
  q: 0.0001,
  showQ: true,
  tau: 0.5,
  validMonths: 288,
  monthsInWindow: 288,
  coverage: 1,
  coverageNote: null,
  trendClass: 'increasing',
  caveats: [],
  shortWindow: false,
  cellsInBox: null,
  maskCells: null,
  cellsUsed: null,
  missingTiles: null,
}

function withEvidence(overrides: Partial<EvidenceModel>): EvidenceModel {
  return { ...base, ...overrides }
}

const flagged: QualitySummary = {
  scope: 'cell',
  available: true,
  flag: 2,
  flagged: true,
  flaggedShare: 1,
  flaggedCells: 1,
  evaluatedCells: 1,
  breakYear: 2011.4,
}

function sentence(
  evidence: EvidenceModel,
  quality: QualitySummary | null = null,
  knownForcingPeriod: readonly [number, number] | null = [2008, 2012],
): string {
  return summarySentence({
    evidence,
    placeLabel: 'in Vietnam',
    windowStart: '2001-01',
    windowEnd: '2024-12',
    quality,
    knownForcingPeriod,
  })
}

describe('summarySentence', () => {
  it('states a significant cell trend with q and a per-decade slope', () => {
    expect(sentence(base)).toBe(
      'Over 2001–2024, near-surface air temperature in Vietnam rose by about 0.8 degC per decade; this trend is statistically significant (q = 0.0001).',
    )
  })

  it('uses p for a locally computed trend and the right verb for non-temperature variables', () => {
    const evidence = withEvidence({
      variableLabel: 'Precipitation',
      category: 'water',
      source: 'browser',
      senSlopeDecade: -12,
      slopeUnit: 'mm/month per decade',
      p: 0.03,
      q: null,
      showQ: false,
      trendClass: 'decreasing',
    })
    const text = sentence(evidence)
    expect(text).toContain('precipitation in Vietnam decreased by about 12 mm/month per decade')
    expect(text).toContain('statistically significant (p = 0.03)')
  })

  it('falls back to p when q is marked shown but missing', () => {
    const text = sentence(withEvidence({ q: null, p: 0.02 }))
    expect(text).toContain('(p = 0.02)')
    expect(text).not.toContain('q =')
  })

  it('never turns "not significant" into "no change"', () => {
    const evidence = withEvidence({ trendClass: 'not significant', p: 0.4, q: null, showQ: false })
    const text = sentence(evidence)
    expect(text).toContain('not statistically significant')
    expect(text).toContain('does not mean there was no change')
  })

  it('describes insufficient data without a trend claim', () => {
    const evidence = withEvidence({ trendClass: 'insufficient data', senSlopeDecade: null, validMonths: 20 })
    const text = sentence(evidence)
    expect(text).toContain('there are not enough valid months')
    expect(text).not.toContain('statistically significant')
  })

  it('handles a trend class that is not available', () => {
    const text = sentence(withEvidence({ trendClass: 'not available', senSlopeDecade: null }))
    expect(text).toContain('there is not enough information')
  })

  it('adds the code-2 caution when the flag falls in a documented forcing change', () => {
    const text = sentence(base, flagged)
    expect(text).toContain('documented GLDAS input change (2008–2012)')
    expect(text).toContain('possible data discontinuity')
    expect(text).toContain('read the trend with caution')
    expect(text.startsWith('Over 2001–2024')).toBe(true)
    expect(text.endsWith('.')).toBe(true)
  })

  it('uses the code-1 caution for a shift outside the documented period', () => {
    const text = sentence(base, { ...flagged, flag: 1, breakYear: 2015 })
    expect(text).toContain('sudden shift around 2015')
    expect(text).toContain('real jump in the climate or a data artefact')
    expect(text).toContain('still significant')
    expect(text).not.toMatch(/wrong|error/i)
  })

  it('does not add a caution for an unflagged or absent quality result', () => {
    expect(sentence(base, { ...flagged, flagged: false })).not.toContain('sudden shift')
    expect(sentence(base, null)).not.toContain('sudden shift')
  })

  it('appends a witness corroboration clause', () => {
    const text = summarySentence({
      evidence: base,
      placeLabel: 'in Vietnam',
      windowStart: '2001-01',
      windowEnd: '2024-12',
      witness: { label: 'MERRA-2 reanalysis', agreement: 2 },
    })
    expect(text).toContain('MERRA-2 reanalysis shows the same warming')
    expect(text.endsWith('.')).toBe(true)
  })

  it('uses the combined quality + witness reading when both are present', () => {
    const real = summarySentence({
      evidence: base,
      placeLabel: 'in Vietnam',
      windowStart: '2001-01',
      windowEnd: '2024-12',
      quality: flagged,
      witness: { label: 'MERRA-2 reanalysis', agreement: 2 },
    })
    expect(real).toContain('more likely a real change')
    expect(real).not.toContain('possible data discontinuity')

    const artefact = summarySentence({
      evidence: base,
      placeLabel: 'in Vietnam',
      windowStart: '2001-01',
      windowEnd: '2024-12',
      quality: flagged,
      witness: { label: 'MERRA-2 reanalysis', agreement: -2 },
    })
    expect(artefact).toContain('more likely a data artefact')
  })
})
