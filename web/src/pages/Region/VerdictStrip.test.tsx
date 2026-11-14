import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_SAME_SIGN,
} from '../../data/contract'
import type { EvidenceModel } from './model'
import type { QualitySummary } from './quality'
import { VerdictStrip, crossExamination, witnessIsCaution } from './VerdictStrip'
import type { WitnessInfo } from './witness'

function evidence(overrides: Partial<EvidenceModel> = {}): EvidenceModel {
  return {
    method: 'test method',
    source: 'browser',
    variableLabel: 'Near-surface air temperature',
    category: 'Temperature',
    product: 'GLDAS_NOAH10_M',
    productVersion: '2.1',
    doi: null,
    sourceVariable: 'Tair_f_inst',
    windowLabel: '2001-01 to 2024-12 (full)',
    senSlopeDecade: 0.43,
    senSlopeDecadeCI: { lower: 0.3, upper: 0.55 },
    slopeUnit: 'degC per decade',
    increaseMeans: 'warmer',
    p: 3.88e-10,
    q: null,
    showQ: false,
    tau: 0.6,
    validMonths: 288,
    monthsInWindow: 288,
    coverage: 0.98,
    coverageNote: null,
    trendClass: 'increasing',
    caveats: [],
    shortWindow: false,
    cellsInBox: null,
    maskCells: null,
    cellsUsed: null,
    missingTiles: null,
    ...overrides,
  }
}

function quality(overrides: Partial<QualitySummary> = {}): QualitySummary {
  return {
    scope: 'region',
    available: true,
    flag: null,
    flagged: true,
    flaggedShare: 0.54,
    flaggedCells: 20,
    evaluatedCells: 40,
    breakYear: 2012,
    ...overrides,
  }
}

function witness(overrides: Partial<WitnessInfo> = {}): WitnessInfo {
  return {
    label: 'MERRA-2',
    product: 'MERRA2',
    version: '2',
    doi: null,
    unit: 'degC',
    anomalies: [],
    trend: {
      slopeDecade: 0.07,
      slopeDecadeCI: null,
      p: 0.31,
      tau: 0.08,
      validMonths: 288,
      monthsInWindow: 288,
      trendClass: 'not significant',
    },
    agreement: WITNESS_SAME_SIGN,
    ...overrides,
  }
}

describe('crossExamination', () => {
  it('reads a Vietnam-like case: significant, flagged, witness only on direction', () => {
    const answers = crossExamination(evidence(), quality(), witness())
    expect(answers[0].answer).toBe('Yes')
    expect(answers[0].detail).toContain('p = 3.88e-10')
    expect(answers[0].tone).toBe('default')
    expect(answers[1].answer).toBe('Sudden shift flagged')
    expect(answers[1].detail).toBe('Sudden shift around 2012, over 54% of the area.')
    expect(answers[1].tone).toBe('caution')
    expect(answers[2].answer).toBe('Agrees on direction only')
    expect(answers[2].detail).toContain('MERRA-2')
    expect(answers[2].tone).toBe('caution')
  })

  it('reads a clean significant case with a corroborating witness', () => {
    const answers = crossExamination(
      evidence(),
      quality({ flagged: false, flaggedShare: 0, flaggedCells: 0, breakYear: null }),
      witness({ agreement: WITNESS_CORROBORATED }),
    )
    expect(answers.map((answer) => answer.answer)).toEqual(['Yes', 'No flag', 'Agrees'])
    expect(answers.every((answer) => answer.tone === 'default')).toBe(true)
  })

  it('says not yet when the existing trend class is not significant', () => {
    const answers = crossExamination(evidence({ trendClass: 'not significant', p: 0.42 }), quality(), witness())
    expect(answers[0].answer).toBe('Not yet')
    expect(answers[0].icon).toBe('clock')
  })

  it('reports not checked and no second dataset when the fields are absent', () => {
    const answers = crossExamination(evidence(), null, null)
    expect(answers[1].answer).toBe('Not checked')
    expect(answers[1].detail).toBe('No data-quality flag was exported for this selection.')
    expect(answers[2].answer).toBe('No second dataset')
    expect(answers[2].detail).toBe('No second NASA dataset is exported for this selection.')
  })

  it('shows q for a cell and uses the cell quality wording', () => {
    const answers = crossExamination(
      evidence({ source: 'precomputed', showQ: true, q: 0.001, trendClass: 'decreasing' }),
      quality({
        scope: 'cell',
        flag: 1,
        flagged: true,
        flaggedShare: 1,
        flaggedCells: 1,
        evaluatedCells: 1,
        breakYear: 2012,
      }),
      null,
    )
    expect(answers[0].detail).toContain('q = 0.0010')
    expect(answers[1].answer).toBe('Sudden shift flagged')
    expect(answers[1].detail).toContain('Sudden shift around 2012')
  })

  it('marks a contradicting or opposite witness as caution', () => {
    expect(witnessIsCaution(WITNESS_CONTRADICTED)).toBe(true)
    expect(witnessIsCaution(WITNESS_SAME_SIGN)).toBe(true)
    expect(witnessIsCaution(WITNESS_CORROBORATED)).toBe(false)
    expect(witnessIsCaution(WITNESS_MAIN_NOT_SIGNIFICANT)).toBe(false)
    const answers = crossExamination(evidence(), quality(), witness({ agreement: WITNESS_CONTRADICTED }))
    expect(answers[2].answer).toBe('Disagrees')
    expect(answers[2].tone).toBe('caution')
  })
})

describe('VerdictStrip', () => {
  it('renders the three questions, answers and icon text alternatives', () => {
    const html = renderToStaticMarkup(
      <VerdictStrip evidence={evidence()} quality={quality()} witness={witness()} />,
    )
    for (const text of [
      'Is it significant?',
      'Could it be a data glitch?',
      'Does a second NASA dataset agree?',
      'Yes',
      'Sudden shift flagged',
      'Agrees on direction only',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('verdict-strip-cell--caution')
    expect(html).toContain('aria-label="Data-quality warning"')
    expect(html).toContain('role="img"')
    expect(html).toContain('<h2')
  })
})
