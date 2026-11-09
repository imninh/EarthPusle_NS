import { describe, expect, it } from 'vitest'
import type { ScreenerRow, VariableMeta } from '../../data/types'
import { buildHomeInsights, heroVariableId } from './insights'

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

const row = (variableId: string, increase: number, decrease: number, contrast: number | null): ScreenerRow => ({
  variable: variableId,
  valid_area_fraction: 0.99,
  sig_increase_area_fraction: increase,
  sig_decrease_area_fraction: decrease,
  median_abs_std_change_decade: 0.4,
  median_sen_slope_decade_sig: 1,
  regional_contrast: contrast,
  n_cells_evaluated: 100,
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
