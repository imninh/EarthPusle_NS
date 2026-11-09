import { describe, expect, it } from 'vitest'
import type { CasesFile, DataIndex, DetectiveCase } from '../../data/types'
import {
  caseDetails,
  caseIdForStep,
  caseLead,
  casePlaceLabel,
  caseWindowYears,
  cautionShare,
  evidenceVariableId,
  formatBbox,
  formatSlope,
  hasCases,
  isCautionCase,
  significanceCopy,
  stepFromCaseId,
  stepTitle,
  trendClassWords,
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

describe('caution chart helpers', () => {
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
