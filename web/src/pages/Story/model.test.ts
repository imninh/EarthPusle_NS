import { describe, expect, it } from 'vitest'
import type { CasesFile, DataIndex, DetectiveCase } from '../../data/types'
import {
  caseDetails,
  caseDestination,
  caseEvidenceActionLabel,
  caseIdForStep,
  caseLead,
  caseMapCaption,
  casePlaceLabel,
  caseRegionId,
  caseRegionNote,
  caseWindowYears,
  cautionShare,
  cautionCaseForVariable,
  cautionCases,
  combinedQualityWitnessText,
  evidenceVariableId,
  formatBbox,
  formatSignedSlope,
  formatSlope,
  hasCases,
  isCautionCase,
  qualityBreakYearLead,
  significanceCopy,
  stepFromCaseId,
  stepTitle,
  trendClassWords,
  witnessAgreementWords,
  witnessProductLabel,
  yearPosition,
} from './model'

const detectiveCase = (id: string, variable = 'precipitation'): DetectiveCase => ({
  id,
  title: `Title ${id}`,
  region: { bbox: [1, 2, 3, 4], label: 'Region' },
  window: '2001-2024',
  why_selected: 'Because',
  evidence: [
    {
      variable,
      product: 'IMERG',
      method: 'MK',
      sen_slope_decade: 1.23456,
      slope_unit: 'mm/month per decade',
      p_value: 0.001,
      q_value: 0.02,
      valid_observations: 276,
      coverage_fraction: 0.96,
      trend_class: 1,
    },
  ],
  limitations: ['Approximate box'],
})

const index = {
  variables: [
    { id: 'air_temperature', core: true },
    { id: 'precipitation', core: false },
  ],
} as unknown as DataIndex

describe('story steps', () => {
  const cases = [detectiveCase('case-01'), detectiveCase('case-02')]

  it('maps the intro and cases to stable steps', () => {
    expect(stepFromCaseId(cases, null)).toBe(0)
    expect(stepFromCaseId(cases, 'case-01')).toBe(1)
    expect(stepFromCaseId(cases, 'case-02')).toBe(2)
    expect(stepFromCaseId(cases, 'missing')).toBe(0)
    expect(caseIdForStep(cases, 0)).toBeNull()
    expect(caseIdForStep(cases, 2)).toBe('case-02')
    expect(caseIdForStep(cases, 3)).toBeNull()
    expect(stepTitle(cases, 0)).toBe('How to read a case')
    expect(stepTitle(cases, 1)).toBe('Title case-01')
  })

  it('knows when the file has no cases', () => {
    const empty: CasesFile = { synthetic: false, selection_method: 'x', cases: [] }
    expect(hasCases(empty)).toBe(false)
    expect(hasCases({ ...empty, cases })).toBe(true)
    expect(hasCases(null)).toBe(false)
  })
})

describe('case evidence formatting', () => {
  it('falls back to an indexed variable when the evidence variable is unknown', () => {
    expect(evidenceVariableId(detectiveCase('x', 'precipitation'), index)).toBe('precipitation')
    expect(evidenceVariableId(detectiveCase('x', 'not_in_index'), index)).toBe('air_temperature')
  })

  it('uses descriptive trend words, never verdicts', () => {
    expect(trendClassWords(1, 'wetter')).toBe('significant increase (wetter)')
    expect(trendClassWords(-1, 'wetter')).toBe('significant decrease')
    expect(trendClassWords(0, 'wetter')).toBe('not significant')
    expect(trendClassWords(-9, 'wetter')).toBe('insufficient data')
    expect(trendClassWords(-99, 'wetter')).toBe('outside the domain')
    expect(trendClassWords(7, 'wetter')).toBe('unknown class (7)')
  })

  it('formats slopes, boxes and the significance explanation', () => {
    expect(formatSlope(1.23456)).toBe('1.235')
    expect(formatSlope(0.00012)).toBe('1.20e-4')
    expect(formatSlope(Number.NaN)).toBe('—')
    expect(formatBbox([-80, -20, -45.25, 5])).toBe('[-80, -20, -45.3, 5]')
    expect(significanceCopy(0.05)).toContain('below 0.05')
  })
})

