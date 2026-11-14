import { describe, expect, it } from 'vitest'
import type { Country, Region, VariableMeta } from '../../data/types'
import { buildCheckYourself, checkTools } from './checkYourself'

const window = { id: '2001-2024', start: '2001-01', end: '2024-12' }

function variable(overrides: Partial<VariableMeta>): VariableMeta {
  return {
    id: 'root_zone_soil_moisture',
    label: 'Root-zone soil moisture',
    category: 'water',
    product: 'GLDAS_NOAH10_M',
    product_version: '2.1',
    doi: '10.5067/LWTYSMP3VM5Z',
    source_type: 'model',
    source_variable: 'RootMoist_inst',
    display_unit: 'kg m-2',
    slope_unit: 'kg m-2 per year',
    description: 'test',
    caveats: [],
    core: true,
    increase_means: 'wetter',
    ...overrides,
  }
}

const vietnam: Country = {
  id: 'country_704',
  label: 'Vietnam',
  iso_numeric: '704',
  index: 193,
  n_cells: 30,
  bbox: [102.1276, 8.5834, 109.4465, 23.3447],
}

const amazon: Region = {
  id: 'amazon',
  label: 'Amazon (approx. box)',
  bbox: [-80, -20, -45, 5],
  kind: 'box',
}

describe('buildCheckYourself', () => {
  it('builds the entry values for a country selection', () => {
    const model = buildCheckYourself({
      selection: { kind: 'region', regionId: 'country_704' },
      variable: variable({}),
      window,
      countries: [vietnam],
    })
    expect(model.values).toEqual({
      product: 'GLDAS_NOAH10_M',
      productVersion: '2.1',
      sourceVariable: 'RootMoist_inst',
      box: {
        west: '102.1276',
        south: '8.5834',
        east: '109.4465',
        north: '23.3447',
      },
      period: '2001-01 to 2024-12',
    })
  })

  it('builds the entry values for a predefined box region', () => {
    const model = buildCheckYourself({
      selection: { kind: 'region', regionId: 'amazon' },
      variable: variable({}),
      window,
      regions: [amazon],
    })
    expect(model.values.box).toEqual({
      west: '-80',
      south: '-20',
      east: '-45',
      north: '5',
    })
  })

  it('builds the entry values for a custom box selection', () => {
    const model = buildCheckYourself({
      selection: { kind: 'bbox', bbox: [-68, -19, -52, -4] },
      variable: variable({ product: 'GPM_3IMERGM', product_version: '07', source_variable: 'precipitation' }),
      window,
    })
    expect(model.values.product).toBe('GPM_3IMERGM')
    expect(model.values.productVersion).toBe('07')
    expect(model.values.sourceVariable).toBe('precipitation')
    expect(model.values.box).toEqual({
      west: '-68',
      south: '-19',
      east: '-52',
      north: '-4',
    })
  })

  it('builds the entry values for a cell selection', () => {
    const model = buildCheckYourself({
      selection: { kind: 'cell', row: 90, col: 180 },
      variable: variable({}),
      window,
    })
    expect(model.values.box).toEqual({
      west: '0',
      south: '-1',
      east: '1',
      north: '0',
    })
  })

  it('shows Hydrology Time Series only for GLDAS water variables', () => {
    expect(checkTools(variable({})).map((tool) => tool.id)).toEqual([
      'giovanni',
      'hydrology',
      'climexp',
    ])
    expect(
      checkTools(
        variable({ id: 'air_temperature', category: 'temperature', source_variable: 'Tair_f_inst' }),
      ).map((tool) => tool.id),
    ).toEqual(['giovanni', 'climexp'])
    expect(
      checkTools(
        variable({
          id: 'precipitation',
          category: 'water',
          product: 'GPM_3IMERGM',
          product_version: '07',
          source_variable: 'precipitation',
        }),
      ).map((tool) => tool.id),
    ).toEqual(['giovanni', 'climexp'])
  })

  it('uses the exact Resources-tab URLs and no deep links', () => {
    const tools = checkTools(variable({}))
    expect(tools).toEqual([
      { id: 'giovanni', label: 'Giovanni', url: 'https://giovanni.gsfc.nasa.gov/' },
      {
        id: 'hydrology',
        label: 'Hydrology Time Series',
        url: 'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series',
      },
      { id: 'climexp', label: 'KNMI Climate Explorer', url: 'https://climexp.knmi.nl/' },
    ])
  })
})
