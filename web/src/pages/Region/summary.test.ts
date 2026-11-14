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
  senSlopeDecadeCI: { lower: 0.3, upper: 1.3 },
  slopeUnit: 'degC per decade',
  increaseMeans: 'warmer',
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
      'Over 2001–2024, near-surface air temperature in Vietnam rose by about 0.8 °C per decade; this trend is statistically significant (q = 0.0001).',
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

  it('keeps a visible but not-yet-significant direction and shows the interval', () => {
    const evidence = withEvidence({
      trendClass: 'not significant',
      p: 0.4,
      q: null,
      showQ: false,
      senSlopeDecadeCI: { lower: -0.2, upper: 1.8 },
    })
    const text = summarySentence({
      evidence,
      placeLabel: 'in Vietnam',
      windowStart: '2001-01',
      windowEnd: '2024-12',
      interval: evidence.senSlopeDecadeCI,
    })
    expect(text).toContain('near-surface air temperature in Vietnam rose by about 0.8 °C per decade')
    expect(text).toContain('not strong enough yet to call this significant')
    expect(text).toContain('(p = 0.4; the 95% interval -0.20 to +1.80 includes zero)')
    expect(text).toContain('A longer record could change this.')
    expect(text).not.toContain('no change')
  })

  it('replaces the generic longer-record line with the years-to-detect sentence', () => {
    const evidence = withEvidence({
      trendClass: 'not significant',
      p: 0.4,
      q: null,
      showQ: false,
      senSlopeDecadeCI: { lower: -0.2, upper: 1.8 },
    })
    const detection =
      'A trend of this size would need about 14.4 years of data to stand out from the natural ups and downs here (range 10.1–20.3). The record has 24.'
    const text = summarySentence({
      evidence,
      placeLabel: 'in Vietnam',
      windowStart: '2001-01',
      windowEnd: '2024-12',
      interval: evidence.senSlopeDecadeCI,
      detection,
    })
    expect(text).toContain(detection)
    expect(text).not.toContain('A longer record could change this.')
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