describe('case lead, details and labels', () => {
  it('uses summary as the lead and falls back to why_selected', () => {
    expect(caseLead({ ...detectiveCase('a'), summary: '  A plain sentence.  ' })).toBe('A plain sentence.')
    expect(caseLead(detectiveCase('b'))).toBe('Because')
  })

  it('puts technical details in the disclosure without repeating the lead', () => {
    expect(caseDetails({ ...detectiveCase('a'), summary: 'Plain.', details: ' Score = 8.2. ' })).toBe('Score = 8.2.')
    expect(caseDetails({ ...detectiveCase('a'), summary: 'Plain.', why_selected: 'Technical.' })).toBe('Technical.')
    expect(caseDetails({ ...detectiveCase('a'), summary: 'Same.', why_selected: 'Same.' })).toBeNull()
    expect(caseDetails(detectiveCase('a'))).toBeNull()
  })

  it('shows a non-empty place name and detects caution cases', () => {
    expect(casePlaceLabel(detectiveCase('a'))).toBe('Region')
    expect(casePlaceLabel({ ...detectiveCase('a'), region: { ...detectiveCase('a').region, label: '  ' } })).toBe(
      'Unnamed place',
    )
    expect(isCautionCase({ ...detectiveCase('a'), kind: 'caution' })).toBe(true)
    expect(isCautionCase({ ...detectiveCase('a'), kind: 'finding' })).toBe(false)
    expect(isCautionCase(detectiveCase('a'))).toBe(false)
  })
})

describe('case destinations and region labels', () => {
  const withId = (id: string | undefined, variable = 'air_temperature'): DetectiveCase => {
    const item = detectiveCase('case-x', variable)
    return { ...item, region: { ...item.region, ...(id == null ? {} : { id }) } } as DetectiveCase
  }

  it('keeps an exact country domain for both buttons', () => {
    const item = withId('country_704')
    expect(caseRegionId(item)).toBe('country_704')
    expect(caseRegionNote(item)).toBe('country boundary')
    expect(caseEvidenceActionLabel(item)).toBe('Open evidence')
    expect(caseDestination(item, 'map')).toEqual({
      page: 'discovery',
      selection: { kind: 'region', regionId: 'country_704' },
    })
    expect(caseDestination(item, 'evidence')).toEqual({
      page: 'region',
      selection: { kind: 'region', regionId: 'country_704' },
    })
  })

  it('uses the witness layer or Screener for a global case', () => {
    const item = withId('global', 'specific_humidity')
    expect(caseRegionNote(item)).toBe('all evaluated land')
    expect(caseEvidenceActionLabel(item)).toBe('Open in Explore variables')
    expect(caseDestination(item, 'map')).toEqual({ page: 'discovery', mapLayer: 'witness' })
    expect(caseDestination(item, 'evidence')).toEqual({ page: 'screener' })
  })

  it('falls back to the bbox when region.id is absent', () => {
    const item = withId(undefined)
    expect(caseRegionId(item)).toBeNull()
    expect(caseRegionNote(item)).toBe('approximate box [1, 2, 3, 4]')
    expect(caseMapCaption(item)).toBe('Approximate case box. Not a country boundary.')
    expect(caseEvidenceActionLabel(item)).toBe('Open evidence')
    expect(caseDestination(item, 'map')).toEqual({
      page: 'discovery',
      selection: { kind: 'bbox', bbox: [1, 2, 3, 4] },
    })
    expect(caseDestination(item, 'evidence')).toEqual({
      page: 'region',
      selection: { kind: 'bbox', bbox: [1, 2, 3, 4] },
    })
  })

  it('hides the approximate-box caption when region.id exists', () => {
    expect(caseMapCaption(withId('country_704'))).toBeNull()
    expect(caseMapCaption(withId('global'))).toBeNull()
  })

  it('uses cell wording for the quality break year', () => {
    expect(qualityBreakYearLead(2012)).toBe('The median break year across these cells is 2012')
    expect(qualityBreakYearLead(2012)).not.toContain('case box')
  })

  it('formats the witness slope with a sign', () => {
    expect(formatSignedSlope(0.131)).toBe('+0.131')
    expect(formatSignedSlope(-1.27)).toBe('-1.270')
    expect(formatSignedSlope(Number.NaN)).toBe('—')
  })
})

