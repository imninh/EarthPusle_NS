import { describe, expect, it } from 'vitest'
import type { DetectiveCase, ScreenerRow, VariableMeta } from '../../data/types'
import {
  QUALITY_NOTE_THRESHOLD,
  buildCautionEntry,
  buildHomeInsights,
  heroVariableId,
  qualityEvidenceText,
  shouldShowQualityNote,
  witnessEvidenceText,
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
  witnessConfirmed: number | null = null,
  witnessContradicted: number | null = null,
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
  witness_corroborated_fraction: witnessConfirmed,
  witness_contradicted_fraction: witnessContradicted,
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

  it('uses witness corroboration when it is present', () => {
    const candidates = [
      variable('specific_humidity', 'Specific humidity', 'atmosphere'),
      variable('root_zone_soil_moisture', 'Root-zone soil moisture'),
      variable('surface_soil_moisture', 'Surface soil moisture'),
    ]
    const candidateRows = [
      // 0.416 x 0.156 = 0.065: most-contradicted, so it must not lead.
      row('specific_humidity', 0.08, 0.416, 0.16, null, 0.156, 0.394),
      // 0.333 x 0.309 = 0.103: the witness-weighted winner.
      row('root_zone_soil_moisture', 0.09, 0.333, 0.22, null, 0.309, 0.1),
      // 0.281 x 0.324 = 0.091.
      row('surface_soil_moisture', 0.09, 0.281, 0.22, null, 0.324, 0.2),
    ]
    const insights = buildHomeInsights(candidates, candidateRows, '2001-01', '2024-12')
    const loss = insights.find((insight) => insight.id === 'decrease')
    expect(loss?.variableId).toBe('root_zone_soil_moisture')
    expect(loss?.value).toBe('33.3%')
    expect(loss?.witnessConfirmed).toBeCloseTo(0.309)
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

  it('keeps the country caution case when another global caution case exists', () => {
    const globalCaution: DetectiveCase = {
      ...caution,
      id: 'case-caution-global',
      region: { bbox: [-180, -60, 180, 90], label: 'Global land' },
      evidence: [{ ...caution.evidence[0]!, variable: 'specific_humidity' }],
    }
    expect(buildCautionEntry([globalCaution, caution], [{ label: 'Vietnam' }])?.caseId).toBe(caution.id)
    expect(buildCautionEntry([globalCaution, caution], [])?.caseId).toBe(globalCaution.id)
  })
})

describe('second-witness disagreement card', () => {
  const caution: DetectiveCase = {
    id: 'case-caution-humidity',
    title: 'Is the air drying? The second witness says no',
    region: { bbox: [-180, -60, 180, 90], label: 'Global land' },
    window: '2001-2024',
    why_selected: 'Technical.',
    summary: 'GLDAS and MERRA-2 disagree.',
    evidence: [
      {
        variable: 'specific_humidity',
        product: 'GLDAS_NOAH10_M',
        method: 'MK',
        sen_slope_decade: -1,
        slope_unit: 'g kg-1 per decade',
        p_value: 0.0001,
        q_value: 0.0001,
        valid_observations: 288,
        coverage_fraction: 1,
        trend_class: -1,
      },
    ],
    limitations: [],
    kind: 'caution',
  }

  it('uses the largest contradicted fraction and links to its caution case', () => {
    const witnessRows = [
      row('air_temperature', 0.57, 0.04, 0.07, null, 0.6, 0.05),
      row('specific_humidity', 0.08, 0.416, 0.16, null, 0.156, 0.394),
      row('root_zone_soil_moisture', 0.09, 0.333, 0.22, null, 0.309, 0.13),
    ]
    const insightVariables = [
      variable('air_temperature', 'Air temperature', 'temperature'),
      variable('specific_humidity', 'Specific humidity', 'atmosphere'),
      variable('root_zone_soil_moisture', 'Root-zone soil moisture'),
    ]
    const insights = buildHomeInsights(
      insightVariables,
      witnessRows,
      '2001-01',
      '2024-12',
      [caution],
    )
    const witness = insights.find((insight) => insight.id === 'witness')!
    expect(witness.variableId).toBe('specific_humidity')
    expect(witness.value).toBe('39.4%')
    expect(witness.title).toBe('The second witness disagrees')
    expect(witness.detail).toContain('independent NASA dataset')
    expect(witness.caseId).toBe('case-caution-humidity')
    expect(insights.some((insight) => insight.id === 'breadth')).toBe(false)
  })

  it('falls back to the Discovery witness layer when no case matches', () => {
    const witnessRows = [row('specific_humidity', 0.08, 0.416, 0.16, null, 0.156, 0.394)]
    const insights = buildHomeInsights(
      [variable('specific_humidity', 'Specific humidity', 'atmosphere')],
      witnessRows,
      '2001-01',
      '2024-12',
      [],
    )
    const witness = insights.find((insight) => insight.id === 'witness')!
    expect(witness.caseId).toBeNull()
    expect(witness.variableId).toBe('specific_humidity')
  })
})

describe('second-witness evidence line', () => {
  it('shows the confirmed share from the screener row', () => {
    const witnessRows = [
      row('air_temperature', 0.57, 0.05, 0.07, null, 0.64),
      row('soil', 0.09, 0.32, 0.22, null, null),
      row('precipitation', 0.06, 0.06, 0.48, null, 0.51),
    ]
    const insights = buildHomeInsights(variables, witnessRows, '2001-01', '2024-12')
    const warming = insights.find((insight) => insight.id === 'warming')!
    const loss = insights.find((insight) => insight.id === 'decrease')!
    expect(warming.witnessConfirmed).toBeCloseTo(0.64)
    expect(witnessEvidenceText(warming)).toBe('64.0% confirmed by a second NASA dataset')
    expect(loss.variableId).toBe('soil')
    expect(loss.witnessConfirmed).toBeNull()
    expect(witnessEvidenceText(loss)).toBeNull()
  })
})
