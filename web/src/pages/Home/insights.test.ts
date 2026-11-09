import { describe, expect, it } from 'vitest'
import type { DetectiveCase, ScreenerRow, VariableMeta } from '../../data/types'
import {
  QUALITY_NOTE_THRESHOLD,
  buildCautionEntry,
  buildHomeInsights,
  heroVariableId,
  qualityEvidenceText,
  shouldShowQualityNote,
} from './insights'

const variable = (id: string, label: string, category = 'water'): VariableMeta => ({
  id,
  label,
  category,
  product: 'TEST',
  product_version: '1',
  doi: null,
  source_type: 'model',
  source_variable: 'x',
  display_unit: 'mm/month',
  slope_unit: 'mm/month per year',
  description: '',
  caveats: [],
  core: true,
  increase_means: 'wetter',
})

const row = (
  variableId: string,
  increase: number,
  decrease: number,
  contrast: number | null,
  sigTrendFlagged: number | null = null,
): ScreenerRow => ({
  variable: variableId,
  valid_area_fraction: 0.99,
  sig_increase_area_fraction: increase,
  sig_decrease_area_fraction: decrease,
  median_abs_std_change_decade: 0.4,
  median_sen_slope_decade_sig: 1,
  regional_contrast: contrast,
  n_cells_evaluated: 100,
  sig_trend_flagged_fraction: sigTrendFlagged,
})

const variables = [
  variable('air_temperature', 'Air temperature', 'temperature'),
  variable('soil', 'Soil moisture'),
  variable('precipitation', 'Precipitation'),
]
const rows = [
  row('air_temperature', 0.57, 0.05, 0.07),
  row('soil', 0.09, 0.32, 0.22),
  row('precipitation', 0.06, 0.06, 0.48),
]

describe('buildHomeInsights', () => {
  it('derives every card from the screener rows', () => {
    const insights = buildHomeInsights(variables, rows, '2001-01', '2024-12')
    expect(insights.map((insight) => insight.id)).toEqual(['warming', 'breadth', 'decrease', 'contrast'])
    expect(insights[0]).toMatchObject({ value: '57.0%', variableId: 'air_temperature' })
    expect(insights[0]?.detail).toContain('2001-01–2024-12')
    expect(insights[1]).toMatchObject({ value: '3 / 3' })
    expect(insights[2]).toMatchObject({ value: '32.0%', variableId: 'soil' })
    expect(insights[3]).toMatchObject({ value: '0.48', variableId: 'precipitation' })
  })

  it('skips cards that have no evaluated data', () => {
    const sparse = [row('air_temperature', 0.02, 0, null)]
    const insights = buildHomeInsights([variables[0]!], sparse, '2001-01', '2024-12')
    expect(insights.map((insight) => insight.id)).toEqual(['warming'])
    expect(insights[0]?.value).toBe('2.0%')
  })

  it('returns nothing when every variable is unevaluated', () => {
    expect(buildHomeInsights(variables, [], '2001-01', '2024-12')).toEqual([])
    expect(heroVariableId(variables, [])).toBe('air_temperature')
  })

  it('picks the variable with the broadest significant area for the hero', () => {
    expect(heroVariableId(variables, rows)).toBe('air_temperature')
  })
})

describe('loss-signal quality weighting', () => {
  it('does not let a heavily flagged decreasing variable lead', () => {
    const candidates = [
      variable('specific_humidity', 'Specific humidity', 'atmosphere'),
      variable('soil', 'Soil moisture'),
    ]
    const candidateRows = [
      // Raw decrease is larger, but 90% of the significant area is flagged.
      row('specific_humidity', 0.08, 0.45, 0.16, 0.9),
      // Raw decrease is smaller, but none of it is flagged.
      row('soil', 0.09, 0.35, 0.22, 0),
    ]
    const insights = buildHomeInsights(candidates, candidateRows, '2001-01', '2024-12')
    const loss = insights.find((insight) => insight.id === 'decrease')
    expect(loss?.variableId).toBe('soil')
    expect(loss?.value).toBe('35.0%')
    expect(loss?.unit).toBe('of land shows a significant decrease in soil moisture')
  })

  it('falls back to the raw decrease when quality fields are absent', () => {
    const insights = buildHomeInsights(variables, rows, '2001-01', '2024-12')
    const loss = insights.find((insight) => insight.id === 'decrease')
    expect(loss?.variableId).toBe('soil')
  })
})

describe('quality evidence line', () => {
  it('shows one muted line only above the 20% flag threshold', () => {
    const flaggedRows = [
      row('air_temperature', 0.57, 0.05, 0.07, 0.488),
      row('soil', 0.09, 0.32, 0.22, 0.2),
      row('precipitation', 0.06, 0.06, 0.48, 0.21),
    ]
    const insights = buildHomeInsights(variables, flaggedRows, '2001-01', '2024-12')
    const warming = insights.find((insight) => insight.id === 'warming')!
    const loss = insights.find((insight) => insight.id === 'decrease')!
    const contrast = insights.find((insight) => insight.id === 'contrast')!
    expect(warming.qualityFlagged).toBeCloseTo(0.488)
    expect(shouldShowQualityNote(warming)).toBe(true)
    expect(qualityEvidenceText(warming)).toBe(
      '48.8% of this area shows a sudden shift; read the evidence',
    )
    expect(loss.qualityFlagged).toBe(0.2)
    expect(shouldShowQualityNote(loss)).toBe(false)
    expect(qualityEvidenceText(loss)).toBeNull()
    expect(contrast.qualityFlagged).toBe(0.21)
    expect(shouldShowQualityNote(contrast)).toBe(true)
    expect(QUALITY_NOTE_THRESHOLD).toBe(0.2)
  })
})

describe('caution entry card', () => {
  const caution: DetectiveCase = {
    id: 'case-caution-01',
    title: 'Vietnam is warming — but check the 2012 jump',
    region: { bbox: [102, 10, 109, 23], label: 'Vietnam' },
    window: '2001-2024',
    why_selected: 'Legacy technical text.',
    summary: 'Vietnam has warmed, but many cells carry a sudden-shift flag.',
    evidence: [
      {
        variable: 'air_temperature',
        product: 'GLDAS_NOAH10_M',
        method: 'MK',
        sen_slope_decade: 0.43,
        slope_unit: 'degC per decade',
        p_value: 0.0001,
        q_value: 0.0001,
        valid_observations: 288,
        coverage_fraction: 1,
        trend_class: 1,
      },
    ],
    limitations: [],
    kind: 'caution',
    quality_flag_share: 0.536,
  }

  it('builds a data-driven entry from the published caution case', () => {
    expect(buildCautionEntry([caution])).toEqual({
      caseId: 'case-caution-01',
      title: 'Look closer: Vietnam',
      summary: 'Vietnam has warmed, but many cells carry a sudden-shift flag.',
    })
  })

  it('falls back to why_selected and hides when no caution case exists', () => {
    const legacy = { ...caution, summary: undefined }
    expect(buildCautionEntry([legacy])?.summary).toBe('Legacy technical text.')
    expect(buildCautionEntry([])).toBeNull()
    expect(buildCautionEntry(undefined)).toBeNull()
    expect(buildCautionEntry([{ ...caution, kind: 'finding' }])).toBeNull()
  })
})