describe('caution chart helpers', () => {
  it('supports more than one caution case and finds one by variable', () => {
    const first = { ...detectiveCase('case-a', 'air_temperature'), kind: 'caution' as const }
    const second = { ...detectiveCase('case-b', 'specific_humidity'), kind: 'caution' as const }
    const finding = detectiveCase('case-c', 'specific_humidity')
    expect(cautionCases([first, finding, second]).map((item) => item.id)).toEqual(['case-a', 'case-b'])
    expect(cautionCaseForVariable([first, finding, second], 'specific_humidity')?.id).toBe('case-b')
    expect(cautionCaseForVariable([first], 'specific_humidity')).toBeNull()
  })

  it('prefers the case flagged share and clamps the fallback', () => {
    expect(cautionShare({ ...detectiveCase('a'), quality_flag_share: 0.536 }, 0.2)).toBe(0.536)
    expect(cautionShare(detectiveCase('a'), 0.2)).toBe(0.2)
    expect(cautionShare(detectiveCase('a'), 1.4)).toBe(1)
    expect(cautionShare({ ...detectiveCase('a'), quality_flag_share: -0.2 })).toBe(0)
    expect(cautionShare(detectiveCase('a'), null)).toBeNull()
  })

  it('maps years onto the case window for the break marker', () => {
    expect(caseWindowYears('2001-2024')).toEqual({ start: 2001, end: 2024 })
    expect(caseWindowYears('2013-2024')).toEqual({ start: 2013, end: 2024 })
    expect(caseWindowYears('not-a-window')).toBeNull()
    expect(yearPosition(2012, '2001-2024')).toBeCloseTo((11 / 23) * 100, 8)
    expect(yearPosition(1990, '2001-2024')).toBe(0)
    expect(yearPosition(2030, '2001-2024')).toBe(100)
    expect(yearPosition(2005, 'nope')).toBeNull()
  })
})

describe('second-witness wording', () => {
  it('maps agreement codes to §13 language', () => {
    expect(witnessAgreementWords(2)).toBe('a second, independent NASA dataset agrees')
    expect(witnessAgreementWords(-2)).toContain('disagrees')
    expect(witnessAgreementWords(1)).toContain('same direction')
    expect(witnessAgreementWords(-1)).toContain('opposite direction')
    expect(witnessAgreementWords(-9)).toBe('not evaluated')
  })

  it('gives the combined caution reading only when a witness exists', () => {
    expect(combinedQualityWitnessText(2)).toContain('more likely a real change')
    expect(combinedQualityWitnessText(1)).toContain('more likely a data artefact')
    expect(combinedQualityWitnessText(-1)).toContain('more likely a data artefact')
    expect(combinedQualityWitnessText(-2)).toBe(
      'A sudden shift is flagged, and an independent dataset shows a significant trend in the opposite direction: the trend is disputed.',
    )
    expect(combinedQualityWitnessText(-9)).toContain('No independent witness')
    expect(combinedQualityWitnessText(0)).toBeNull()
  })

  it('prefers the index witness label and falls back to the evidence product', () => {
    const item = detectiveCase('witnessed')
    item.evidence[0]!.witness = {
      product: 'MERRA-2 M2TMNXSLV 5.12.4',
      variable: 'T2M',
      sen_slope_decade: 0.2,
      slope_unit: 'degC per decade',
      q_value: 0.01,
      agreement: 2,
    }
    expect(witnessProductLabel(item, 'precipitation', index)).toBe('MERRA-2 M2TMNXSLV 5.12.4')
    const labelled = {
      ...index,
      witness: {
        method: 'same test',
        layers: [],
        products: {
          precipitation: {
            product: 'GPCP',
            version: '3.3',
            source_variable: 'sat_gauge_precip',
            doi: '10.5067/test',
            label: 'GPCP precipitation',
          },
        },
      },
    } as unknown as DataIndex
    expect(witnessProductLabel(item, 'precipitation', labelled)).toBe('GPCP precipitation')
  })
})
